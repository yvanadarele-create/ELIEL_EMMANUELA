/**
 * GET  /api/cart?token=…  — lire le panier
 * POST /api/cart          — en ouvrir un
 *
 * Le jeton est opaque et ne porte aucune information : il ne sert qu'à
 * retrouver une ligne. Le navigateur le garde, le serveur garde le reste.
 */
import { route, created, notFound } from "../../lib/http.js";
import { createCart, findCart, readCart } from "../../lib/cart.js";

export default route({
  GET: async ({ query }) => {
    const cart = await findCart(query.token);
    if (!cart) throw notFound("Ce panier n'existe plus");
    return { cart: await readCart(cart) };
  },

  POST: async ({ body }) => {
    const cart = await createCart({ attributionId: body.attribution_id ?? null });
    return created({ cart: await readCart(cart) });
  },
});
