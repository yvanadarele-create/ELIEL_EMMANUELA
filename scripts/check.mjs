#!/usr/bin/env node
/**
 * Integrity check for the ELIEL EMMANUELA site.
 *
 * Runs with no browser and no server so it works in CI. It asserts the class of
 * breakage that a browser will not show you: a link that resolves to nothing, a
 * canonical left behind by a copy-paste, JSON-LD with a trailing comma, a nav
 * item added to one page out of nine, and — the one that actually costs money
 * here — an order button still pointing at the placeholder WhatsApp number.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const PLACEHOLDER_NUMBER = "2250000000000";

const pages = readdirSync(appRoot).filter((f) => f.endsWith(".html"));
const problems = [];
const warnings = [];
const read = (file) => readFileSync(join(appRoot, file), "utf8");

if (pages.length === 0) problems.push("no HTML pages found at the repository root");

/* --- Per page: metadata, ids, references ---------------------------------- */

for (const page of pages) {
  const html = read(page);
  const where = `${page}`;

  if (!/<html[^>]+lang="fr"/.test(html)) problems.push(`${where}: <html> is not lang="fr"`);
  if (!/<title>[^<]+<\/title>/.test(html)) problems.push(`${where}: missing <title>`);
  if (!/<meta name="description"/.test(html)) problems.push(`${where}: missing meta description`);
  if (!/<meta name="viewport"/.test(html)) problems.push(`${where}: missing viewport`);
  if (!/<a class="skip-link"/.test(html)) problems.push(`${where}: missing skip link`);

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  for (const dupe of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) {
    problems.push(`${where}: duplicate id #${dupe}`);
  }

  // Every local reference must resolve. Internal links are written as clean URLs
  // (vercel.json sets cleanUrls), so "/faq" has to be checked as "faq.html".
  for (const [, ref] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|tel:|data:|#|\/\/)/.test(ref)) continue;

    const [pathPart, frag] = ref.split("#");
    if (!pathPart) continue;
    const clean = pathPart.split("?")[0];
    const base = clean.startsWith("/") ? join(appRoot, clean.slice(1)) : resolve(appRoot, clean);

    const target = existsSync(base)
      ? base
      : existsSync(`${base}.html`)
        ? `${base}.html`
        : clean === "/"
          ? join(appRoot, "index.html")
          : null;

    if (!target) {
      problems.push(`${where}: broken reference -> ${ref}`);
      continue;
    }

    if (frag && target.endsWith(".html")) {
      if (!readFileSync(target, "utf8").includes(`id="${frag}"`)) {
        problems.push(`${where}: missing anchor -> ${ref}`);
      }
    }
  }

  for (const [, frag] of html.matchAll(/href="#([^"]+)"/g)) {
    if (!html.includes(`id="${frag}"`)) problems.push(`${where}: dead same-page anchor -> #${frag}`);
  }

  // <dl> may only contain <div>, <dt> and <dd>. A <li> in there is invalid and
  // breaks the term/description pairing screen readers announce.
  for (const [, body] of html.matchAll(/<dl[^>]*>([\s\S]*?)<\/dl>/g)) {
    if (/<li[\s>]/.test(body)) problems.push(`${where}: <li> inside a <dl> — use <div><dt>…<dd></div>`);
  }

  /* The masthead floats transparently over the first section, so its ink is
   * declared on <body> rather than inferred at runtime — cocoa-on-olive is
   * invisible, and it has to be right before any script runs. Asserted here
   * because the failure only shows on one page, above the fold, and only until
   * the visitor scrolls. */
  const firstStage = /<main id="main">[\s\S]*?<(?:section|div)[^>]*class="([^"]*\bstage\b[^"]*)"/.exec(html);
  if (!firstStage) {
    problems.push(`${where}: no .stage section inside <main>`);
  } else {
    const dark = /stage--(olive|emerald|cocoa)/.test(firstStage[1]);
    // L'attribut peut être accompagné d'autres (data-product, par exemple),
    // donc on le cherche dans la balise plutôt que collé au chevron fermant.
    const declared = /<body[^>]*\sdata-masthead-ink="light"/.test(html);
    if (dark && !declared) {
      problems.push(`${where}: opens on a dark stage but <body> lacks data-masthead-ink="light" — the masthead will be unreadable until the first scroll`);
    }
    if (!dark && declared) {
      problems.push(`${where}: declares data-masthead-ink="light" but opens on a light stage`);
    }
  }

  for (const [, body] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(body);
    } catch (error) {
      problems.push(`${where}: invalid JSON-LD — ${error.message}`);
    }
  }

  // An <img> with no alt attribute at all is a different failure from alt=""
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\salt=/.test(tag)) problems.push(`${where}: <img> without alt -> ${tag.slice(0, 70)}…`);
  }
}

/* --- Commerce: the order path --------------------------------------------
 *
 * The site takes no payment and has no cart: every sale leaves through a wa.me
 * link. A page without one is a dead end, and a placeholder number is a shop
 * with the door locked — neither is visible when you look at the page.
 */
