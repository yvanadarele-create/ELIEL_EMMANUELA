#!/usr/bin/env node
/**
 * Generates the raster brand assets for the site that a vector file cannot cover.
 *
 * Three things need real pixels and nothing else in this repo produces them:
 *
 *   1. **Search favicons.** Google only shows a favicon that is square and a
 *      multiple of 48px, and it ignores SVG for that slot. A site with only an
 *      SVG icon gets the default globe in search results.
 *   2. **`apple-touch-icon.png`.** iOS home-screen shortcuts do not read SVG.
 *   3. **The Open Graph card.** WhatsApp, Instagram DMs and Facebook all refuse
 *      SVG previews, and the brand arrives almost entirely through shared links.
 *
 * There is no ImageMagick, no PIL and no headless renderer in the build image, so
 * the drawing is done here: an anti-aliased scanline rasteriser over a stroke
 * alphabet, encoded to PNG with zlib. Output is committed, so a normal build and
 * a normal deploy never run this. Re-run it after a change to the mark:
 *
 *     node scripts/eliel-assets.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const imgRoot = resolve(here, "../assets/img");
mkdirSync(imgRoot, { recursive: true });

/* --- Palette (mirrors assets/css/main.css) -------------------------------- */

const OLIVE = [0x0e, 0x3b, 0x33];
const EMERALD = [0x1f, 0x5a, 0x4e];
const GOLD = [0xc8, 0xa9, 0x6b];
const SAND = [0xf5, 0xef, 0xe6];

/* --- Canvas --------------------------------------------------------------- */

/** RGB float canvas. Alpha is always 1: every asset here is fully opaque. */
function canvas(w, h) {
  return { w, h, px: new Float64Array(w * h * 3) };
}

function fill(c, at) {
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const rgb = at(x / c.w, y / c.h);
      const i = (y * c.w + x) * 3;
      c.px[i] = rgb[0];
      c.px[i + 1] = rgb[1];
      c.px[i + 2] = rgb[2];
    }
  }
}

function blend(c, x, y, rgb, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 3;
  const k = a > 1 ? 1 : a;
  c.px[i] += (rgb[0] - c.px[i]) * k;
  c.px[i + 1] += (rgb[1] - c.px[i + 1]) * k;
  c.px[i + 2] += (rgb[2] - c.px[i + 2]) * k;
}

/**
 * Paints every pixel whose supersampled centre satisfies `inside`, restricted to
 * a bounding box. The box keeps the cost proportional to the mark rather than to
 * the canvas, which matters for the 1200x630 card.
 */
function paint(c, box, rgb, inside, samples = 3) {
  const x0 = Math.max(0, Math.floor(box[0]));
  const y0 = Math.max(0, Math.floor(box[1]));
  const x1 = Math.min(c.w - 1, Math.ceil(box[2]));
  const y1 = Math.min(c.h - 1, Math.ceil(box[3]));
  const step = 1 / samples;
  const total = samples * samples;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          if (inside(x + (sx + 0.5) * step, y + (sy + 0.5) * step)) hits++;
        }
      }
      if (hits) blend(c, x, y, rgb, hits / total);
    }
  }
}

/* --- Shapes --------------------------------------------------------------- */

/** Distance from a point to a segment, used for every stroked path. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function strokePath(c, points, width, rgb) {
  const r = width / 2;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const box = [
      Math.min(ax, bx) - r - 1,
      Math.min(ay, by) - r - 1,
      Math.max(ax, bx) + r + 1,
      Math.max(ay, by) + r + 1,
    ];
    paint(c, box, rgb, (x, y) => distToSegment(x, y, ax, ay, bx, by) <= r);
  }
}

/**
 * The house mark: a Moroccan pointed-horseshoe arch.
 *
 * Built as the intersection of two circles whose centres are pulled apart
 * horizontally, which produces the point at the crown, sitting on straight
 * jambs. Drawn as a filled silhouette because at 16px an outline disappears.
 */
