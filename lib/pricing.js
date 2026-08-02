/**
 * Moteur de promotion : décide, pour un panier donné, quelle remise s'applique
 * et combien elle vaut.
 *
 * Trois règles tiennent l'ensemble :
 *
 *   1. **Le serveur seul décide du prix.** Le client envoie des variantes et
 *      des quantités, jamais un montant. Un total calculé dans le navigateur
 *      est une suggestion, pas un prix.
 *   2. **Une remise ne dépasse jamais ce qu'elle vise.** Une remise fixe de
 *      5 000 F sur un panier de 3 000 F vaut 3 000 F, pas un avoir.
 *   3. **Sans `stackable`, une seule promotion gagne** — celle de plus forte
 *      priorité, puis celle qui remise le plus. Les promotions cumulables
 *      s'ajoutent ensuite, toujours plafonnées au sous-total.
 *
 * Les montants sont des entiers en francs CFA. Un pourcentage arrondit à
 * l'entier inférieur : la maison arrondit en faveur de la cliente.
 */

/** Une promotion est-elle ouverte à cet instant ? */
export function isLive(promotion, now = new Date()) {
  if (!promotion.is_active) return false;
  if (promotion.starts_at && new Date(promotion.starts_at) > now) return false;
  if (promotion.ends_at && new Date(promotion.ends_at) <= now) return false;
  if (promotion.max_uses !== null && promotion.uses_count >= promotion.max_uses) return false;
  return true;
}

/** Les lignes du panier que cette promotion vise réellement. */
function targeted(promotion, lines) {
  if (promotion.scope === "all") return lines;
  if (promotion.scope === "product") {
    const ids = new Set(promotion.target_product_ids ?? []);
    return lines.filter((line) => ids.has(line.product_id));
  }
  const ids = new Set(promotion.target_category_ids ?? []);
  return lines.filter((line) => line.category_id && ids.has(line.category_id));
}

const sumOf = (lines) => lines.reduce((total, line) => total + line.unit_price * line.quantity, 0);

/**
 * Valeur d'une promotion sur un panier, en francs. Zéro si elle ne mord sur
 * rien — ce qui est différent de « elle ne s'applique pas » et laisse
 * l'appelant expliquer pourquoi.
 */
export function amountOf(promotion, lines) {
  const base = sumOf(targeted(promotion, lines));
  if (base <= 0) return 0;

  const raw =
    promotion.kind === "percentage"
      ? Math.floor((base * promotion.value) / 100)
      : promotion.value;

  return Math.max(0, Math.min(raw, base));
}

/**
 * Choisit les promotions applicables et rend le détail du calcul.
 *
 * `context.isFirstOrder` vient de la base (customers.orders_count), jamais du
 * client : « c'est ma première commande » est autrement une case à cocher qui
 * donne une remise à volonté.
 */
export function resolve({ lines, promotions, coupon = null, context = {} }) {
  const subtotal = sumOf(lines);
  const now = context.now ?? new Date();
  const reasons = [];

  const eligible = promotions.filter((promotion) => {
    if (!isLive(promotion, now)) return false;

    // Une promotion à coupon n'existe que si ce coupon-là a été présenté.
    if (promotion.requires_coupon && coupon?.promotion_id !== promotion.id) return false;

    if (promotion.first_order_only && !context.isFirstOrder) {
      reasons.push({ slug: promotion.slug, skipped: "réservée à la première commande" });
      return false;
    }
    if (subtotal < promotion.min_subtotal) {
      reasons.push({
        slug: promotion.slug,
        skipped: `sous-total minimum de ${promotion.min_subtotal} F non atteint`,
      });
      return false;
    }
    if (amountOf(promotion, lines) <= 0) {
      reasons.push({ slug: promotion.slug, skipped: "aucun article concerné" });
      return false;
    }
    return true;
  });

  const scored = eligible
    .map((promotion) => ({ promotion, amount: amountOf(promotion, lines) }))
    .sort((a, b) => b.promotion.priority - a.promotion.priority || b.amount - a.amount);

  const applied = [];
  const exclusive = scored.find((entry) => !entry.promotion.stackable);
  if (exclusive) applied.push(exclusive);
  for (const entry of scored) {
    if (entry.promotion.stackable) applied.push(entry);
  }

  // Le plafond se calcule sur le cumul, pas promotion par promotion : deux
  // remises de 60 % ne rendent pas un panier gratuit plus 20 %.
  let discountTotal = 0;
  const detail = [];
  for (const { promotion, amount } of applied) {
    const room = subtotal - discountTotal;
    const effective = Math.max(0, Math.min(amount, room));
    if (effective === 0) continue;
    discountTotal += effective;
    detail.push({
      id: promotion.id,
      slug: promotion.slug,
      name: promotion.name,
      kind: promotion.kind,
      value: promotion.value,
      amount: effective,
      via_coupon: promotion.requires_coupon ? (coupon?.code ?? null) : null,
    });
  }

  return {
    subtotal,
    discount_total: discountTotal,
    total_after_discount: subtotal - discountTotal,
    applied: detail,
    skipped: reasons,
  };
}

/**
 * Ce que la page produit doit afficher : prix affiché, prix barré, pourcentage
 * et échéance. Le compte à rebours du site se nourrit de `ends_at` — il n'y a
 * pas de minuterie décorative dans cette base de code.
 */
export function displayPrice(product, promotions, now = new Date()) {
  const line = [{
    product_id: product.id,
    category_id: product.category_id,
    unit_price: product.base_price,
    quantity: 1,
  }];

  const best = promotions
    .filter((p) => isLive(p, now) && !p.requires_coupon)
    .map((p) => ({ promotion: p, amount: amountOf(p, line) }))
    .filter((entry) => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount)[0];

  if (!best) {
    return {
      price: product.base_price,
      compare_at: product.compare_at_price ?? null,
      discount_percent: product.compare_at_price
        ? Math.round(((product.compare_at_price - product.base_price) / product.compare_at_price) * 100)
        : null,
      promotion: null,
      ends_at: null,
    };
  }

  const price = product.base_price - best.amount;
  return {
    price,
    compare_at: product.base_price,
    discount_percent: Math.round((best.amount / product.base_price) * 100),
    promotion: { slug: best.promotion.slug, name: best.promotion.name },
    ends_at: best.promotion.ends_at,
  };
}
