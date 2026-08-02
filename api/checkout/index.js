/**
 * POST /api/checkout — transforme un panier en commande.
 *
 * Le corps décrit qui reçoit et où ; il ne contient aucun montant. Les totaux
 * rendus par la réponse sont ceux calculés en base, dans la transaction qui a
 * écrit la commande.
 */
import { route, created, str, phone, email, notFound } from "../../lib/http.js";
import { findCart } from "../../lib/cart.js";
import { placeOrder } from "../../lib/checkout.js";

export default route({
  POST: async ({ body }) => {
    const cart = await findCart(str(body.token, "token"));
    if (!cart) throw notFound("Ce panier n'existe plus");

    const result = await placeOrder({
      cart,
      customer: {
        phone: phone(body.phone),
        email: email(body.email),
        firstName: str(body.first_name, "prénom", { optional: true }),
        lastName: str(body.last_name, "nom", { optional: true }),
      },
      address: {
        name: str(body.name, "nom du destinataire", { max: 120 }),
        line1: str(body.address, "adresse", { max: 240 }),
        line2: str(body.address_2, "complément d'adresse", { optional: true, max: 240 }),
        commune: str(body.commune, "commune", { optional: true, max: 80 }),
        city: str(body.city, "ville", { optional: true, max: 80 }) ?? "Abidjan",
        country: str(body.country, "pays", { optional: true, min: 2, max: 2 }) ?? "CI",
        landmark: str(body.landmark, "repère", { optional: true, max: 240 }),
      },
      paymentOperator: str(body.payment_operator, "moyen de paiement", { optional: true }) ?? "cash",
      notes: str(body.notes, "note", { optional: true, max: 1000 }),
      attributionId: body.attribution_id ?? null,
      channel: "web",
    });

    return created({ order: result });
  },
});
