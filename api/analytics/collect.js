/**
 * POST /api/analytics/collect — enregistre un événement du parcours.
 *
 * Appelé par navigator.sendBeacon depuis le site. Deux règles :
 *
 *   * Rien de nominatif. Le jeton de visiteuse est aléatoire ; ni IP, ni
 *     empreinte, ni user-agent ne sont stockés. Le cahier des charges le
 *     demande, et c'est de toute façon ce qu'il faut faire.
 *   * Un événement inconnu est rejeté. La contrainte CHECK de la table le
 *     refuserait de toute façon ; autant répondre proprement.
 */
import { route, str, int } from "../../lib/http.js";
import { sql } from "../../lib/db.js";
import { touch, fromQuery } from "../../lib/attribution.js";

const EVENTS = new Set([
  "page_view", "product_view", "add_to_cart", "remove_from_cart", "begin_checkout",
  "purchase", "whatsapp_click", "promotion_click", "coupon_applied", "search",
]);

export default route({
  POST: async ({ body }) => {
    const name = str(body.name, "name", { max: 40 });
    if (!EVENTS.has(name)) return { error: `Événement inconnu : ${name}`, $status: 400 };

    const visitorToken = str(body.visitor_token, "visitor_token", { optional: true, max: 64 });

    let attributionId = null;
    if (visitorToken) {
      const utm = fromQuery(body.utm ?? {});
      const attribution = await touch({
        visitorToken,
        ...utm,
        referrer: str(body.referrer, "referrer", { optional: true, max: 500 }),
        path: str(body.path, "path", { optional: true, max: 300 }),
      });
      attributionId = attribution.id;
    }

    await sql`
      INSERT INTO analytics_events
        (name, visitor_token, session_token, attribution_id, path, value, currency, props)
      VALUES
        (${name}, ${visitorToken ?? null}, ${body.session_token ?? null}, ${attributionId},
         ${str(body.path, "path", { optional: true, max: 300 }) ?? null},
         ${int(body.value, "value", { optional: true, max: 100_000_000 }) ?? null},
         ${body.currency ?? null},
         ${JSON.stringify(body.props ?? {})}::jsonb)
    `;

    // 204 : la balise n'attend rien et le navigateur peut fermer l'onglet.
    return undefined;
  },
});
