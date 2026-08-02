/**
 * Enveloppe commune à toutes les fonctions de /api.
 *
 * Elle fait quatre choses qu'aucun gestionnaire ne devrait refaire :
 * router sur la méthode, analyser le corps JSON, convertir une exception en
 * réponse honnête, et empêcher qu'un message d'erreur interne parte au client.
 *
 * Sur ce dernier point : une erreur inattendue rend « une erreur interne » et
 * un identifiant, jamais le message d'origine. Un message Postgres cite le SQL,
 * qui cite les noms de colonnes — c'est une carte de la base offerte à qui
 * sait provoquer un plantage.
 */
import { randomUUID } from "node:crypto";

export class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, message, details);
export const unauthorized = (message = "Authentification requise") => new ApiError(401, message);
export const notFound = (message = "Introuvable") => new ApiError(404, message);
export const conflict = (message, details) => new ApiError(409, message, details);
export const unprocessable = (message, details) => new ApiError(422, message, details);

export function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // Les réponses de l'API dépendent du panier et de l'attribution : rien ici
  // ne doit se retrouver dans un cache partagé.
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body !== undefined) return req.body; // Vercel a déjà analysé le corps.

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Aucune requête légitime de cette API ne dépasse quelques kilo-octets.
    if (size > 64 * 1024) throw badRequest("Corps de requête trop volumineux");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};

  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest("Corps JSON invalide");
  }
}

/**
 * Construit un gestionnaire Vercel à partir d'une table de méthodes.
 *
 *     export default route({
 *       GET: async ({ query }) => ({ products: await list(query) }),
 *       POST: async ({ body }) => created(await add(body)),
 *     });
 */
export function route(handlers, options = {}) {
  const allowed = Object.keys(handlers);

  return async function handler(req, res) {
    const requestId = randomUUID();

    // Le site et l'API partagent une origine ; il n'y a donc pas de CORS à
    // ouvrir. Seul le prévol est répondu, pour que les navigateurs cessent de
    // demander.
    if (req.method === "OPTIONS") {
      res.setHeader("Allow", [...allowed, "OPTIONS"].join(", "));
      res.statusCode = 204;
      return res.end();
    }

    if (!handlers[req.method]) {
      res.setHeader("Allow", [...allowed, "OPTIONS"].join(", "));
      return json(res, 405, { error: `Méthode ${req.method} non autorisée`, allowed });
    }

    try {
      const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
      const query = Object.fromEntries(url.searchParams);
      const body = ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) ? await readBody(req) : {};

      const result = await handlers[req.method]({ req, res, query, body, url, requestId });

      if (res.writableEnded) return undefined;
      if (result === undefined) return json(res, 204, null);
      if (result && result.$status) {
        const { $status, ...rest } = result;
        return json(res, $status, rest);
      }
      return json(res, 200, result);
    } catch (error) {
      if (error instanceof ApiError) {
        return json(res, error.statusCode, {
          error: error.message,
          ...(error.details ? { details: error.details } : {}),
        });
      }

      // MissingEnv porte son propre code : une clé absente est une panne de
      // configuration (503), pas un bug (500), et la distinction change ce
      // qu'il faut aller regarder.
      if (error?.statusCode === 503) {
        console.error(`[${requestId}] configuration:`, error.message);
        return json(res, 503, {
          error: "Ce service n'est pas encore configuré.",
          missing: error.variable,
          requestId,
        });
      }

      console.error(`[${requestId}]`, error);
      return json(res, 500, { error: "Erreur interne", requestId });
    }
  };
}

export const created = (body) => ({ $status: 201, ...body });

/* --- Validation -----------------------------------------------------------
 *
 * Volontairement minuscule. Une dépendance de validation ajoute des centaines
 * de kilo-octets au bundle d'une fonction pour ce que ces quinze lignes font.
 */

export function str(value, field, { min = 1, max = 500, optional = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (optional) return undefined;
    throw badRequest(`Le champ « ${field} » est obligatoire`);
  }
  const text = String(value).trim();
  if (text.length < min) throw badRequest(`Le champ « ${field} » est trop court`);
  if (text.length > max) throw badRequest(`Le champ « ${field} » est trop long`);
  return text;
}

export function int(value, field, { min = 0, max = 1_000_000, optional = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (optional) return undefined;
    throw badRequest(`Le champ « ${field} » est obligatoire`);
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`Le champ « ${field} » doit être un entier`);
  if (n < min || n > max) throw badRequest(`Le champ « ${field} » doit être compris entre ${min} et ${max}`);
  return n;
}

/**
 * Téléphone ivoirien. On garde les chiffres et on rétablit l'indicatif 225
 * quand il manque : les clientes écrivent « 07 11 22 33 44 » aussi souvent que
 * « +225 07 11 22 33 44 », et les deux doivent désigner la même personne, sans
 * quoi une même cliente se dédouble dans la base.
 */
export function phone(value, field = "téléphone") {
  const raw = String(value ?? "").replace(/\D/g, "");
  if (raw.length < 8) throw badRequest(`Le champ « ${field} » n'est pas un numéro valide`);
  const normalised = raw.startsWith("225") ? raw : `225${raw.replace(/^0+/, "")}`;
  if (normalised.length < 11 || normalised.length > 15) {
    throw badRequest(`Le champ « ${field} » n'est pas un numéro valide`);
  }
  return normalised;
}

export function email(value, field = "e-mail", { optional = true } = {}) {
  if (!value) {
    if (optional) return undefined;
    throw badRequest(`Le champ « ${field} » est obligatoire`);
  }
  const text = String(value).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)) {
    throw badRequest(`Le champ « ${field} » n'est pas une adresse valide`);
  }
  return text;
}
