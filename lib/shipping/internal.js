/**
 * Livraison en propre : les zones et les tarifs vivent dans la table
 * shipping_zones, modifiable depuis l'administration sans redéploiement.
 *
 * C'est le transporteur par défaut, et il n'appelle aucune API. Un
 * transporteur externe implémentera la même interface dans un fichier voisin.
 */
import { randomBytes } from "node:crypto";
import { sql, one } from "../db.js";

/**
 * « Deux-Plateaux », « deux plateaux » et « DEUX PLATEAUX » désignent la même
 * commune. On compare sur une forme sans accent, sans tiret et sans casse,
 * sinon une cliente sur trois tombe dans « zone inconnue ».
 */
export function normaliseArea(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function internalProvider() {
  return {
    name: "internal",

    /**
     * Frais et délai pour une adresse. Rend toujours une réponse : quand la
     * commune n'est pas reconnue, la zone « reste du pays » sert de repli et
     * la réponse le dit, plutôt que de bloquer la commande.
     */
    async calculateShipping({ commune, city = "Abidjan", subtotal = 0 }) {
      const zones = await sql`
        SELECT id, slug, name, areas, fee, free_above, min_days, max_days, requires_prepayment
        FROM shipping_zones
        WHERE is_active
        ORDER BY position, fee
      `;
      if (zones.length === 0) {
        throw new Error("Aucune zone de livraison configurée — lancez le seed ou créez-en une.");
      }

      const needle = normaliseArea(commune || city);
      const matched =
        zones.find((zone) => zone.areas.some((area) => normaliseArea(area) === needle)) ??
        zones.find((zone) => zone.slug === "hors-abidjan") ??
        zones[zones.length - 1];

      const free = matched.free_above !== null && subtotal >= matched.free_above;

      return {
        zone_id: matched.id,
        zone_slug: matched.slug,
        zone_name: matched.name,
        fee: free ? 0 : matched.fee,
        free_shipping_applied: free,
        min_days: matched.min_days,
        max_days: matched.max_days,
        requires_prepayment: matched.requires_prepayment,
        matched_exactly: matched.areas.some((area) => normaliseArea(area) === needle),
      };
    },

    /**
     * Référence de suivi. Base32 sans I, O, 1 ni 0 : elle est lue au téléphone
     * et recopiée à la main, et ces quatre caractères sont ceux qu'on confond.
     */
    generateTrackingReference() {
      const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
      const bytes = randomBytes(8);
      let out = "";
      for (const byte of bytes) out += alphabet[byte % alphabet.length];
      return `EE${out}`;
    },

    async createShipment({ order, zoneId = null, fee = 0, minDays = null, maxDays = null }) {
      const reference = this.generateTrackingReference();
      return one`
        INSERT INTO shipments
          (order_id, zone_id, provider, tracking_reference, status, fee,
           estimated_min_days, estimated_max_days)
        VALUES
          (${order.id}, ${zoneId}, 'internal', ${reference}, 'pending', ${fee},
           ${minDays}, ${maxDays})
        RETURNING *
      `;
    },

    async getShipmentStatus(trackingReference) {
      const shipment = await one`
        SELECT s.*, o.order_number
        FROM shipments s
        JOIN orders o ON o.id = s.order_id
        WHERE s.tracking_reference = ${trackingReference}
      `;
      if (!shipment) return null;
      return {
        reference: shipment.tracking_reference,
        status: shipment.status,
        order_number: shipment.order_number,
        dispatched_at: shipment.dispatched_at,
        delivered_at: shipment.delivered_at,
      };
    },
  };
}