function archInside(cx, baseY, halfW, jambH) {
  const offset = halfW * 0.36;
  const r = halfW + offset;
  const springY = baseY - jambH;
  return (x, y) => {
    if (y > baseY) return false;
    if (y > springY) return Math.abs(x - cx) <= halfW;
    const dxL = x - cx - offset;
    const dxR = x - cx + offset;
    const dy = y - springY;
    return dxL * dxL + dy * dy <= r * r && dxR * dxR + dy * dy <= r * r;
  };
}

function drawArch(c, cx, baseY, halfW, jambH, rgb) {
  const crown = baseY - jambH - Math.sqrt((halfW * 1.36) ** 2 - (halfW * 0.36) ** 2);
  paint(c, [cx - halfW - 2, crown - 2, cx + halfW + 2, baseY + 2], rgb, archInside(cx, baseY, halfW, jambH));
}

/* --- Stroke alphabet ------------------------------------------------------
 *
 * Geometric capitals on a 0..1 box (y=0 is the cap line, y=1 the baseline), each
 * glyph a list of polylines. Only what the cards actually set is defined; an
 * undefined character throws rather than rendering a silent gap.
 */
const arc = (cx, cy, rx, ry, from, to, steps = 14) =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });

const GLYPHS = {
  A: { w: 0.78, paths: [[[0, 1], [0.39, 0], [0.78, 1]], [[0.14, 0.64], [0.64, 0.64]]] },
  B: {
    w: 0.72,
    paths: [
      [[0, 0], [0, 1]],
      [[0, 0], [0.4, 0], ...arc(0.4, 0.25, 0.3, 0.25, -90, 90), [0, 0.5]],
      [[0, 0.5], [0.42, 0.5], ...arc(0.42, 0.75, 0.3, 0.25, -90, 90), [0, 1]],
    ],
  },
  // Angles run clockwise from "east" because y grows downward: 270 is the top of
  // a circle, 90 the bottom. Sweeping 305 -> 55 therefore leaves the gap on the
  // right, which is what makes a C rather than a broken O.
  C: { w: 0.74, paths: [arc(0.37, 0.5, 0.37, 0.5, 305, 55, 24)] },
  D: { w: 0.74, paths: [[[0, 0], [0, 1]], [[0, 0], [0.36, 0], ...arc(0.36, 0.5, 0.38, 0.5, -90, 90), [0, 1]]] },
  E: { w: 0.62, paths: [[[0, 0], [0, 1]], [[0, 0], [0.62, 0]], [[0, 0.5], [0.5, 0.5]], [[0, 1], [0.62, 1]]] },
  F: { w: 0.6, paths: [[[0, 0], [0, 1]], [[0, 0], [0.6, 0]], [[0, 0.5], [0.48, 0.5]]] },
  G: { w: 0.78, paths: [[...arc(0.39, 0.5, 0.39, 0.5, 305, 20, 24), [0.78, 0.5], [0.48, 0.5]]] },
  H: { w: 0.72, paths: [[[0, 0], [0, 1]], [[0.72, 0], [0.72, 1]], [[0, 0.5], [0.72, 0.5]]] },
  I: { w: 0.06, paths: [[[0.03, 0], [0.03, 1]]] },
  J: { w: 0.56, paths: [[[0.56, 0], [0.56, 0.72], ...arc(0.28, 0.72, 0.28, 0.28, 0, 180)]] },
  K: { w: 0.7, paths: [[[0, 0], [0, 1]], [[0.68, 0], [0, 0.56]], [[0.24, 0.4], [0.7, 1]]] },
  L: { w: 0.58, paths: [[[0, 0], [0, 1], [0.58, 1]]] },
  M: { w: 0.88, paths: [[[0, 1], [0, 0], [0.44, 0.72], [0.88, 0], [0.88, 1]]] },
  N: { w: 0.74, paths: [[[0, 1], [0, 0], [0.74, 1], [0.74, 0]]] },
  O: { w: 0.82, paths: [arc(0.41, 0.5, 0.41, 0.5, 0, 360, 32)] },
  P: { w: 0.68, paths: [[[0, 1], [0, 0], [0.36, 0], ...arc(0.36, 0.28, 0.32, 0.28, -90, 90), [0, 0.56]]] },
  Q: { w: 0.82, paths: [arc(0.41, 0.5, 0.41, 0.5, 0, 360, 32), [[0.56, 0.72], [0.86, 1.06]]] },
  R: { w: 0.72, paths: [[[0, 1], [0, 0], [0.36, 0], ...arc(0.36, 0.26, 0.3, 0.26, -90, 90), [0, 0.52]], [[0.3, 0.52], [0.72, 1]]] },
  // Two half-ellipses meeting at the waist (0.33, 0.5): the upper one sweeps
  // top-right -> over -> waist, the lower one waist -> right -> under -> bottom-left.
  S: {
    w: 0.66,
    paths: [[...arc(0.33, 0.25, 0.31, 0.25, 340, 90, 16), ...arc(0.33, 0.75, 0.31, 0.25, 270, 520, 18).slice(1)]],
  },
  T: { w: 0.68, paths: [[[0, 0], [0.68, 0]], [[0.34, 0], [0.34, 1]]] },
  U: { w: 0.74, paths: [[[0, 0], [0, 0.63], ...arc(0.37, 0.63, 0.37, 0.37, 180, 0, 18), [0.74, 0]]] },
  V: { w: 0.76, paths: [[[0, 0], [0.38, 1], [0.76, 0]]] },
  W: { w: 1.06, paths: [[[0, 0], [0.24, 1], [0.53, 0.24], [0.82, 1], [1.06, 0]]] },
  X: { w: 0.72, paths: [[[0, 0], [0.72, 1]], [[0.72, 0], [0, 1]]] },
  Y: { w: 0.72, paths: [[[0, 0], [0.36, 0.52], [0.72, 0]], [[0.36, 0.52], [0.36, 1]]] },
  Z: { w: 0.68, paths: [[[0, 0], [0.68, 0], [0, 1], [0.68, 1]]] },
  " ": { w: 0.34, paths: [] },
  "·": { w: 0.16, paths: [arc(0.08, 0.5, 0.05, 0.05, 0, 360, 10)] },
  "'": { w: 0.14, paths: [[[0.07, 0], [0.05, 0.26]]] },
  "-": { w: 0.44, paths: [[[0.04, 0.52], [0.4, 0.52]]] },
};

