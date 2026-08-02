/**
 * Abstraction transporteur.
 *
 * Aujourd'hui la maison livre elle-même dans le district d'Abidjan et confie le
 * reste du pays à une gare routière. Demain ce sera peut-être un transporteur
 * avec une API. Le reste du code ne doit pas avoir à le savoir : il appelle
 * quatre fonctions et se moque de qui les exécute.
 *
 *     const provider = shippingProvider();
 *     await provider.calculateShipping({ city, commune, subtotal });
 *     await provider.createShipment({ order });
 *     await provider.getShipmentStatus(reference);
 *     provider.generateTrackingReference();
 *
 * SHIPPING_PROVIDER choisit l'implémentation. Les identifiants du transporteur
 * réel vivent dans l'environnement, jamais ici.
 */
import { env } from "../env.js";
import { internalProvider } from "./internal.js";

const registry = {
  internal: internalProvider,
};

export function shippingProvider(name = env.shipping.provider) {
  const factory = registry[name];
  if (!factory) {
    throw new Error(
      `Transporteur « ${name} » inconnu. Disponibles : ${Object.keys(registry).join(", ")}. ` +
        `Ajoutez une implémentation dans lib/shipping/ et enregistrez-la ici.`,
    );
  }
  return factory();
}

export { normaliseArea } from "./internal.js";
