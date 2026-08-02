/**
 * Abstraction paiement.
 *
 * Aucune API n'est branchée à ce stade, et ce n'est pas un manque : Wave,
 * Orange Money, Moov Money, MTN MoMo, Djamo et Western Union se règlent
 * aujourd'hui de la main à la main ou par transfert, puis se confirment sur
 * WhatsApp. Le fournisseur « manual » modélise exactement cela — il enregistre
 * l'intention de paiement et attend qu'un humain la marque payée.
 *
 * Le jour où un agrégateur est signé, il implémente la même interface, et rien
 * d'autre dans le code ne bouge.
 */
import { env } from "../env.js";
import { manualProvider } from "./manual.js";

const registry = {
  manual: manualProvider,
};

export function paymentProvider(name = env.payment.provider) {
  const factory = registry[name];
  if (!factory) {
    throw new Error(
      `Fournisseur de paiement « ${name} » inconnu. Disponibles : ${Object.keys(registry).join(", ")}.`,
    );
  }
  return factory();
}
