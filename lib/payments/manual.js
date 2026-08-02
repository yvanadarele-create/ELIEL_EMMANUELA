/**
 * Paiement hors ligne : mobile money, espèces, transfert.
 *
 * Le fournisseur n'appelle rien. Il crée une ligne de paiement « pending » et
 * s'arrête là ; la confirmation viendra de l'administration quand l'argent
 * aura été vu. C'est ce qui se passe réellement aujourd'hui, et le modéliser
 * honnêtement vaut mieux qu'une fausse intégration qui prétend encaisser.
 */
import { one } from "../db.js";

const OPERATORS = new Set([
  "wave", "orange-money", "moov-money", "mtn-momo", "djamo", "western-union", "cash",
]);

export function manualProvider() {
  return {
    name: "manual",
    /** Le paiement est confirmé par un humain, pas par un webhook. */
    capturesAutomatically: false,

    supports(operator) {
      return OPERATORS.has(operator);
    },

    async createIntent({ order, operator, reference = null }) {
      if (!this.supports(operator)) {
        throw new Error(`Opérateur « ${operator} » non pris en charge`);
      }
      return one`
        INSERT INTO payments (order_id, provider, status, amount, currency, reference)
        VALUES (${order.id}, ${operator}, 'pending', ${order.grand_total}, ${order.currency}, ${reference})
        RETURNING *
      `;
    },

    async markPaid({ paymentId, reference = null, raw = {} }) {
      return one`
        UPDATE payments
           SET status = 'paid',
               paid_at = now(),
               reference = COALESCE(${reference}, reference),
               raw = ${JSON.stringify(raw)}::jsonb
         WHERE id = ${paymentId}
     RETURNING *
      `;
    },
  };
}
