/**
 * Accès Postgres, pensé pour des fonctions serverless.
 *
 * Un pool est conservé sur le globe entre deux invocations : Vercel réutilise
 * une instance chaude, et ouvrir une connexion par requête HTTP épuiserait
 * Neon en quelques minutes de trafic TikTok. Le pool reste volontairement
 * petit — une instance chaude ne traite qu'une requête à la fois, donc plus
 * d'une poignée de connexions n'est que du gaspillage multiplié par le nombre
 * d'instances.
 *
 * En production, DATABASE_URL doit pointer sur le point de terminaison
 * « pooled » de Neon (celui dont l'hôte contient `-pooler`). Sinon chaque
 * instance froide consomme une connexion directe et la limite tombe vite.
 */
import pg from "pg";
import { env } from "./env.js";

// XOF n'a pas de sous-unité : les montants sont des entiers. Sans cela, pg rend
// les BIGINT en chaîne et les NUMERIC en chaîne, et les totaux se concatènent
// au lieu de s'additionner — un bug silencieux qui ne se voit qu'en caisse.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

const globalKey = Symbol.for("eliel.pgPool");

function pool() {
  if (!globalThis[globalKey]) {
    const connectionString = env.databaseUrl;
    const local = /localhost|127\.0\.0\.1|host=\//.test(connectionString);

    globalThis[globalKey] = new pg.Pool({
      connectionString,
      ssl: local ? false : { rejectUnauthorized: true },
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      // Une requête qui dépasse 15 s sur ce site est une requête en panne :
      // mieux vaut une erreur nette qu'une fonction qui expire à froid.
      statement_timeout: 15_000,
    });

    // Sans ce gestionnaire, une connexion coupée par Neon fait tomber tout le
    // processus Node au lieu d'être simplement retirée du pool.
    globalThis[globalKey].on("error", (error) => {
      console.error("pg pool: connexion inactive perdue —", error.message);
    });
  }
  return globalThis[globalKey];
}

/**
 * Requête en gabarit étiqueté. Les valeurs interpolées deviennent des
 * paramètres liés, jamais du texte concaténé : il n'existe pas de chemin dans
 * cette base de code où une entrée d'utilisatrice atteigne l'analyseur SQL.
 *
 *     const rows = await sql`SELECT * FROM products WHERE slug = ${slug}`;
 */
export async function sql(strings, ...values) {
  const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""), "");
  const result = await pool().query(text, values);
  return result.rows;
}

/** Première ligne, ou undefined. Le cas le plus fréquent. */
export async function one(strings, ...values) {
  const rows = await sql(strings, ...values);
  return rows[0];
}

/**
 * Transaction interactive. Le rappel reçoit un `sql` lié à une seule connexion,
 * ce qui est indispensable pour une commande : décrémenter le stock, écrire la
 * commande et consommer le coupon doivent réussir ou échouer ensemble.
 */
export async function transaction(run) {
  const client = await pool().connect();
  const scoped = async (strings, ...values) => {
    const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""), "");
    const result = await client.query(text, values);
    return result.rows;
  };
  scoped.one = async (...args) => (await scoped(...args))[0];

  try {
    await client.query("BEGIN");
    const value = await run(scoped);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Utilisé par /api/health, et par rien d'autre. */
export async function ping() {
  const [row] = await sql`SELECT now() AS at, current_database() AS db`;
  return row;
}
