/** GET /api/promotions — promotions publiques en cours, avec leur échéance. */
import { route } from "../../lib/http.js";
import { livePromotions } from "../../lib/catalog.js";

export default route({
  GET: async () => {
    const promotions = await livePromotions();
    return {
      // Une promotion à coupon ne s'annonce pas : elle se saisit.
      promotions: promotions
        .filter((p) => !p.requires_coupon)
        .map((p) => ({
          slug: p.slug,
          name: p.name,
          description: p.description,
          kind: p.kind,
          value: p.value,
          scope: p.scope,
          min_subtotal: p.min_subtotal,
          first_order_only: p.first_order_only,
          // Le compte à rebours de l'interface se cale là-dessus, et sur rien
          // d'autre : pas de minuterie décorative.
          ends_at: p.ends_at,
        })),
    };
  },
});
