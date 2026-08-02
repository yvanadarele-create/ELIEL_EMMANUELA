/** GET /api/products?category=&featured= — le catalogue public. */
import { route } from "../../lib/http.js";
import { listProducts } from "../../lib/catalog.js";

export default route({
  GET: async ({ query }) => ({
    products: await listProducts({
      category: query.category,
      featured: query.featured === undefined ? undefined : query.featured === "true",
    }),
  }),
});
