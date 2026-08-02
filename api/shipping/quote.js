/** POST /api/shipping/quote — frais et délai pour une commune donnée. */
import { route, str, int } from "../../lib/http.js";
import { shippingProvider } from "../../lib/shipping/index.js";

export default route({
  POST: async ({ body }) => {
    const quote = await shippingProvider().calculateShipping({
      commune: str(body.commune, "commune", { optional: true }),
      city: str(body.city, "ville", { optional: true }) ?? "Abidjan",
      subtotal: int(body.subtotal, "sous-total", { optional: true }) ?? 0,
    });
    return { quote };
  },
});