for (const page of pages) {
  const html = read(page);
  const where = `${page}`;
  const links = [...html.matchAll(/href="(https:\/\/wa\.me\/[^"]*)"/g)].map((m) => m[1]);

  if (links.length === 0) {
    problems.push(`${where}: no WhatsApp order link — this page cannot lead to a sale`);
  }

  for (const link of links) {
    if (!/^https:\/\/wa\.me\/\d{8,15}(\?|$)/.test(link)) {
      problems.push(`${where}: malformed wa.me link -> ${link.slice(0, 60)}`);
    }
    if (link.includes("?text=") && /[ ]/.test(link)) {
      problems.push(`${where}: unencoded space in a wa.me prefilled message`);
    }
  }
}

const placeholders = pages.filter((page) => read(page).includes(`wa.me/${PLACEHOLDER_NUMBER}`));
if (placeholders.length) {
  warnings.push(
    `the WhatsApp number is still the placeholder on ${placeholders.length} page(s) — ` +
      `set whatsapp.primary/secondary in config/brand.json, then: npm run sync`,
  );
}

/* --- Shared chrome --------------------------------------------------------
 *
 * The masthead, drawer, footer and floating button are duplicated across every
 * page because the site has no template engine. Editing one by hand and
 * forgetting the rest is the obvious way to break that, and the result is a
 * single page with a stale menu — which nobody notices for months.
 */
const REGIONS = ["masthead", "drawer", "footer", "fab"];
const strip = (html) => html.replace(/\s+aria-current="page"/g, "");
const extract = (html, name) =>
  new RegExp(`<!-- @chrome:${name} -->\\n([\\s\\S]*?)\\n<!-- /@chrome:${name} -->`).exec(html)?.[1];

const canonicalHome = read("index.html");
for (const name of REGIONS) {
  const expected = extract(canonicalHome, name);
  if (expected === undefined) {
    problems.push(`index.html: missing @chrome:${name} region`);
    continue;
  }
  for (const page of pages) {
    if (page === "index.html") continue;
    const actual = extract(read(page), name);
    if (actual === undefined) {
      problems.push(`${page}: missing @chrome:${name} region`);
    } else if (strip(actual) !== strip(expected)) {
      problems.push(
        `${page}: @chrome:${name} has drifted from index.html — run node scripts/site.mjs`,
      );
    }
  }
}

/* --- Config regions -------------------------------------------------------
 *
 * The payment operators and the two WhatsApp lines are rendered from
 * config/brand.json between @data markers. An empty region means the config was
 * edited and the sync never run, and the page then silently shows nothing where
 * the ways to pay should be — invisible in review, fatal in use.
 */
for (const page of pages) {
  const html = read(page);
  for (const [, name, body] of html.matchAll(/<!-- @data:([a-z-]+) -->([\s\S]*?)<!-- \/@data:\1 -->/g)) {
    if (body.trim() === "") problems.push(`${page}: @data:${name} region is empty — run npm run sync`);
  }
  const opens = [...html.matchAll(/<!-- @data:([a-z-]+) -->/g)].map((m) => m[1]);
  const closes = [...html.matchAll(/<!-- \/@data:([a-z-]+) -->/g)].map((m) => m[1]);
  for (const name of opens) if (!closes.includes(name)) problems.push(`${page}: @data:${name} is never closed`);
  for (const name of closes) if (!opens.includes(name)) problems.push(`${page}: /@data:${name} closes a region that never opened`);
}

/* --- SEO ------------------------------------------------------------------ */

const titles = new Map();
const descriptions = new Map();
const canonicals = new Map();

for (const page of pages) {
  const html = read(page);
  const where = `${page}`;
  const noindex = /<meta name="robots"[^>]*content="[^"]*noindex/.test(html);

  const title = /<title>([^<]+)<\/title>/.exec(html)?.[1]?.trim();
  const description = /<meta name="description" content="([^"]+)"/.exec(html)?.[1]?.trim();
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];

  if (title) {
    if (titles.has(title)) problems.push(`${where}: duplicate <title> shared with ${titles.get(title)}`);
    else titles.set(title, where);
    if (title.length > 68) warnings.push(`${where}: title is ${title.length} chars — Google truncates near 60`);
  }

  if (description) {
    if (descriptions.has(description)) {
      problems.push(`${where}: duplicate meta description shared with ${descriptions.get(description)}`);
    } else descriptions.set(description, where);
    if (description.length > 170) {
      warnings.push(`${where}: meta description is ${description.length} chars — truncated near 160`);
    }
  }

  if (!noindex) {
    if (!canonical) problems.push(`${where}: missing canonical`);
    else if (canonicals.has(canonical)) {
      problems.push(`${where}: canonical points at the same URL as ${canonicals.get(canonical)}`);
    } else canonicals.set(canonical, where);

    if (!/<meta property="og:title"/.test(html)) warnings.push(`${where}: no og:title — link previews will guess`);
  }

  // Google only uses a favicon that is square and a multiple of 48px, and it
  // ignores SVG for that slot. A 32x32 icon silently yields the default globe.
  const declared = [...html.matchAll(/<link rel="icon"[^>]*>/g)].map((m) => m[0]);
  if (declared.length === 0) {
    problems.push(`${where}: no <link rel="icon"> — Google will show a default globe`);
  } else {
    const sizes = declared
      .map((tag) => /sizes="(\d+)x(\d+)"/.exec(tag))
      .filter(Boolean)
      .map((m) => [Number(m[1]), Number(m[2])]);

    if (!sizes.some(([w]) => w % 48 === 0)) {
      problems.push(`${where}: no favicon at a multiple of 48px — Google ignores other sizes`);
    }
    for (const [w, h] of sizes) {
      if (w !== h) problems.push(`${where}: favicon is not square (${w}x${h})`);
    }
  }
}

