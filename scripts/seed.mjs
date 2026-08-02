#!/usr/bin/env node
/**
 * Remplit une base vierge avec le catalogue réel : les deux produits, leurs
 * variantes, le stock, les catégories, les zones de livraison lues depuis
 * config/brand.json, et la configuration de l'agent.
 *
 *     DATABASE_URL=postgres://… node scripts/seed.mjs
 *
 * Idempotent : chaque insertion est un upsert sur la clé naturelle (slug, SKU).
 * Relancer ne duplique rien et ne réinitialise pas le stock — on ne remet pas
 * l'inventaire d'une boutique à zéro parce qu'un script a été lancé deux fois.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const brand = JSON.parse(readFileSync(resolve(here, "../config/brand.json"), "utf8"));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("seed: DATABASE_URL n'est pas défini.");
  process.exit(1);
}

const local = /localhost|127\.0\.0\.1|host=\//.test(url);
const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: true } });
await client.connect();
const q = (text, values) => client.query(text, values);

/* --- Catégories ----------------------------------------------------------- */

const categories = [
  { slug: "cheveux", name: "Soins cheveux", description: "Hydrater, démêler, définir." },
  { slug: "corps", name: "Soins du corps", description: "Le rituel du hammam marocain." },
];

for (const [i, c] of categories.entries()) {
  await q(
    `INSERT INTO categories (slug, name, description, position)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
    [c.slug, c.name, c.description, i],
  );
}

/* --- Produits ------------------------------------------------------------- */

const products = [
  {
    slug: "creme-cheveux",
    category: "cheveux",
    name: "Crème Cheveux Naturels",
    subtitle: "L'excellence naturelle au service de chaque chevelure.",
    description:
      "Une crème riche mais légère, pensée pour les cheveux crépus, frisés et bouclés " +
      "d'Afrique de l'Ouest. Elle hydrate, démêle et définit sans alourdir.",
    price: 1000,
    featured: true,
    tags: ["cheveux", "hydratation", "karité", "argan"],
    media: [{ url: "/assets/img/product-creme.svg", alt: "Pot de Crème Cheveux Naturels ELIEL EMMANUELA", primary: true }],
    story: {
      ingredients: [
        ["Beurre de karité", "Nourrit et scelle l'hydratation."],
        ["Huile d'argan", "Assouplit la fibre et fait briller sans graisser."],
        ["Huile de coco vierge", "Limite la perte de protéines pendant le lavage."],
        ["Glycérine végétale", "Capte l'humidité de l'air et la retient."],
        ["Aloe vera", "Apaise le cuir chevelu et facilite le démêlage."],
      ],
      ritual: ["Sur cheveux humides", "Mèche par mèche", "Démêlez, puis laissez"],
    },
    variants: [{ sku: "EE-CRM-150", name: "Pot de 150 ml", stock: 40, weight: 180 }],
  },
  {
    slug: "savon-noir",
    category: "corps",
    name: "Savon Noir Marocain",
    subtitle: "Le rituel d'une peau naturellement sublime.",
    description:
      "Le beldi authentique : une pâte d'olives noires et d'huile d'olive, sans mousse " +
      "et sans parfum, qui prépare la peau au gommage et la laisse nette et lumineuse.",
    price: 3000,
    featured: true,
    tags: ["corps", "hammam", "gommage", "olive"],
    media: [{ url: "/assets/img/product-savon.svg", alt: "Savon noir marocain dans une coupelle dorée", primary: true }],
    story: {
      ingredients: [
        ["Olives noires broyées", "La base de la pâte, sa couleur et sa texture."],
        ["Huile d'olive", "Nourrit pendant que le savon nettoie."],
        ["Potasse végétale", "L'agent de saponification traditionnel."],
      ],
      ritual: ["Chauffer", "Poser", "Gommer"],
    },
    variants: [{ sku: "EE-SAV-200", name: "Pot de 200 g", stock: 25, weight: 240 }],
  },
];

for (const [i, p] of products.entries()) {
  const { rows: [category] } = await q("SELECT id FROM categories WHERE slug = $1", [p.category]);

  const { rows: [product] } = await q(
    `INSERT INTO products (slug, name, subtitle, description, story, category_id,
                           base_price, status, is_featured, tags, position, seo_title, seo_description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11,$12)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name, subtitle = EXCLUDED.subtitle, description = EXCLUDED.description,
       story = EXCLUDED.story, category_id = EXCLUDED.category_id, base_price = EXCLUDED.base_price,
       status = 'active', is_featured = EXCLUDED.is_featured, tags = EXCLUDED.tags
     RETURNING id`,
    [p.slug, p.name, p.subtitle, p.description, JSON.stringify(p.story), category.id,
     p.price, p.featured, p.tags, i, `${p.name} — ${p.price} F CFA | ELIEL EMMANUELA`, p.description.slice(0, 155)],
  );

  for (const [j, m] of p.media.entries()) {
    await q(
      `INSERT INTO product_media (product_id, url, alt, position, is_primary)
       SELECT $1,$2,$3,$4,$5
       WHERE NOT EXISTS (SELECT 1 FROM product_media WHERE product_id = $1 AND url = $2)`,
      [product.id, m.url, m.alt, j, m.primary ?? false],
    );
  }

  for (const [j, v] of p.variants.entries()) {
    const { rows: [variant] } = await q(
      `INSERT INTO product_variants (product_id, sku, name, weight_grams, position)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (sku) DO UPDATE SET name = EXCLUDED.name, weight_grams = EXCLUDED.weight_grams
       RETURNING id`,
      [product.id, v.sku, v.name, v.weight, j],
    );
    // Le stock ne se réécrit pas : DO NOTHING, pas DO UPDATE.
    await q(
      `INSERT INTO inventory (variant_id, quantity_on_hand) VALUES ($1,$2)
       ON CONFLICT (variant_id) DO NOTHING`,
      [variant.id, v.stock],
    );
  }
}

/* --- Zones de livraison ---------------------------------------------------
 *
 * Les mêmes zones et tarifs que la page « Livraison & retours ». Cette page
 * reste servie en statique ; la table est ce que le calcul de frais utilise.
 */

const zones = [
  { slug: "abidjan-sud", name: "Abidjan sud", fee: 1000, min: 1, max: 2,
    areas: ["Marcory", "Treichville", "Koumassi", "Port-Bouët"] },
  { slug: "abidjan-nord", name: "Abidjan nord", fee: 1000, min: 1, max: 2,
    areas: ["Cocody", "Riviera", "Angré", "Deux-Plateaux", "Adjamé", "Plateau"] },
  { slug: "abidjan-ouest", name: "Abidjan ouest", fee: 1500, min: 2, max: 2,
    areas: ["Yopougon", "Abobo", "Attécoubé"] },
  { slug: "peripherie", name: "Périphérie d'Abidjan", fee: 2000, min: 2, max: 3,
    areas: ["Bingerville", "Songon", "Anyama", "Grand-Bassam", "Bassam"] },
  { slug: "hors-abidjan", name: "Reste de la Côte d'Ivoire", fee: 2500, min: 3, max: 4,
    areas: [], prepay: true },
];

for (const [i, z] of zones.entries()) {
  await q(
    `INSERT INTO shipping_zones (slug, name, areas, fee, min_days, max_days, requires_prepayment, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name, areas = EXCLUDED.areas, fee = EXCLUDED.fee,
       min_days = EXCLUDED.min_days, max_days = EXCLUDED.max_days,
       requires_prepayment = EXCLUDED.requires_prepayment`,
    [z.slug, z.name, z.areas, z.fee, z.min, z.max, z.prepay ?? false, i],
  );
}

/* --- Réglages et agent ---------------------------------------------------- */

const settings = [
  ["currency", JSON.stringify(brand.site.currency), "Devise des prix affichés"],
  ["payment_operators", JSON.stringify(brand.payments.map((p) => p.id)), "Opérateurs acceptés"],
  ["free_shipping_above", JSON.stringify(null), "Seuil de franco de port, null = aucun"],
  ["order_prefix", JSON.stringify("EE"), "Préfixe des numéros de commande"],
];

for (const [key, value, description] of settings) {
  await q(
    `INSERT INTO settings (key, value, description) VALUES ($1,$2::jsonb,$3)
     ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`,
    [key, value, description],
  );
}

await q(
  `INSERT INTO ai_agent_config (id, is_enabled, system_prompt, escalation_keywords, handoff_line)
   VALUES (TRUE, FALSE, $1, $2, 'secondary')
   ON CONFLICT (id) DO NOTHING`,
  [
    "Tu es l'assistante d'ELIEL EMMANUELA, maison de beauté à Abidjan. " +
      "Tu réponds en français, brièvement et chaleureusement. " +
      "Tu ne cites JAMAIS un prix, une disponibilité ou une composition qui ne " +
      "figure pas dans les données produit qui te sont fournies. " +
      "Si l'information manque, tu le dis et tu proposes de passer la main à une personne.",
    ["remboursement", "réclamation", "avocat", "plainte", "livreur", "problème de livraison"],
  ],
);

const { rows: [counts] } = await q(`
  SELECT (SELECT count(*) FROM products) AS products,
         (SELECT count(*) FROM product_variants) AS variants,
         (SELECT count(*) FROM shipping_zones) AS zones
`);

console.log(
  `seed: ${counts.products} produit(s), ${counts.variants} variante(s), ${counts.zones} zone(s) de livraison`,
);
await client.end();
