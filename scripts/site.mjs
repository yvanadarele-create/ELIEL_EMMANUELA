#!/usr/bin/env node
/**
 * Writes the deployment-specific facts into every page, from one place.
 *
 * Three classes of value are scattered across nine hand-written HTML files, and
 * every one of them is invisible when it is wrong:
 *
 *   1. **The base URL.** Canonicals, Open Graph URLs, JSON-LD `url`/`@id` and the
 *      sitemap each carry an absolute address. Change the domain and Search
 *      Console rejects the sitemap as "URLs not on this site" — which reads as a
 *      broken file rather than a one-word mismatch.
 *
 *   2. **The contact details.** The brand's WhatsApp number, its Instagram and
 *      TikTok handles and its e-mail address are the whole checkout: the site
 *      takes no payment and has no cart. They ship as placeholders, and a
 *      placeholder WhatsApp number is a shop with the door locked.
 *
 *   3. **The shared chrome.** The masthead, the drawer, the footer and the
 *      floating WhatsApp button are repeated on every page because the site has
 *      no template engine. Adding a nav link by hand means nine identical edits
 *      and one page that quietly keeps the old menu.
 *
 * So all three are derived here. index.html is the source of truth for the
 * chrome; the environment is the source of truth for everything else:
 *
 *     ELIEL_WHATSAPP="225 07 00 00 00 00" \
 *     ELIEL_INSTAGRAM=elielemmanuela \
 *     ELIEL_TIKTOK=elielemmanuela \
 *     ELIEL_EMAIL=contact@elielemmanuela.com \
 *     SITE_URL=https://elielemmanuela.com \
 *       node scripts/site.mjs
 *
 * Every variable is optional; an unset one leaves what is already committed.
 * The script is idempotent, so running it twice changes nothing the second time.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");

const DEFAULT_SITE = "https://elielemmanuela.com";
const PLACEHOLDER_NUMBER = "2250000000000";

/* --- Inputs --------------------------------------------------------------- */

const normaliseUrl = (value) =>
  (/^https?:\/\//.test(value) ? value : `https://${value}`).replace(/\/+$/, "");

function resolveBaseUrl() {
  const explicit = process.env.ELIEL_SITE_URL || process.env.SITE_URL || process.env.PUBLIC_BASE_URL;
  if (explicit) return normaliseUrl(explicit);

  // Vercel's production domain, not VERCEL_URL: the latter is the per-deployment
  // hostname and would bake a throwaway preview domain into the canonicals.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? normaliseUrl(vercel) : DEFAULT_SITE;
}

const site = resolveBaseUrl();
const handle = (value) => value?.trim().replace(/^@/, "");

const contact = {
  // wa.me wants digits only; the displayed form keeps whatever spacing was given.
  whatsapp: process.env.ELIEL_WHATSAPP?.replace(/\D/g, ""),
  whatsappDisplay: process.env.ELIEL_WHATSAPP?.trim(),
  instagram: handle(process.env.ELIEL_INSTAGRAM),
  tiktok: handle(process.env.ELIEL_TIKTOK),
  email: process.env.ELIEL_EMAIL?.trim(),
};

/* --- Shared chrome -------------------------------------------------------- */

/**
 * Each region is delimited by the markers below. index.html holds the canonical
 * copy; the others are overwritten from it. `aria-current` is stripped before
 * comparison and re-applied per page, so the chrome can be byte-identical while
 * each page still marks its own nav entry without needing JavaScript.
 */
const REGIONS = ["masthead", "drawer", "footer", "fab"];

const region = (html, name) => {
  const pattern = new RegExp(`(<!-- @chrome:${name} -->\\n)([\\s\\S]*?)(\\n<!-- /@chrome:${name} -->)`);
  return pattern.exec(html);
};

/** The clean URL a page is served at, matching `cleanUrls` in vercel.json. */
const pathOf = (file) => (file === "index.html" ? "/" : `/${file.replace(/\.html$/, "")}`);

const stripCurrent = (html) => html.replace(/\s+aria-current="page"/g, "");

const applyCurrent = (html, path) =>
  html.replace(/<a([^>]*?)href="([^"]+)"([^>]*)>/g, (match, before, href, after) =>
    href === path ? `<a${before}href="${href}"${after} aria-current="page">` : match,
  );

/* --- Rewrites ------------------------------------------------------------- */

const pages = readdirSync(appRoot).filter((f) => f.endsWith(".html"));
const source = readFileSync(join(appRoot, "index.html"), "utf8");

/**
 * The base URL currently written into the files. Taken from the home page's own
 * canonical rather than assumed, so this works after any number of previous runs
 * against any number of domains.
 */
