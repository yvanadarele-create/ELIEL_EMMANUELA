/** GET /api/shipping/zones — zones, frais et délais, pour la page livraison. */
import { route } from "../../lib/http.js";
import { sql } from "../../lib/db.js";

export default route({
  GET: async () => {
    const zones = await sql`
      SELECT slug, name, areas, fee, free_above, min_days, max_days, requires_prepayment
        FROM shipping_zones WHERE is_active ORDER BY position, fee
    `;
    return { zones };
  },
});
