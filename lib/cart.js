/**
 * Panier serveur.
 *
 * Le panier vit en base et le navigateur n'en garde qu'un jeton opaque. Le
 * cahier des charges demande un panier qui survit au rafraîchissement ; en
 * pratique il doit survivre à bien pire, puisque la cliente part sur WhatsApp
 * et revient — souvent depuis un autre onglet du navigateur intégré
 * d'Instagram, qui a vidé le localStorage entre-temps.
 *
 * Deuxième raison, plus importante : aucun montant ne vient du client. Le
 * panier est recalculé à chaque lecture à partir des prix et des promotions en
 * base, donc un total falsifié dans le navigateur n'a nulle part où aller.
 */
import { randomBytes } from "node:crypto";
import { sql, one } from "./db.js";
import { badRequest, conflict, notFound } from "./http.js";
import { livePromotions } from "./catalog.js";
import { resolve } from "./pricing.js";

const newToken = () => randomBytes(24).toString("base64url");

export async function createCart({ attributionId = null } = {}) {
  return one`
    INSERT INTO carts (token, attribution_id)
    VALUES (${newToken()}, ${attributionId})
    RETURNING *
  `;
}

export async function findCart(token) {
  if (!token) return null;
  return one`SELECT * FROM carts WHERE token = ${token} AND status = 'open' AND expires_at > now()`;
}

/** Récupère le panier du jeton, ou en crée un. Utilisé par tout ce qui écrit. */
export async function openCart(token, { attributionId = null } = {}) {
  return (await findCart(token)) ?? (await createCart({ attributionId }));
}

/**
 * Lignes enrichies : nom du produit, prix courant, disponibilité. `unit_price`
 * est celui figé à l'ajout ; `current_price` celui d'aujourd'hui. Les deux sont
 * rendus pour que l'interface puisse dire « le prix a changé » au lieu de
 * modifier le total en silence.
 */
async function linesOf(cartId) {
  return sql`
    SELECT ci.id, ci.quantity, ci.unit_price,
           v.id AS variant_id, v.sku, v.name AS variant_name, v.price_override,
           p.id AS product_id, p.slug AS product_slug, p.name AS product_name,
           p.base_price, p.category_id, p.currency,
           i.quantity_on_hand, i.quantity_reserved, i.allow_backorder,
           COALESCE(v.price_override, p.base_price) AS current_price
      FROM cart_items ci
      JOIN product_variants v ON v.id = ci.variant_id
      JOIN products p ON p.id = v.product_id
      LEFT JOIN inventory i ON i.variant_id = v.id
     WHERE ci.cart_id = ${cartId}
     ORDER BY ci.created_at
  `;
}

/** Le panier complet, prêt à être rendu en JSON. */
export async function readCart(cart) {
  const rows = await linesOf(cart.id);

  const coupon = cart.coupon_id
    ? await one`
        SELECT c.*, p.id AS promotion_id
          FROM coupons c JOIN promotions p ON p.id = c.promotion_id
         WHERE c.id = ${cart.coupon_id}
      `
    : null;

  const promotions = await livePromotions();
  const isFirstOrder = cart.customer_id
    ? ((await one`SELECT orders_count FROM customers WHERE id = ${cart.customer_id}`)?.orders_count ?? 0) === 0
    : true;

  const priced = resolve({
    lines: rows.map((r) => ({
      product_id: r.product_id,
      category_id: r.category_id,
      unit_price: r.unit_price,
      quantity: r.quantity,
    })),
    promotions,
    coupon,
    context: { isFirstOrder },
  });

  return {
    token: cart.token,
    status: cart.status,
    currency: cart.currency,
    items: rows.map((r) => ({
      id: r.id,
      variant_id: r.variant_id,
      sku: r.sku,
      product_slug: r.product_slug,
      product_name: r.product_name,
      variant_name: r.variant_name,
      quantity: r.quantity,
      unit_price: r.unit_price,
      current_price: r.current_price,
      price_changed: r.current_price !== r.unit_price,
      line_total: r.unit_price * r.quantity,
      available: r.allow_backorder
        ? null
        : Math.max(0, (r.quantity_on_hand ?? 0) - (r.quantity_reserved ?? 0)),
    })),
    item_count: rows.reduce((n, r) => n + r.quantity, 0),
    coupon: coupon ? { code: coupon.code } : null,
    totals: {
      subtotal: priced.subtotal,
      discount_total: priced.discount_total,
      total: priced.total_after_discount,
      currency: cart.currency,
    },
    promotions_applied: priced.applied,
  };
}

/**
 * Ajoute une variante. Le prix vient de la base, jamais du corps de la requête,
 * et la disponibilité est vérifiée ici — une commande impossible à honorer
 * coûte plus cher qu'une vente manquée.
 */
