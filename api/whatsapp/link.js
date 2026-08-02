/**
 * POST /api/whatsapp/link — construit un lien WhatsApp porteur de contexte et
 * ouvre la conversation correspondante.
 *
 * La conversation est créée côté base au moment du clic. C'est ce qui permettra
 * plus tard à l'agent IA et à l'administration de reprendre un fil déjà commencé
 * plutôt que de repartir d'un « bonjour » sans objet.
 */
import { route, str, int } from "../../lib/http.js";
import { buildLink } from "../../lib/whatsapp.js";
import { one } from "../../lib/db.js";
import { env } from "../../lib/env.js";

const INTENTS = new Set(["order", "question", "track", "cart"]);

export default route({
  POST: async ({ body }) => {
    const intent = str(body.intent, "intent", { optional: true }) ?? "order";
    if (!INTENTS.has(intent)) {
      return { error: `Intention inconnue : ${intent}`, $status: 400 };
    }

    // Le service client répond aux questions et au suivi ; les commandes vont
    // sur la ligne des ventes.
    const line = intent === "question" || intent === "track" ? "secondary" : "primary";

    let product = null;
    if (body.product_slug) {
      product = await one`
        SELECT id, name, slug FROM products WHERE slug = ${body.product_slug} AND status = 'active'
      `;
      if (product) product.url = `${env.siteUrl}/${product.slug}`;
    }

    const link = buildLink({
      line,
      intent,
      product,
      variant: str(body.variant, "variante", { optional: true }),
      quantity: int(body.quantity, "quantité", { optional: true, min: 1, max: 99 }) ?? 1,
      orderNumber: str(body.order_number, "numéro de commande", { optional: true }),
      cartUrl: body.cart_token ? `${env.siteUrl}/panier?token=${body.cart_token}` : null,
    });

    if (body.visitor_token) {
      await one`
        INSERT INTO conversations (channel, line, visitor_token, subject, product_id, last_message_at)
        VALUES ('whatsapp', ${line}, ${body.visitor_token}, ${intent}, ${product?.id ?? null}, now())
        RETURNING id
      `;
    }

    return { link };
  },
});
