/**
 * Lecture du catalogue : produits, variantes, stock, promotions en cours.
 *
 * Une seule requête par écran, pas une par ligne. Le N+1 se paie deux fois sur
 * Neon depuis une fonction serverless — une fois en latence réseau par aller-
 * retour, une fois en connexions retenues pendant ce temps.
 */
import { sql } from "./db.js";
import { displayPrice } from "./pricing.js";

/**
 * Promotions actives, avec les produits et catégories qu'elles visent.
 * Chargées une fois et passées au moteur de prix, plutôt que relues par
 * produit.
 */
export async function livePromotions() {
  return sql`
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
     ORDER BY p.priority DESC
  `;
}

const mediaOf = (rows, productId) =>
  rows
    .filter((m) => m.product_id === productId)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.position - b.position)
    .map(({ product_id, ...rest }) => rest);

/**
 * Le stock exposé publiquement est un état, pas un nombre : publier « il en
 * reste 3 » invite au marchandage et renseigne la concurrence. L'admin, lui,
 * voit les quantités.
 */
const stockState = (inventory) => {
  if (!inventory) return "unknown";
  const available = inventory.quantity_on_hand - inventory.quantity_reserved;
  if (available > 0) return available <= inventory.low_stock_threshold ? "low" : "in_stock";
  return inventory.allow_backorder ? "backorder" : "out_of_stock";
};

function shapeVariants(variants, product, includeQuantities) {
  return variants
    .filter((v) => v.product_id === product.id)
    .map((v) => ({
      id: v.id,
      sku: v.sku,
      name: v.name,
      option_name: v.option_name,
      option_value: v.option_value,
      price: v.price_override ?? product.base_price,
      weight_grams: v.weight_grams,
      stock: stockState(v),
      ...(includeQuantities
        ? {
            quantity_on_hand: v.quantity_on_hand,
            quantity_reserved: v.quantity_reserved,
            quantity_available: v.quantity_on_hand - v.quantity_reserved,
            low_stock_threshold: v.low_stock_threshold,
          }
        : {}),
    }));
}

/** Liste publique. `status` reste interne : on ne publie que l'actif. */
export async function listProducts({ category, featured, includeQuantities = false } = {}) {
  const products = await sql`
    SELECT p.*, c.slug AS category_slug, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.status = 'active'
       AND (${category ?? null}::text IS NULL OR c.slug = ${category ?? null})
       AND (${featured ?? null}::boolean IS NULL OR p.is_featured = ${featured ?? null})
     ORDER BY p.position, p.name
  `;
  if (products.length === 0) return [];

  const ids = products.map((p) => p.id);
  const [variants, media, promotions] = await Promise.all([
    sql`
      SELECT v.*, i.quantity_on_hand, i.quantity_reserved, i.low_stock_threshold, i.allow_backorder
        FROM product_variants v
        LEFT JOIN inventory i ON i.variant_id = v.id
       WHERE v.product_id = ANY(${ids}) AND v.is_active
       ORDER BY v.position
    `,
    sql`SELECT * FROM product_media WHERE product_id = ANY(${ids})`,
    livePromotions(),
  ]);

  return products.map((product) => ({
    id: product.id,
    slug: product.slug,
    name: product.name,
    subtitle: product.subtitle,
    description: product.description,
    category: product.category_slug ? { slug: product.category_slug, name: product.category_name } : null,
    currency: product.currency,
    is_featured: product.is_featured,
    is_new: product.is_new,
    tags: product.tags,
    pricing: displayPrice(product, promotions),
    media: mediaOf(media, product.id),
    variants: shapeVariants(variants, product, includeQuantities),
  }));
}

/** Fiche complète d'un produit, par slug. */
export async function getProduct(slug, { includeQuantities = false } = {}) {
  const [product] = await sql`
    SELECT p.*, c.slug AS category_slug, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.slug = ${slug} AND p.status = 'active'
  `;
  if (!product) return null;

  const [variants, media, promotions, related] = await Promise.all([
    sql`
      SELECT v.*, i.quantity_on_hand, i.quantity_reserved, i.low_stock_threshold, i.allow_backorder
        FROM product_variants v
        LEFT JOIN inventory i ON i.variant_id = v.id
       WHERE v.product_id = ${product.id} AND v.is_active
       ORDER BY v.position
    `,
    sql`SELECT * FROM product_media WHERE product_id = ${product.id}`,
    livePromotions(),
    sql`
      SELECT slug, name, subtitle, base_price
        FROM products
       WHERE status = 'active' AND id <> ${product.id}
       ORDER BY position
       LIMIT 4
    `,
  ]);

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    subtitle: product.subtitle,
    description: product.description,
    story: product.story,
    category: product.category_slug ? { slug: product.category_slug, name: product.category_name } : null,
    currency: product.currency,
    is_featured: product.is_featured,
    is_new: product.is_new,
    tags: product.tags,
    seo: { title: product.seo_title, description: product.seo_description },
    pricing: displayPrice(product, promotions),
    media: mediaOf(media, product.id),
    variants: shapeVariants(variants, product, includeQuantities),
    related,
  };
}

export { stockState };