/** Diacritics ride above the cap line, so the line box leaves room for them. */
const ACCENTS = {
  É: ["E", [[0.2, -0.18], [0.44, -0.34]]],
  È: ["E", [[0.2, -0.34], [0.44, -0.18]]],
  Ê: ["E", [[0.16, -0.18], [0.32, -0.36], [0.48, -0.18]]],
  Ô: ["O", [[0.25, -0.18], [0.41, -0.36], [0.57, -0.18]]],
  À: ["A", [[0.27, -0.34], [0.51, -0.18]]],
};

function glyph(ch) {
  if (GLYPHS[ch]) return GLYPHS[ch];
  const accent = ACCENTS[ch];
  if (accent) {
    const base = GLYPHS[accent[0]];
    return { w: base.w, paths: [...base.paths, accent[1]] };
  }
  throw new Error(`eliel-assets: no glyph for "${ch}" — add it to GLYPHS`);
}

function textWidth(text, size, tracking) {
  let w = 0;
  for (const ch of text) w += glyph(ch).w * size + tracking;
  return w - tracking;
}

/** Draws `text` with its left edge at x and its cap line at y. */
function drawText(c, text, x, y, size, tracking, weight, rgb) {
  let cursor = x;
  for (const ch of text) {
    const g = glyph(ch);
    for (const path of g.paths) {
      strokePath(c, path.map(([px, py]) => [cursor + px * size, y + py * size]), weight, rgb);
    }
    cursor += g.w * size + tracking;
  }
}

