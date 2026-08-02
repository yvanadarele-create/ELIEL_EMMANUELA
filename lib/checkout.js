/**
 * Passage de commande.
 *
 * Tout se joue dans une seule transaction, et l'ordre des opérations est ce
 * qui rend la chose correcte sous charge :
 *
 *   1. verrouiller les lignes de stock concernées (SELECT … FOR UPDATE) ;
 *   2. revérifier la disponibilité — le panier a pu dormir une heure ;
 *   3. recalculer les prix et les remises côté serveur ;
 *   4. écrire la cliente, la commande, ses lignes, le stock réservé,
 *      le paiement, l'expédition et le coupon consommé ;
 *   5. marquer le panier converti.
 *
 * Sans le verrou de l'étape 1, deux clientes achètent le dernier pot en même
 * temps et les deux commandes passent. C'est le seul endroit du code où cela
 * peut arriver, donc c'est le seul endroit qui prend un verrou.
 */
import { transaction } from "./db.js";
import { conflict, unprocessable } from "./http.js";
import { resolve } from "./pricing.js";
import { shippingProvider } from "./shipping/index.js";
import { paymentProvider } from "./payments/index.js";

export async function placeOrder({
  cart,
  customer,
  address,
  paymentOperator = "cash",
  notes = null,
  channel = "web",
  attributionId = null,
}) {
  const shipping = shippingProvider();
  const payments = paymentProvider();

  if (!payments.supports(paymentOperator)) {
    throw unprocessable(`Moyen de paiement « ${paymentOperator} » non pris en charge`);
  }

  const quote = await shipping.calculateShipping({
    commune: address.commune,
    city: address.city,
    subtotal: 0, // recalculé plus bas une fois le sous-total connu
  });

  return transaction(async (sql) => {
    // 1 — les lignes du panier.
    const lines = await sql`
      SELECT ci.quantity, ci.unit_price,
             v.id AS variant_id, v.sku, v.name AS variant_name,
             p.id AS product_id, p.name AS product_name, p.category_id
        FROM cart_items ci
        JOIN product_variants v ON v.id = ci.variant_id
        JOIN products p ON p.id = v.product_id
       WHERE ci.cart_id = ${cart.id}
       ORDER BY ci.created_at
    `;

    if (lines.length === 0) throw unprocessable("Votre panier est vide");

    // 2 — verrou sur le stock, puis relecture SOUS le verrou.
    //
    //     Le verrou est pris dans une requête séparée : Postgres refuse
    //     FOR UPDATE sur le côté nullable d'un LEFT JOIN, et la jointure au
    //     stock doit rester externe puisqu'une variante peut ne pas encore
    //     avoir de ligne d'inventaire. Les quantités lues ici sont donc les
    //     seules dignes de confiance — celles du panier peuvent dater d'une
    //     heure.
    const variantIds = lines.map((l) => l.variant_id);
    const stock = await sql`
      SELECT variant_id, quantity_on_hand, quantity_reserved, allow_backorder
        FROM inventory
       WHERE variant_id = ANY(${variantIds})
         FOR UPDATE
    `;
    const stockOf = new Map(stock.map((row) => [row.variant_id, row]));

    for (const line of lines) {
      const held = stockOf.get(line.variant_id);
      if (!held) continue; // Pas de stock suivi pour cette variante.
      if (held.allow_backorder) continue;
      const available = held.quantity_on_hand - held.quantity_reserved;
      if (available < line.quantity) {
        throw conflict(
          `« ${line.product_name} » n'est plus disponible en quantité suffisante`,
          { sku: line.sku, requested: line.quantity, available },
        );
      }
    }

    // 3 — les prix viennent de la base, jamais du client.
    const coupon = cart.coupon_id
      ? await sql.one`SELECT * FROM coupons WHERE id = ${cart.coupon_id}`
      : null;

    const [promotions, existing] = await Promise.all([
      sql`
        SELECT p.*,
               COALESCE(array_agg(DISTINCT t.product_id)  FILTER (WHERE t.product_id  IS NOT NULL), '{}') AS target_product_ids,
               COALESCE(array_agg(DISTINCT t.category_id) FILTER (WHERE t.category_id IS NOT NULL), '{}') AS target_category_ids
          FROM promotions p
          LEFT JOIN promotion_targets t ON t.promotion_id = p.id
         WHERE p.is_active
           AND (p.starts_at IS NULL OR p.starts_at <= now())
           AND (p.ends_at   IS NULL OR p.ends_at   >  now())
           AND (p.max_uses  IS NULL OR p.uses_count < p.max_uses)
         GROUP BY p.id
      `,
      sql.one`SELECT id, orders_count FROM customers WHERE phone = ${customer.phone}`,
    ]);

    const priced = resolve({
      lines: lines.map((l) => ({
        product_id: l.product_id,
        category_id: l.category_id,
        unit_price: l.unit_price,
        quantity: l.quantity,
      })),
      promotions,
      coupon,
      context: { isFirstOrder: (existing?.orders_count ?? 0) === 0 },
    });

    const shippingFee =
      quote.free_shipping_applied || (quote.free_above && priced.total_after_discount >= quote.free_above)
        ? 0
        : quote.fee;

    const grandTotal = priced.total_after_discount + shippingFee;

    // 4 — écritures.
    const person = await sql.one`
      INSERT INTO customers (phone, email, first_name, last_name, city)
      VALUES (${customer.phone}, ${customer.email ?? null}, ${customer.firstName ?? null},
              ${customer.lastName ?? null}, ${address.city})
      ON CONFLICT (phone) DO UPDATE
        SET email      = COALESCE(EXCLUDED.email, customers.email),
            first_name = COALESCE(EXCLUDED.first_name, customers.first_name),
            last_name  = COALESCE(EXCLUDED.last_name, customers.last_name),
            city       = COALESCE(EXCLUDED.city, customers.city)
      RETURNING *
    `;

    const order = await sql.one`
      INSERT INTO orders (
        customer_id, attribution_id, cart_id, coupon_id, status, channel,
        subtotal, discount_total, shipping_total, grand_total, currency,
        ship_to_name, ship_to_phone, ship_to_line1, ship_to_line2,
        ship_to_commune, ship_to_city, ship_to_country, ship_to_landmark, notes
      ) VALUES (
        ${person.id}, ${attributionId}, ${cart.id}, ${cart.coupon_id}, 'pending', ${channel},
        ${priced.subtotal}, ${priced.discount_total}, ${shippingFee}, ${grandTotal}, ${cart.currency},
        ${address.name}, ${customer.phone}, ${address.line1}, ${address.line2 ?? null},
        ${address.commune ?? null}, ${address.city}, ${address.country ?? "CI"},
        ${address.landmark ?? null}, ${notes}
      )
      RETURNING *
    `;

    // La remise globale est répartie au prorata des lignes, puis le reste de
    // l'arrondi est posé sur la dernière : sans cela la somme des lignes ne
    // retombe pas sur le total de la commande, et la contrainte le refuse.
    const subtotal = priced.subtotal;
    let allocated = 0;
    for (const [index, line] of lines.entries()) {
      const lineGross = line.unit_price * line.quantity;
      const isLast = index === lines.length - 1;
      const share = isLast
        ? priced.discount_total - allocated
        : Math.floor((priced.discount_total * lineGross) / (subtotal || 1));
      allocated += share;

      await sql`
        INSERT INTO order_items (
          order_id, variant_id, product_id, product_name, variant_name, sku,
          unit_price, quantity, line_discount, line_total
        ) VALUES (
          ${order.id}, ${line.variant_id}, ${line.product_id}, ${line.product_name},
          ${line.variant_name}, ${line.sku}, ${line.unit_price}, ${line.quantity},
          ${share}, ${lineGross - share}
        )
      `;

      await sql`
        UPDATE inventory SET quantity_reserved = quantity_reserved + ${line.quantity}
         WHERE variant_id = ${line.variant_id}
      `;
      await sql`
        INSERT INTO inventory_movements (variant_id, delta, reason, order_id)
        VALUES (${line.variant_id}, ${-line.quantity}, 'reservation', ${order.id})
      `;
    }

    await sql`
      INSERT INTO payments (order_id, provider, status, amount, currency)
      VALUES (${order.id}, ${paymentOperator}, 'pending', ${grandTotal}, ${order.currency})
    `;

    const reference = shippingProvider().generateTrackingReference();
    await sql`
      INSERT INTO shipments (order_id, zone_id, provider, tracking_reference, status, fee,
                             estimated_min_days, estimated_max_days)
      VALUES (${order.id}, ${quote.zone_id}, 'internal', ${reference}, 'pending', ${shippingFee},
              ${quote.min_days}, ${quote.max_days})
    `;

    if (coupon) {
      await sql`UPDATE coupons SET uses_count = uses_count + 1 WHERE id = ${coupon.id}`;
      await sql`
        INSERT INTO coupon_redemptions (coupon_id, order_id, customer_id, amount_discounted)
        VALUES (${coupon.id}, ${order.id}, ${person.id}, ${priced.discount_total})
      `;
    }
    for (const applied of priced.applied) {
      await sql`UPDATE promotions SET uses_count = uses_count + 1 WHERE id = ${applied.id}`;
    }

    await sql`
      UPDATE customers
         SET orders_count   = orders_count + 1,
             total_spent    = total_spent + ${grandTotal},
             first_order_at = COALESCE(first_order_at, now()),
             last_order_at  = now()
       WHERE id = ${person.id}
    `;

    // 5 — le panier a fait son travail.
    await sql`UPDATE carts SET status = 'converted', customer_id = ${person.id} WHERE id = ${cart.id}`;

    if (attributionId) {
      await sql`UPDATE attributions SET customer_id = ${person.id} WHERE id = ${attributionId}`;
    }

    return {
      order_number: order.order_number,
      status: order.status,
      totals: {
        subtotal: order.subtotal,
        discount_total: order.discount_total,
        shipping_total: order.shipping_total,
        grand_total: order.grand_total,
        currency: order.currency,
      },
      shipping: {
        zone: quote.zone_name,
        tracking_reference: reference,
        estimated_days: [quote.min_days, quote.max_days],
      },
      payment: { operator: paymentOperator, status: "pending" },
      promotions_applied: priced.applied,
    };
  });
}
