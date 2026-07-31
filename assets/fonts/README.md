# Fonts

Two variable families, self-hosted, subset by Google Fonts into `latin` and
`latin-ext` ranges. They are served from this origin rather than from
`fonts.gstatic.com` on purpose: most of the traffic arrives through the Instagram
and TikTok in-app browsers on an Abidjan mobile network, where a second DNS
lookup plus TLS handshake costs more than these files do.

| File | Family | Styles | Used for |
| --- | --- | --- | --- |
| `cormorant-var-latin.woff2` | Cormorant Garamond | 300–700 | headings, prices |
| `cormorant-var-latin-ext.woff2` | Cormorant Garamond | 300–700 | as above, extended Latin |
| `cormorant-italic-var-latin.woff2` | Cormorant Garamond | 300–700 italic | accent words, pull quotes |
| `cormorant-italic-var-latin-ext.woff2` | Cormorant Garamond | 300–700 italic | as above, extended Latin |
| `manrope-var-latin.woff2` | Manrope | 300–800 | body copy, labels, buttons |
| `manrope-var-latin-ext.woff2` | Manrope | 300–800 | as above, extended Latin |

Both families are licensed under the SIL Open Font License 1.1, which permits
self-hosting and redistribution.

The `unicode-range` declarations in `assets/css/main.css` must keep matching the
subsets above. If a family is re-downloaded from Google Fonts, copy the ranges
from the generated `@font-face` blocks as well — a stale range makes the browser
skip a file it actually needs, and accented characters silently fall back to the
system serif.

Only `cormorant-var-latin.woff2` and `manrope-var-latin.woff2` are preloaded.
French text lives almost entirely in the `latin` range; preloading the extended
files too would cost bandwidth on the critical path for characters most pages
never use.
