/**
 * GET /api/inventory — état du stock.
 *
 * Réservé à l'administration : les quantités exactes ne sont pas publiques.
 * L'authentification arrive au jalon 11 ; d'ici là la route refuse toute
 * requête plutôt que d'exposer les chiffres. Un TODO ne protège rien.
 */
import { route, unauthorized } from "../../lib/http.js";

export default route({
  GET: async () => {
    throw unauthorized(
      "L'inventaire n'est lisible que depuis l'administration, qui n'est pas encore déployée.",
    );
  },
});
