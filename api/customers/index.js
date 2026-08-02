/**
 * GET /api/customers — annuaire des clientes.
 *
 * Données personnelles : téléphones, adresses, historique d'achat. La route
 * refuse tant que l'authentification de l'administration n'existe pas. Publier
 * cela « en attendant » serait une fuite, pas un raccourci.
 */
import { route, unauthorized } from "../../lib/http.js";

export default route({
  GET: async () => {
    throw unauthorized(
      "L'annuaire des clientes n'est lisible que depuis l'administration, qui n'est pas encore déployée.",
    );
  },
});
