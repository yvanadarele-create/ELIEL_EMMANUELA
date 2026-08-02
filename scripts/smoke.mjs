#!/usr/bin/env node
/**
 * Parcours complet, exécuté contre une vraie base.
 *
 * Ce n'est pas une suite de tests unitaires : les gestionnaires de /api sont
 * appelés tels quels, avec des objets req/res minimaux, dans l'ordre où une
 * cliente les déclenche. Ce que cela vérifie n'est pas « la fonction rend le
 * bon objet » mais « le tunnel tient debout » — le panier survit, le stock se
 * réserve, la remise se calcule côté serveur, la commande s'écrit.
 *
 *     DATABASE_URL=postgres://… node scripts/smoke.mjs
 *
 * À lancer sur une base de développement. La dernière étape écrit une vraie
 * commande, puis nettoie derrière elle.
 */
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

if (!process.env.DATABASE_URL) {
  console.error("smoke: DATABASE_URL n'est pas défini.");
  process.exit(1);
}

/** req/res assez complets pour ce que lib/http.js utilise réellement. */
function invoke(handler, { method = "GET", path = "/", query = {}, body } = {}) {
  const search = new URLSearchParams(query).toString();
  const req = Object.assign(
    body === undefined ? Readable.from([]) : Readable.from([Buffer.from(JSON.stringify(body))]),
    { method, url: `${path}${search ? `?${search}` : ""}`, headers: { host: "test.local" } },
  );

  return new Promise((resolve) => {
    const chunks = [];
    const res = {
      statusCode: 200,
      writableEnded: false,
      setHeader() {},
      end(chunk) {
        if (chunk) chunks.push(chunk);
        res.writableEnded = true;
        const text = chunks.join("");
        resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
      },
    };
    handler(req, res);
  });
}

const results = [];
const check = (label, condition, detail = "") => {
  results.push({ label, ok: Boolean(condition), detail });
  console.log(`  ${condition ? "✓" : "✗"} ${label}${detail && !condition ? ` — ${detail}` : ""}`);
};

const [health, products, productBySlug, cartRoute, cartItems, cartCoupon, checkout, orderRoute,
       shippingQuote, shippingZones, promotions, whatsappLink, analytics, inventory] =
  await Promise.all([
    import("../api/health.js"),
    import("../api/products/index.js"),
    import("../api/products/[slug].js"),
    import("../api/cart/index.js"),
    import("../api/cart/items.js"),
    import("../api/cart/coupon.js"),
    import("../api/checkout/index.js"),
    import("../api/orders/[number].js"),
    import("../api/shipping/quote.js"),
    import("../api/shipping/zones.js"),
    import("../api/promotions/index.js"),
    import("../api/whatsapp/link.js"),
    import("../api/analytics/collect.js"),
    import("../api/inventory/index.js"),
  ]).then((mods) => mods.map((m) => m.default));

const { sql } = await import("../lib/db.js");

console.log("\nSanté et catalogue");
const h = await invoke(health);
check("la base répond", h.status === 200 && h.body.database.connected, JSON.stringify(h.body));

const list = await invoke(products);
check("le catalogue expose 2 produits", list.body.products?.length === 2, `${list.body.products?.length}`);
check(
  "les prix viennent de la base",
  list.body.products?.every((p) => p.pricing.price > 0),
);
check(
  "le stock est un état, pas un nombre",
  list.body.products?.every((p) => p.variants.every((v) => v.quantity_on_hand === undefined)),
  "une quantité exacte fuit dans la réponse publique",
);

const detail = await invoke(productBySlug, { query: { slug: "savon-noir" } });
check("la fiche produit se charge", detail.status === 200 && detail.body.product.slug === "savon-noir");
check("elle porte ses variantes", detail.body.product?.variants.length >= 1);

const missing = await invoke(productBySlug, { query: { slug: "nexiste-pas" } });
check("un slug inconnu rend 404", missing.status === 404);

console.log("\nLivraison");
const zones = await invoke(shippingZones);
check("les zones sont configurées", zones.body.zones?.length === 5);

const quoteCocody = await invoke(shippingQuote, { method: "POST", body: { commune: "Cocody" } });
check("Cocody est reconnue", quoteCocody.body.quote?.zone_slug === "abidjan-nord", JSON.stringify(quoteCocody.body));