/* --- Sitemap, robots and the deployment config ---------------------------- */

// The site is served straight from the repository root, so vercel.json sits
// beside the pages it configures.
const vercelPath = join(appRoot, "vercel.json");
const cleanUrls = existsSync(vercelPath)
  ? JSON.parse(readFileSync(vercelPath, "utf8")).cleanUrls === true
  : false;
if (!existsSync(vercelPath)) problems.push("vercel.json: not found");

const sitemapPath = join(appRoot, "sitemap.xml");
if (!existsSync(sitemapPath)) {
  problems.push("sitemap.xml: not found");
} else {
  const sitemap = readFileSync(sitemapPath, "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  if (locs.length === 0) problems.push("sitemap.xml: no <loc> entries");

  const hosts = new Set(locs.map((loc) => new URL(loc).host));
  if (hosts.size > 1) problems.push(`sitemap.xml: mixes hosts (${[...hosts].join(", ")})`);
  const siteHost = [...hosts][0];

  for (const page of pages) {
    if (/<meta name="robots"[^>]*content="[^"]*noindex/.test(read(page))) continue;
    const expected = page === "index.html" ? "/" : cleanUrls ? `/${page.replace(/\.html$/, "")}` : `/${page}`;
    if (!locs.some((loc) => new URL(loc).pathname === expected)) {
      problems.push(`sitemap.xml: ${page} is not listed (expected ${expected})`);
    }
  }

  // With cleanUrls the server serves /faq and redirects /faq.html, so a sitemap
  // of .html URLs is a sitemap of redirects — reported as an error, invisible
  // in a browser.
  if (cleanUrls) {
    for (const loc of locs) {
      if (loc.endsWith(".html")) problems.push(`sitemap.xml: ${loc} redirects under cleanUrls`);
    }
  }

  for (const [canonical, where] of canonicals) {
    const url = new URL(canonical);
    if (siteHost && url.host !== siteHost) {
      problems.push(`${where}: canonical host ${url.host} does not match the sitemap's ${siteHost}`);
    }
    if (cleanUrls && canonical.endsWith(".html")) {
      problems.push(`${where}: canonical points at a URL that redirects — drop the .html`);
    }
    if (!locs.includes(canonical)) problems.push(`${where}: canonical ${canonical} is not in the sitemap`);
  }

  const robotsPath = join(appRoot, "robots.txt");
  if (!existsSync(robotsPath)) {
    problems.push("robots.txt: not found");
  } else {
    const declared = /^Sitemap:\s*(\S+)$/m.exec(readFileSync(robotsPath, "utf8"))?.[1];
    if (!declared) problems.push("robots.txt: no Sitemap: line");
    else if (siteHost && new URL(declared).host !== siteHost) {
      problems.push(`robots.txt: Sitemap host ${new URL(declared).host} does not match ${siteHost}`);
    }
  }
}

/* --- Assets ---------------------------------------------------------------
 *
 * The stylesheet's unicode-range blocks have to keep naming files that exist:
 * a renamed font silently falls back to the system serif and the whole brand
 * voice goes with it.
 */
const cssPath = join(appRoot, "assets/css/main.css");
if (!existsSync(cssPath)) {
  problems.push("assets/css/main.css: not found");
} else {
  const css = readFileSync(cssPath, "utf8");
  for (const [, ref] of css.matchAll(/url\("([^"]+)"\)/g)) {
    const target = resolve(appRoot, "assets/css", ref);
    if (!existsSync(target)) {
      problems.push(`assets/css/main.css: missing ${relative(appRoot, target)}`);
    }
  }
}

const manifestPath = join(appRoot, "site.webmanifest");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const icon of manifest.icons ?? []) {
    if (!existsSync(join(appRoot, icon.src.replace(/^\//, "")))) {
      problems.push(`site.webmanifest: missing icon ${icon.src}`);
    }
  }
} else {
  problems.push("site.webmanifest: not found");
}

/* --- Report --------------------------------------------------------------- */

for (const w of warnings) console.warn(`  ! ${w}`);

if (problems.length) {
  console.error(`eliel integrity: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log(
  `eliel integrity: OK — ${pages.length} pages, all references resolve` +
    (warnings.length ? ` (${warnings.length} warning(s))` : ""),
);