export async function addItem(cart, { variantId, quantity }) {
  const variant = await one`
    SELECT v.id, v.is_active, v.price_override, p.base_price, p.status,
           i.quantity_on_hand, i.quantity_reserved, i.allow_backorder
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      LEFT JOIN inventory i ON i.variant_id = v.id
     WHERE v.id = ${variantId}
  `;

  if (!variant || !variant.is_active || variant.status !== "active") {
    throw notFound("Cet article n'est plus disponible");
  }

  const existing = await one`
    SELECT quantity FROM cart_items WHERE cart_id = ${cart.id} AND variant_id = ${variantId}
  `;
  const wanted = (existing?.quantity ?? 0) + quantity;

  if (!variant.allow_backorder) {
    const available = (variant.quantity_on_hand ?? 0) - (variant.quantity_reserved ?? 0);
    if (available < wanted) {
      throw conflict(
        available > 0
          ? `Il ne reste que ${available} exemplaire(s) de cet article`
          : "Cet article est en rupture de stock",
        { available },
      );
    }
  }

  const price = variant.price_override ?? variant.base_price;

  await sql`
    INSERT INTO cart_items (cart_id, variant_id, quantity, unit_price)
    VALUES (${cart.id}, ${variantId}, ${quantity}, ${price})
    ON CONFLICT (cart_id, variant_id)
    DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
  `;

  return readCart(cart);
}

/** Change la quantité. Zéro retire la ligne, ce qui évite une route de plus. */
export async function setQuantity(cart, { itemId, quantity }) {
  const item = await one`SELECT * FROM cart_items WHERE id = ${itemId} AND cart_id = ${cart.id}`;
  if (!item) throw notFound("Cet article n'est pas dans le panier");

  if (quantity === 0) {
    await sql`DELETE FROM cart_items WHERE id = ${itemId}`;
    return readCart(cart);
  }

  const stock = await one`
    SELECT i.quantity_on_hand, i.quantity_reserved, i.allow_backorder
      FROM inventory i WHERE i.variant_id = ${item.variant_id}
  `;
  if (stock && !stock.allow_backorder) {
    const available = stock.quantity_on_hand - stock.quantity_reserved;
    if (available < quantity) throw conflict(`Il ne reste que ${available} exemplaire(s)`, { available });
  }

  await sql`UPDATE cart_items SET quantity = ${quantity} WHERE id = ${itemId}`;
  return readCart(cart);
}

export async function removeItem(cart, itemId) {
  const removed = await sql`DELETE FROM cart_items WHERE id = ${itemId} AND cart_id = ${cart.id} RETURNING id`;
  if (removed.length === 0) throw notFound("Cet article n'est pas dans le panier");
  return readCart(cart);
}

/**
 * Applique un coupon. Toutes les raisons de refus sont explicites : « code
 * invalide » sur un coupon expiré fait écrire au service client, ce qui coûte
 * plus qu'une phrase juste.
 */
export async function applyCoupon(cart, code) {
  const normalised = String(code ?? "").trim().toUpperCase();
  if (!normalised) throw badRequest("Indiquez un code promo");

  const coupon = await one`
    SELECT c.*, p.is_active AS promotion_active, p.starts_at AS promo_starts, p.ends_at AS promo_ends
      FROM coupons c JOIN promotions p ON p.id = c.promotion_id
     WHERE c.code = ${normalised}
  `;

  if (!coupon) throw notFound("Ce code promo n'existe pas");
  if (!coupon.is_active || !coupon.promotion_active) throw conflict("Ce code promo n'est plus actif");

  const now = new Date();
  if (coupon.starts_at && new Date(coupon.starts_at) > now) throw conflict("Ce code promo n'est pas encore valable");
  if (coupon.ends_at && new Date(coupon.ends_at) <= now) throw conflict("Ce code promo a expiré");
  if (coupon.max_uses !== null && coupon.uses_count >= coupon.max_uses) {
    throw conflict("Ce code promo a atteint sa limite d'utilisation");
  }

  await sql`UPDATE carts SET coupon_id = ${coupon.id} WHERE id = ${cart.id}`;
  const refreshed = await one`SELECT * FROM carts WHERE id = ${cart.id}`;
  const view = await readCart(refreshed);

  // Un coupon valide qui ne remise rien sur CE panier doit le dire, plutôt que
  // d'être accepté en silence pour zéro franc.
  if (view.totals.discount_total === 0) {
    await sql`UPDATE carts SET coupon_id = NULL WHERE id = ${cart.id}`;
    throw conflict("Ce code promo ne s'applique à aucun article de votre panier");
  }

  return view;
}

export async function removeCoupon(cart) {
  await sql`UPDATE carts SET coupon_id = NULL WHERE id = ${cart.id}`;
  return readCart(await one`SELECT * FROM carts WHERE id = ${cart.id}`);
}
