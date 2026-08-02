#!/usr/bin/env node
/**
 * Serveur de développement : le site statique ET les fonctions de /api, sur un
 * seul port, avec les mêmes règles d'URL que Vercel.
 *
 *     DATABASE_URL=postgres://… npm run dev      → http://localhost:4200
 *
 * Sans lui, `python3 -m http.server` sert les pages mais pas l'API, et le
 * parcours d'achat n'est vérifiable nulle part avant d'être en production —
 * ce qui est exactement le moment où l'on ne veut pas le découvrir.
 *
 * Il reproduit trois comportements du déploiement : `cleanUrls` (/faq sert
 * faq.html), les routes dynamiques ([slug] capture un segment), et le repli sur
 * 404.html. Il n'essaie pas d'imiter Vercel plus loin que cela.
 */
import { createServer } from "node:http";
import { readFile, stat, readdir } from "node:fs/promises";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const port = Number(process.env.PORT || 4200);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

const isFile = async (p) => {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
};

/* --- Découverte des routes d'API -----------------------------------------
 *
 * Le nom de fichier fait la route, comme sur Vercel. `[slug].js` capture un
 * segment et le dépose dans la query, ce qui est exactement ce que fait la
 * plateforme et ce que les gestionnaires attendent.
 */
async function collectRoutes(dir = join(root, "api"), prefix = "/api") {
  const routes = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return routes;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      routes.push(...(await collectRoutes(full, `${prefix}/${entry.name}`)));
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;

    const base = entry.name.replace(/\.js$/, "");
    const param = /^\[(.+)\]$/.exec(base)?.[1];
    const path = base === "index" ? prefix : `${prefix}/${base}`;
    routes.push({ path, param, file: full, dir: prefix });
  }
  return routes;
}

const routes = await collectRoutes();

function matchRoute(pathname) {
  const exact = routes.find((r) => !r.param && r.path === pathname);
  if (exact) return { route: exact, params: {} };

  for (const route of routes) {
    if (!route.param) continue;
    if (!pathname.startsWith(`${route.dir}/`)) continue;
    const rest = pathname.slice(route.dir.length + 1);
    if (rest && !rest.includes("/")) {
      return { route, params: { [route.param]: decodeURIComponent(rest) } };
    }
  }
  return null;
}

/* --- Serveur -------------------------------------------------------------- */

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const started = Date.now();

  const log = () =>
    console.log(`  ${String(res.statusCode).padEnd(3)} ${req.method.padEnd(6)} ${url.pathname} ${Date.now() - started}ms`);

  if (url.pathname.startsWith("/api")) {
    const matched = matchRoute(url.pathname);
    if (!matched) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `Aucune route pour ${url.pathname}` }));
      return log();
    }

    // Les paramètres de chemin rejoignent la query, comme sur Vercel : le
    // gestionnaire lit query.slug sans savoir d'où il vient.
    for (const [key, value] of Object.entries(matched.params)) url.searchParams.set(key, value);
    req.url = `${url.pathname}?${url.searchParams}`;

    try {
      // Rechargé à chaque requête : éditer un gestionnaire ne demande pas de
      // redémarrer le serveur.
      const mod = await import(`${pathToFileURL(matched.route.file).href}?t=${Date.now()}`);
      await mod.default(req, res);
    } catch (error) {
      console.error(error);
      if (!res.writableEnded) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Erreur du serveur de développement", detail: error.message }));
      }
    }
    return log();
  }

  // Fichiers statiques, avec cleanUrls.
  const clean = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  let file = join(root, clean);
  if (!(await isFile(file)) && (await isFile(`${file}.html`))) file = `${file}.html`;

  if (!(await isFile(file)) || !file.startsWith(root)) {
    res.writeHead(404, { "content-type": TYPES[".html"] });
    res.end(await readFile(join(root, "404.html")));
    return log();
  }

  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(await readFile(file));
  log();
}).listen(port, () => {
  console.log(`\n  ELIEL EMMANUELA — http://localhost:${port}`);
  console.log(`  ${routes.length} route(s) d'API${process.env.DATABASE_URL ? "" : " — DATABASE_URL absent, /api répondra 503"}\n`);
});
