/**
 * Liens WhatsApp porteurs de contexte.
 *
 * Le cahier des charges demande qu'un clic depuis une page produit ouvre une
 * conversation contenant déjà le produit, la variante, la quantité et l'URL.
 * Cela vaut autant pour la maison que pour la cliente : sans ce contexte, la
 * conversation s'ouvre sur « bonjour » et il faut trois messages pour savoir
 * de quoi on parle.
 *
 * Les deux numéros diffèrent par leur rôle : `primary` prend les commandes,
 * `secondary` le service client. Un numéro absent de la configuration n'est pas
 * remplacé par un autre en silence — la fonction le dit.
 */
import { createRequire } from "node:module";
import { env } from "./env.js";

// createRequire plutôt qu'un readFileSync sur une URL construite : l'empaqueteur
// de Vercel suit un require() statique et embarque le JSON dans la fonction.
// Un chemin calculé à l'exécution ne se voit pas à la compilation, et le
// fichier manquerait une fois déployé.
const require = createRequire(import.meta.url);
const brandConfig = require("../config/brand.json");

const brand = () => brandConfig;

const PLACEHOLDER = "2250000000000";

/** Numéro d'une ligne. L'environnement l'emporte sur le fichier. */
export function numberFor(line = "primary") {
  const config = brand().whatsapp[line];
  if (!config) throw new Error(`Ligne WhatsApp « ${line} » inconnue`);
  const number = env.whatsapp[line] || String(config.number).replace(/\D/g, "");
  return { number, display: config.display, role: config.role, isPlaceholder: number === PLACEHOLDER };
}

/**
 * Construit le lien et le message. Le texte est en français et s'adresse à la
 * maison, pas à un robot : c'est une vraie personne qui le lira.
 */
export function buildLink({
  line = "primary",
  intent = "order",
  product = null,
  variant = null,
  quantity = 1,
  orderNumber = null,
  cartUrl = null,
  note = null,
}) {
  const { number, isPlaceholder, display, role } = numberFor(line);

  const parts = ["Bonjour ELIEL EMMANUELA,"];

  if (intent === "order" && product) {
    const what = variant ? `${product.name} (${variant})` : product.name;
    parts.push(
      quantity > 1
        ? `je souhaite commander ${quantity} × ${what}.`
        : `je souhaite commander ${what}.`,
    );
    if (product.url) parts.push(product.url);
  } else if (intent === "order") {
    parts.push("je souhaite passer une commande.");
  } else if (intent === "question" && product) {
    parts.push(`j'ai une question sur ${product.name}.`);
    if (product.url) parts.push(product.url);
  } else if (intent === "question") {
    parts.push("j'ai une question.");
  } else if (intent === "track") {
    parts.push(
      orderNumber
        ? `je voudrais suivre ma commande ${orderNumber}.`
        : "je voudrais suivre ma commande.",
    );
  } else if (intent === "cart" && cartUrl) {
    parts.push("je souhaite finaliser ma commande.");
    parts.push(cartUrl);
  }

  if (note) parts.push(note);

  const text = parts.join("\n");

  return {
    url: `https://wa.me/${number}?text=${encodeURIComponent(text)}`,
    text,
    line,
    role,
    display,
    // L'appelant peut afficher un avertissement plutôt que d'offrir un bouton
    // qui mène à un numéro fictif.
    is_placeholder: isPlaceholder,
  };
}
