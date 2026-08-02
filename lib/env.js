/**
 * Le seul endroit du code qui lit process.env.
 *
 * Tout le reste importe une valeur depuis ici. C'est ce qui rend vérifiable la
 * règle « aucun secret dans le code client » : un grep de `process.env` ne doit
 * renvoyer que ce fichier et les scripts de build, jamais un fichier de /api ni
 * quoi que ce soit sous /assets.
 *
 * Une variable manquante ne fait pas tomber le module au chargement — sur
 * Vercel cela transformerait une clé oubliée en 500 sur toutes les routes, y
 * compris celles qui n'en ont pas besoin. Elle échoue au moment où on l'utilise,
 * avec le nom de la variable dans le message.
 */

const read = (name) => process.env[name]?.trim() || undefined;

class MissingEnv extends Error {
  constructor(name, hint) {
    super(`${name} n'est pas défini.${hint ? ` ${hint}` : ""}`);
    this.name = "MissingEnv";
    this.variable = name;
    this.statusCode = 503;
  }
}

/** Lit une variable obligatoire, ou lève une erreur qui se lit sans contexte. */
export function required(name, hint) {
  const value = read(name);
  if (!value) throw new MissingEnv(name, hint);
  return value;
}

export const env = {
  get databaseUrl() {
    return required(
      "DATABASE_URL",
      "Utilisez la chaîne « pooled » de Neon : une fonction serverless ouvre une connexion par requête.",
    );
  },

  get authSecret() {
    return required("AUTH_SECRET", "Générez-la avec : openssl rand -base64 32");
  },

  get siteUrl() {
    return read("SITE_URL") || read("VERCEL_PROJECT_PRODUCTION_URL") || "https://elielemmanuela.com";
  },

  // Les numéros WhatsApp ne sont pas des secrets : ils sont publics sur chaque
  // page. L'environnement ne sert qu'à les surcharger sans toucher un fichier
  // suivi par git, exactement comme pour le site statique.
  whatsapp: {
    get primary() {
      return read("WHATSAPP_NUMBER_1")?.replace(/\D/g, "");
    },
    get secondary() {
      return read("WHATSAPP_NUMBER_2")?.replace(/\D/g, "");
    },
  },

  ai: {
    get apiKey() {
      return read("AI_API_KEY");
    },
    get model() {
      return read("AI_MODEL");
    },
    get configured() {
      return Boolean(read("AI_API_KEY"));
    },
  },

  payment: {
    get provider() {
      return read("PAYMENT_PROVIDER") || "manual";
    },
    get secretKey() {
      return read("PAYMENT_SECRET_KEY");
    },
    get webhookSecret() {
      return read("PAYMENT_WEBHOOK_SECRET");
    },
    get configured() {
      return Boolean(read("PAYMENT_SECRET_KEY"));
    },
  },

  shipping: {
    get provider() {
      return read("SHIPPING_PROVIDER") || "internal";
    },
    get apiKey() {
      return read("SHIPPING_API_KEY");
    },
    get accountId() {
      return read("SHIPPING_ACCOUNT_ID");
    },
  },

  get isProduction() {
    return read("VERCEL_ENV") === "production" || read("NODE_ENV") === "production";
  },
};