const centred = (c, text, y, size, tracking, weight, rgb) =>
  drawText(c, text, (c.w - textWidth(text, size, tracking)) / 2, y, size, tracking, weight, rgb);

/* --- PNG encoding --------------------------------------------------------- */

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(c) {
  const raw = Buffer.alloc(c.h * (c.w * 3 + 1));
  let p = 0;
  for (let y = 0; y < c.h; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < c.w; x++) {
      const i = (y * c.w + x) * 3;
      raw[p++] = Math.round(Math.max(0, Math.min(255, c.px[i])));
      raw[p++] = Math.round(Math.max(0, Math.min(255, c.px[i + 1])));
      raw[p++] = Math.round(Math.max(0, Math.min(255, c.px[i + 2])));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** An .ico that simply wraps a PNG — the format has allowed this since Vista. */
function encodeIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32BE(0, 8);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12); // offset of the payload
  return Buffer.concat([header, entry, png]);
}

/* --- The assets ----------------------------------------------------------- */

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Square app icon: gold arch on the Moroccan olive ground. */
function icon(size) {
  const c = canvas(size, size);
  fill(c, (_, v) => mix(EMERALD, OLIVE, v * 0.9));

  const halfW = size * 0.235;
  const baseY = size * 0.775;
  drawArch(c, size / 2, baseY, halfW, size * 0.17, GOLD);

  // A sand keyhole inside the arch keeps the silhouette legible at 16px.
  if (size >= 96) {
    const inner = archInside(size / 2, baseY - size * 0.105, halfW * 0.5, size * 0.1);
    paint(c, [size * 0.3, size * 0.2, size * 0.7, baseY], SAND, inner);
  }
  return c;
}

/** Open Graph / WhatsApp share card, 1200x630. */
function ogCard() {
  const c = canvas(1200, 630);
  fill(c, (u, v) => {
    const glow = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.22) * 1.5);
    return mix(mix(OLIVE, EMERALD, v * 0.55), GOLD, glow * 0.07);
  });

  // Hairline frame
  const inset = 34;
  for (const path of [
    [[inset, inset], [1200 - inset, inset]],
    [[1200 - inset, inset], [1200 - inset, 630 - inset]],
    [[1200 - inset, 630 - inset], [inset, 630 - inset]],
    [[inset, 630 - inset], [inset, inset]],
  ]) {
    strokePath(c, path, 1.6, mix(OLIVE, GOLD, 0.55));
  }

  drawArch(c, 600, 176, 34, 26, GOLD);

  centred(c, "RITUELS DE BEAUTÉ MAROCAINE", 226, 17, 9, 1.9, mix(OLIVE, GOLD, 0.9));
  centred(c, "ELIEL EMMANUELA", 300, 74, 15, 4.2, SAND);

  const ruleY = 452;
  strokePath(c, [[420, ruleY], [560, ruleY]], 1.4, mix(OLIVE, GOLD, 0.7));
  strokePath(c, [[640, ruleY], [780, ruleY]], 1.4, mix(OLIVE, GOLD, 0.7));
  paint(c, [592, ruleY - 8, 608, ruleY + 8], GOLD, (x, y) => Math.abs(x - 600) + Math.abs(y - ruleY) <= 6);

  centred(c, "SAVON NOIR · CRÈME CHEVEUX NATURELS", 508, 21, 8, 2, mix(OLIVE, SAND, 0.82));
  return c;
}

const write = (name, buf) => {
  writeFileSync(join(imgRoot, name), buf);
  console.log(`  ${name.padEnd(24)} ${(buf.length / 1024).toFixed(1)} kB`);
};

console.log("eliel assets →", imgRoot);
for (const size of [48, 96, 192, 512]) write(`icon-${size}.png`, encodePng(icon(size)));
write("apple-touch-icon.png", encodePng(icon(180)));
write("favicon.ico", encodeIco(encodePng(icon(48)), 48));
write("og-image.png", encodePng(ogCard()));