const quoteAccent = await invoke(shippingQuote, { method: "POST", body: { commune: "deux plateaux" } });
check(
  "« deux plateaux » vaut « Deux-Plateaux »",
  quoteAccent.body.quote?.zone_slug === "abidjan-nord",
  JSON.stringify(quoteAccent.body.quote),
);

const quoteUnknown = await invoke(shippingQuote, { method: "POST", body: { commune: "Bouaké" } });
check(
  "une commune inconnue retombe hors Abidjan",
  quoteUnknown.body.quote?.zone_slug === "hors-abidjan" && quoteUnknown.body.quote.matched_exactly === false,
);

console.log("\nPanier");
const variantId = detail.body.product.variants[0].id;

const opened = await invoke(cartRoute, { method: "POST", body: {} });
const token = opened.body.cart.token;
check("un panier s'ouvre", opened.status === 201 && Boolean(token));

const added = await invoke(cartItems, { method: "POST", body: { token, variant_id: variantId, quantity: 2 } });
check("un article s'ajoute", added.body.cart?.item_count === 2, JSON.stringify(added.body));
check("le total est calculé côté serveur", added.body.cart?.totals.subtotal === 6000, `${added.body.cart?.totals.subtotal}`);

const reread = await invoke(cartRoute, { query: { token } });
check("le panier survit à une nouvelle requête", reread.body.cart?.item_count === 2);

const itemId = reread.body.cart.items[0].id;
const bumped = await invoke(cartItems, { method: "PATCH", body: { token, item_id: itemId, quantity: 3 } });
check("la quantité se modifie", bumped.body.cart?.totals.subtotal === 9000, `${bumped.body.cart?.totals.subtotal}`);

const tooMany = await invoke(cartItems, { method: "PATCH", body: { token, item_id: itemId, quantity: 99 } });
check("le stock plafonne la quantité", tooMany.status === 409, `statut ${tooMany.status}`);

await invoke(cartItems, { method: "PATCH", body: { token, item_id: itemId, quantity: 2 } });

console.log("\nPromotions et coupons");
const promoId = randomUUID();
await sql`
  INSERT INTO promotions (id, slug, name, kind, value, scope, requires_coupon, priority)
  VALUES (${promoId}, 'smoke-10', 'Test 10 %', 'percentage', 10, 'all', TRUE, 100)
`;
await sql`INSERT INTO coupons (code, promotion_id) VALUES ('SMOKE10', ${promoId})`;

const badCoupon = await invoke(cartCoupon, { method: "POST", body: { token, code: "NEXISTEPAS" } });
check("un code inconnu est refusé", badCoupon.status === 404);

const goodCoupon = await invoke(cartCoupon, { method: "POST", body: { token, code: "smoke10" } });
check(
  "un code valide remise 10 %",
  goodCoupon.body.cart?.totals.discount_total === 600,
  JSON.stringify(goodCoupon.body.cart?.totals ?? goodCoupon.body),
);
check("le total reflète la remise", goodCoupon.body.cart?.totals.total === 5400);

const publicPromos = await invoke(promotions);
check(
  "une promo à coupon ne s'annonce pas publiquement",
  !publicPromos.body.promotions?.some((p) => p.slug === "smoke-10"),
);

console.log("\nCommande");
const before = await sql`SELECT quantity_reserved FROM inventory WHERE variant_id = ${variantId}`;

const order = await invoke(checkout, {
  method: "POST",
  body: {
    token,
    phone: "07 11 22 33 44",
    first_name: "Awa",
    name: "Awa K.",
    address: "Rue des Jardins, immeuble Bleu",
    commune: "Cocody",
    landmark: "en face de la pharmacie",
    payment_operator: "wave",
  },
});
check("la commande est créée", order.status === 201, JSON.stringify(order.body));
const number = order.body.order?.order_number;
check("le numéro est lisible", /^EE-\d{4}-\d{6}$/.test(number ?? ""), number);
check(
  "les totaux tiennent : 6000 − 600 + 1000",
  order.body.order?.totals.grand_total === 6400,
  JSON.stringify(order.body.order?.totals),
);

