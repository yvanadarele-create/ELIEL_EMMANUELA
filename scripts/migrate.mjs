#!/usr/bin/env node
/**
 * Applique les migrations SQL en attente, dans l'ordre du nom de fichier.
 *
 * Chaque fichier tourne dans UNE transaction et n'est enregistré comme appliqué
 * que si elle a été validée. Une migration à moitié passée est donc impossible :
 * soit le fichier entier a pris, soit la base est exactement comme avant.
 *
 *     DATABASE_URL=postgres://… node scripts/migrate.mjs
 *     DATABASE_URL=postgres://… node scripts/migrate.mjs --status
 *
 * Le hachage du contenu est stocké : modifier un fichier déjà appliqué est une
 * erreur signalée, pas un silence. On corrige avec une nouvelle migration.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../db/migrations");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("migrate: DATABASE_URL n'est pas défini.\n");
  console.error("  Neon : créez un projet sur neon.tech, copiez la chaîne de connexion,");
  console.error("  puis : DATABASE_URL='postgres://…' npm run migrate");
  process.exit(1);
}

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const digest = (sql) => createHash("sha256").update(sql).digest("hex").slice(0, 16);

// Neon exige TLS ; un Postgres local n'en a pas. Le choix se fait sur l'hôte
// plutôt que sur une variable de plus à retenir.
const isLocal = /@(localhost|127\.0\.0\.1|\/)/.test(url) || url.includes("host=/");
const client = new pg.Client({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: true } });

await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name        TEXT PRIMARY KEY,
    checksum    TEXT        NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms INTEGER     NOT NULL
  )
`);

const { rows: applied } = await client.query("SELECT name, checksum FROM schema_migrations");
const seen = new Map(applied.map((r) => [r.name, r.checksum]));

if (process.argv.includes("--status")) {
  for (const file of files) {
    const sum = digest(readFileSync(join(migrationsDir, file), "utf8"));
    const was = seen.get(file);
    const state = !was ? "en attente" : was === sum ? "appliquée" : "MODIFIÉE APRÈS COUP";
    console.log(`  ${state.padEnd(20)} ${file}`);
  }
  await client.end();
  process.exit(0);
}

let ran = 0;

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  const sum = digest(sql);
  const previous = seen.get(file);

  if (previous === sum) continue;

  if (previous && previous !== sum) {
    console.error(`migrate: ${file} a changé après avoir été appliquée (${previous} → ${sum}).`);
    console.error("  Une migration appliquée est immuable — écrivez-en une nouvelle.");
    await client.end();
    process.exit(1);
  }

  const started = Date.now();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations(name, checksum, duration_ms) VALUES ($1, $2, $3)",
      [file, sum, Date.now() - started],
    );
    await client.query("COMMIT");
    console.log(`  ✓ ${file} (${Date.now() - started} ms)`);
    ran++;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`  ✗ ${file}\n    ${error.message}`);
    await client.end();
    process.exit(1);
  }
}

console.log(ran ? `migrate: ${ran} migration(s) appliquée(s)` : "migrate: base déjà à jour");
await client.end();
