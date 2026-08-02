/**
 * POST   /api/cart/coupon — appliquer un code
 * DELETE /api/cart/coupon — le retirer
 */
import { route, str, notFound } from "../../lib/http.js";
import { findCart, applyCoupon, removeCoupon } from "../../lib/cart.js";

export default route({
  POST: async ({ body }) => {
    const cart = await findCart(str(body.token, "token"));
    if (!cart) throw notFound("Ce panier n'existe plus");
    return { cart: await applyCoupon(cart, str(body.code, "code")) };
  },

  DELETE: async ({ body }) => {
    const cart = await findCart(str(body.token, "token"));
    if (!cart) throw notFound("Ce panier n'existe plus");
    return { cart: await removeCoupon(cart) };
  },
});
