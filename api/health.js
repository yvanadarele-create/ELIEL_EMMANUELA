/** Sonde de vie : la fonction répond-elle, et la base est-elle joignable ? */
import { route } from "../lib/http.js";
import { ping } from "../lib/db.js";
import { env } from "../lib/env.js";

export default route({
  GET: async () => {
    const started = Date.now();
    const db = await ping();
    return {
      status: "ok",
      database: { connected: true, name: db.db, latency_ms: Date.now() - started },
      // Utile au déploiement : dit ce qui reste à configurer sans révéler
      // aucune valeur.
      configured: {
        payments: env.payment.configured,
        ai: env.ai.configured,
        shipping_provider: env.shipping.provider,
      },
    };
  },
});
