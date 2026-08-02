/**
 * Attribution de campagne.
 *
 * Le cahier des charges veut pouvoir lire « TikTok → produit A → WhatsApp →
 * achat ». Cela suppose de garder DEUX contacts, pas un : le premier, qui dit
 * quelle campagne a fait connaître la marque, et le dernier, qui dit ce qui a
 * déclenché l'achat. N'en garder qu'un fait disparaître la moitié de la phrase.
 *
 * Le jeton de visiteuse est aléatoire et anonyme. Aucune donnée personnelle
 * n'entre ici : ni nom, ni téléphone, ni adresse IP. Le lien vers une cliente
 * ne se fait qu'au moment de la commande, quand elle a elle-même donné son
 * numéro.
 */
import { randomBytes } from "node:crypto";
import { one } from "./db.js";

export const newVisitorToken = () => randomBytes(16).toString("base64url");

const KNOWN_SOURCES = new Set(["tiktok", "instagram", "facebook", "whatsapp", "direct", "referral"]);

/** « TikTok », « tik-tok » et « tiktok.com » désignent la même source. */
export function normaliseSource(value, referrer) {
  const raw = String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (raw.includes("tiktok")) return "tiktok";
  if (raw.includes("instagram") || raw === "ig") return "instagram";
  if (raw.includes("facebook") || raw === "fb" || raw === "meta") return "facebook";
  if (raw.includes("whatsapp")) return "whatsapp";
  if (KNOWN_SOURCES.has(raw)) return raw;

  if (!raw && referrer) {
    try {
      const host = new URL(referrer).hostname;
      if (/tiktok/.test(host)) return "tiktok";
      if (/instagram/.test(host)) return "instagram";
      if (/facebook|fb\.com/.test(host)) return "facebook";
      if (/whatsapp/.test(host)) return "whatsapp";
      return "referral";
    } catch {
      return "direct";
    }
  }
  return raw || "direct";
}

/**
 * Enregistre ou met à jour la trace d'une visiteuse. Le premier contact est
 * protégé par COALESCE : il ne s'écrit qu'une fois, quoi qu'il arrive ensuite.
 */
export async function touch({ visitorToken, source, medium, campaign, content, term, referrer, path }) {
  const resolved = normaliseSource(source, referrer);

  return one`
    INSERT INTO attributions (
      visitor_token, first_source, first_medium, first_campaign, first_content,
      first_term, first_referrer, first_landing_path,
      last_source, last_medium, last_campaign, last_content, last_referrer, last_landing_path
    ) VALUES (
      ${visitorToken}, ${resolved}, ${medium ?? null}, ${campaign ?? null}, ${content ?? null},
      ${term ?? null}, ${referrer ?? null}, ${path ?? null},
      ${resolved}, ${medium ?? null}, ${campaign ?? null}, ${content ?? null}, ${referrer ?? null}, ${path ?? null}
    )
    ON CONFLICT (visitor_token) DO UPDATE SET
      last_source       = EXCLUDED.last_source,
      last_medium       = EXCLUDED.last_medium,
      last_campaign     = EXCLUDED.last_campaign,
      last_content      = EXCLUDED.last_content,
      last_referrer     = EXCLUDED.last_referrer,
      last_landing_path = EXCLUDED.last_landing_path,
      last_seen_at      = now()
    RETURNING *
  `;
}

/** Extrait les paramètres UTM d'une URL, quel que soit leur alias. */
export function fromQuery(query = {}) {
  return {
    source: query.utm_source ?? query.source ?? query.ref,
    medium: query.utm_medium ?? query.medium,
    campaign: query.utm_campaign ?? query.campaign,
    content: query.utm_content ?? query.content ?? query.influencer,
    term: query.utm_term ?? query.term,
  };
}
