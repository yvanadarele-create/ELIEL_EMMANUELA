/**
 * POST   /api/cart/items — ajouter
 * PATCH  /api/cart/items — changer une quantité (0 retire)
 * DELETE /api/cart/items — retirer
 *
 * Aucun prix n'est accepté du client : le corps ne contient que des
 * identifiants et des quantités.
 */
import { route, str, int, notFound } from "../../lib/http.js";
import { openCart, findCart, addItem, setQuantity, removeItem } from "../../lib/cart.js";

export default route({
  POST: async ({ body }) => {
    const cart = await openCart(str(body.token, "token", { optional: true }), {
      attributionId: body.attribution_id ?? null,
    });
    return {
      cart: await addItem(cart, {
        variantId: str(body.variant_id, "variant_id"),
        quantity: int(body.quantity, "quantité", { min: 1, max: 99 }),
      }),
    };
  },

  PATCH: async ({ body }) => {
    const cart = await findCart(str(body.token, "token"));
    if (!cart) throw notFound("Ce panier n'existe plus");
    return {
      cart: await setQuantity(cart, {
        itemId: str(body.item_id, "item_id"),
        quantity: int(body.quantity, "quantité", { min: 0, max: 99 }),
      }),
    };
  },

  DELETE: async ({ body }) => {
    const cart = await findCart(str(body.token, "token"));
    if (!cart) throw notFound("Ce panier n'existe plus");
    return { cart: await removeItem(cart, str(body.item_id, "item_id")) };
  },
});