const previousSite = /<link rel="canonical" href="(https?:\/\/[^/"]+)/.exec(source)?.[1];

const canonicalChrome = {};
for (const name of REGIONS) {
  const found = region(source, name);
  if (!found) {
    console.error(`eliel-site: index.html has no @chrome:${name} region — cannot sync`);
    process.exit(1);
  }
  canonicalChrome[name] = stripCurrent(found[2]);
}

let touched = 0;

for (const file of pages) {
  const path = join(appRoot, file);
  const before = readFileSync(path, "utf8");
  let html = before;

  // 1. Shared chrome
  for (const name of REGIONS) {
    const found = region(html, name);
    if (!found) {
      console.error(`eliel-site: ${file} has no @chrome:${name} region`);
      process.exit(1);
    }
    html = html.replace(found[0], `${found[1]}${applyCurrent(canonicalChrome[name], pathOf(file))}${found[3]}`);
  }

  // 2. Base URL. A literal swap of the previous base for the new one, rather
  //    than a pattern for "an absolute URL": schema.org, wa.me, instagram.com
  //    and tiktok.com are third parties that must survive untouched, and no
  //    regex that recognises "our own host" stays correct once the host changes.
  if (previousSite && previousSite !== site) {
    html = html.split(previousSite).join(site);
  }

  // 3. Contact details
  if (contact.whatsapp) {
    html = html.replace(/https:\/\/wa\.me\/\d+/g, `https://wa.me/${contact.whatsapp}`);
    html = html.replace(/href="tel:\+\d+"/g, `href="tel:+${contact.whatsapp}"`);
  }
  if (contact.whatsappDisplay) {
    html = html.replace(
      /(<a[^>]*data-contact="tel"[^>]*>)[^<]*(<\/a>)/g,
      (_, open, close) => `${open}+${contact.whatsappDisplay.replace(/^\+/, "")}${close}`,
    );
  }
  if (contact.instagram) {
    html = html.replace(/https:\/\/instagram\.com\/[A-Za-z0-9._]+/g, `https://instagram.com/${contact.instagram}`);
    html = html.replace(
      /(<a[^>]*data-contact="instagram"[^>]*>)@[A-Za-z0-9._]+(<\/a>)/g,
      (_, open, close) => `${open}@${contact.instagram}${close}`,
    );
  }
  if (contact.tiktok) {
    html = html.replace(/https:\/\/tiktok\.com\/@[A-Za-z0-9._]+/g, `https://tiktok.com/@${contact.tiktok}`);
    html = html.replace(
      /(<a[^>]*data-contact="tiktok"[^>]*>)@[A-Za-z0-9._]+(<\/a>)/g,
      (_, open, close) => `${open}@${contact.tiktok}${close}`,
    );
  }
  if (contact.email) {
    html = html.replace(/mailto:[^"']+/g, `mailto:${contact.email}`);
    html = html.replace(
      /(<a[^>]*data-contact="email"[^>]*>)[^<]*(<\/a>)/g,
      (_, open, close) => `${open}${contact.email}${close}`,
    );
  }

  if (html !== before) {
    writeFileSync(path, html);
    touched++;
  }
}

/* --- Sitemap and robots --------------------------------------------------- */

const indexable = pages
  .filter((file) => !/<meta name="robots"[^>]*content="[^"]*noindex/.test(readFileSync(join(appRoot, file), "utf8")))
  .map(pathOf)
  .sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));

const priority = (path) =>
  path === "/" ? "1.0" : /creme-cheveux|savon-noir/.test(path) ? "0.9" : path === "/avis" ? "0.7" : "0.6";

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexable.map((path) => `  <url><loc>${site}${path}</loc><priority>${priority(path)}</priority></url>`).join("\n")}
</urlset>
`;
writeFileSync(join(appRoot, "sitemap.xml"), sitemap);

writeFileSync(
  join(appRoot, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`,
);

/* --- Report --------------------------------------------------------------- */

const missing = Object.entries({
  ELIEL_WHATSAPP: contact.whatsapp,
  ELIEL_INSTAGRAM: contact.instagram,
  ELIEL_TIKTOK: contact.tiktok,
  ELIEL_EMAIL: contact.email,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);

console.log(`eliel-site: ${site} — ${pages.length} pages, ${touched} rewritten, sitemap has ${indexable.length} URLs`);

if (readFileSync(join(appRoot, "index.html"), "utf8").includes(`wa.me/${PLACEHOLDER_NUMBER}`)) {
  console.warn(
    `  ! the WhatsApp number is still the placeholder — every "Commander" button leads nowhere.\n` +
      `    Set ${missing.join(", ") || "ELIEL_WHATSAPP"} and re-run.`,
  );
}
