/**
 * GET /api/orders/:number?phone=… — suivi de commande.
 *
 * Le numéro de commande seul ne suffit pas : il est séquentiel, donc devinable.
 * Le téléphone de la commande fait office de second facteur. C'est modeste,
 * mais cela empêche d'énumérer les commandes des autres.
 */
import { route, notFound, phone as parsePhone } from "../../lib/http.js";
import { one, sql } from "../../lib/db.js";

export default route({
  GET: async ({ query }) => {
    const number = String(query.number ?? "").trim().toUpperCase();
    const caller = parsePhone(query.phone, "téléphone");

    const order = await one`
      SELECT o.*, s.tracking_reference, s.status AS shipping_status,
             s.estimated_min_days, s.estimated_max_days,
             p.provider AS payment_provider, p.status AS payment_status
        FROM orders o
        LEFT JOIN shipments s ON s.order_id = o.id
        LEFT JOIN payments  p ON p.order_id = o.id
       WHERE o.order_number = ${number} AND o.ship_to_phone = ${caller}
    `;
    if (!order) throw notFound("Aucune commande ne correspond à ce numéro et à ce téléphone");

    const items = await sql`
      SELECT product_name, variant_name, quantity, unit_price, line_total
        FROM order_items WHERE order_id = ${order.id} ORDER BY created_at
    `;

    return {
      order: {
        order_number: order.order_number,
        status: order.status,
        placed_at: order.placed_at,
        confirmed_at: order.confirmed_at,
        shipped_at: order.shipped_at,
        delivered_at: order.delivered_at,
        items,
        totals: {
          subtotal: order.subtotal,
          discount_total: order.discount_total,
          shipping_total: order.shipping_total,
          grand_total: order.grand_total,
          currency: order.currency,
        },
        shipping: {
          status: order.shipping_status,
          tracking_reference: order.tracking_reference,
          estimated_days: [order.estimated_min_days, order.estimated_max_days],
          city: order.ship_to_city,
          commune: order.ship_to_commune,
        },
        payment: { operator: order.payment_provider, status: order.payment_status },
      },
    };
  },
});