const after = await sql`SELECT quantity_reserved FROM inventory WHERE variant_id = ${variantId}`;
check(
  "le stock est réservé",
  after[0].quantity_reserved - before[0].quantity_reserved === 2,
  `${before[0].quantity_reserved} → ${after[0].quantity_reserved}`,
);

const [movement] = await sql`
  SELECT reason FROM inventory_movements WHERE variant_id = ${variantId} ORDER BY created_at DESC LIMIT 1
`;
check("le mouvement de stock est journalisé", movement?.reason === "reservation");

const reused = await invoke(checkout, { method: "POST", body: { token, phone: "0711223344", name: "X", address: "Y" } });
check("un panier converti ne se recommande pas", reused.status === 404, `statut ${reused.status}`);

console.log("\nSuivi de commande");
const tracked = await invoke(orderRoute, { query: { number, phone: "07 11 22 33 44" } });
check("le suivi répond avec le bon téléphone", tracked.status === 200 && tracked.body.order.order_number === number);

const wrongPhone = await invoke(orderRoute, { query: { number, phone: "07 99 99 99 99" } });
check("un autre téléphone ne voit pas la commande", wrongPhone.status === 404);

console.log("\nWhatsApp, analytique, routes protégées");
const link = await invoke(whatsappLink, {
  method: "POST",
  body: { intent: "order", product_slug: "savon-noir", quantity: 2, variant: "Pot de 200 g" },
});
check("le lien porte le produit", link.body.link?.text.includes("Savon Noir Marocain"), link.body.link?.text);
check("le lien porte la quantité", link.body.link?.text.includes("2 ×"));
check("une commande part sur la ligne des ventes", link.body.link?.line === "primary");

const question = await invoke(whatsappLink, { method: "POST", body: { intent: "question" } });
check("une question part sur le service client", question.body.link?.line === "secondary");
check(
  "les deux lignes sont des numéros réels, pas le remplacement",
  link.body.link?.is_placeholder === false && question.body.link?.is_placeholder === false,
  "un bouton « Commander » mènerait nulle part",
);
check(
  "les deux lignes sont des numéros distincts",
  link.body.link?.url.match(/wa\.me\/(\d+)/)[1] !== question.body.link?.url.match(/wa\.me\/(\d+)/)[1],
  "commandes et service client pointent sur le même numéro",
);

const event = await invoke(analytics, {
  method: "POST",
  body: { name: "add_to_cart", visitor_token: "smoke-visitor", path: "/savon-noir",
          utm: { utm_source: "TikTok", utm_campaign: "lancement" } },
});
check("un événement est accepté", event.status === 204, `statut ${event.status}`);

const [attribution] = await sql`SELECT first_source, first_campaign FROM attributions WHERE visitor_token = 'smoke-visitor'`;
check("« TikTok » est normalisé en « tiktok »", attribution?.first_source === "tiktok", attribution?.first_source);

const badEvent = await invoke(analytics, { method: "POST", body: { name: "hack", visitor_token: "x" } });
check("un événement inconnu est rejeté", badEvent.status === 400);

const locked = await invoke(inventory);
check("l'inventaire refuse sans authentification", locked.status === 401);

const wrongMethod = await invoke(products, { method: "DELETE" });
check("une méthode non autorisée rend 405", wrongMethod.status === 405);

/* --- Nettoyage ------------------------------------------------------------ */

const [placed] = await sql`SELECT id, customer_id FROM orders WHERE order_number = ${number}`;
if (placed) {
  await sql`UPDATE inventory SET quantity_reserved = quantity_reserved - 2 WHERE variant_id = ${variantId}`;
  await sql`DELETE FROM orders WHERE id = ${placed.id}`;
  await sql`DELETE FROM customers WHERE id = ${placed.customer_id}`;
}
await sql`DELETE FROM carts WHERE token = ${token}`;
await sql`DELETE FROM promotions WHERE id = ${promoId}`;
await sql`DELETE FROM analytics_events WHERE visitor_token = 'smoke-visitor'`;
await sql`DELETE FROM attributions WHERE visitor_token = 'smoke-visitor'`;

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} vérification(s) passée(s)` +
    (failed.length ? ` — ${failed.length} en échec` : ""),
);
process.exit(failed.length ? 1 : 0);
