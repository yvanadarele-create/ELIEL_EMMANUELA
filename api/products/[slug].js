/** GET /api/products/:slug — fiche produit complète. */
import { route, notFound } from "../../lib/http.js";
import { getProduct } from "../../lib/catalog.js";

export default route({
  GET: async ({ query }) => {
    const product = await getProduct(query.slug);
    if (!product) throw notFound("Ce produit n'existe pas");
    return { product };
  },
});
