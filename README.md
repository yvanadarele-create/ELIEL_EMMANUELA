# ELIEL_EMMANUELA
**ELIEL EMMANUELA** is a premium yet affordable Moroccan-inspired beauty website for women aged 18–35, featuring **Natural Hair Cream** and **Authentic Moroccan Black Soap**
# ELIEL EMMANUELA — Premium Moroccan Beauty Experience

A luxury-inspired beauty website crafted for **ELIEL EMMANUELA**, a premium yet affordable African beauty brand specializing in **Moroccan Black Soap** and **Natural Hair Cream** for women aged **18–35**.

This project is designed to deliver a **high-end editorial web experience** inspired by **Awwwards-level aesthetics**, combining **soft feminine elegance** with **authentic Moroccan spa luxury** through a unique **scroll-based color transition** from **blush pink** to **deep olive green**.

---

## ✨ Brand Vision

**ELIEL EMMANUELA** brings together two complementary beauty rituals:

* **Natural Hair Care** — softness, nourishment, confidence, and feminine elegance.
* **Authentic Moroccan Black Soap** — purification, glow, self-care, and timeless Moroccan beauty traditions.

The website is intentionally designed to feel **far more premium than the product prices**, creating a strong **luxury-perception / affordable-accessibility** balance.

---

## 🎨 Design Concept

### Scroll Journey

The homepage tells a visual story through color and atmosphere:

1. **Blush Pink Universe** — Hair Care
2. **Warm Neutral Transition**
3. **Deep Olive Moroccan Universe** — Black Soap

This cinematic transition creates an immersive emotional experience rather than a traditional e-commerce layout.

---

## 🖥️ Website Features

### Homepage

* Full-screen luxury hero section
* Editorial typography with cinematic spacing
* Smooth scrolling and subtle parallax effects
* Animated product reveals
* Testimonial highlights
* WhatsApp order integration
* Premium CTA sections

### Product Pages

* High-quality product imagery
* Ingredient highlights
* Usage instructions
* Benefits and target hair/skin types
* Customer reviews
* FAQ accordion
* Mobile-optimized purchase flow

### Additional Pages

* About Us
* Reviews
* FAQ
* Contact
* Shipping & Returns

---

## 🌿 Product Collection

### Natural Hair Cream

* **Price:** 1000F CFA
* Target: women seeking soft, hydrated, manageable natural hair
* Positioning: feminine, modern, everyday luxury

### Moroccan Black Soap

* **Price:** 3000F CFA
* Target: women looking for authentic natural cleansing and glowing skin
* Positioning: Moroccan spa ritual, premium self-care

---

## 🎨 Color Palette

### Hair Care Palette

| Color          | Hex       |
| -------------- | --------- |
| Powder Blush   | `#F7E7E7` |
| Soft Rose      | `#EEDADA` |
| Champagne Gold | `#D4B08C` |
| Deep Cocoa     | `#2A1F1B` |

### Moroccan Black Soap Palette

| Color         | Hex       |
| ------------- | --------- |
| Royal Olive   | `#0E3B33` |
| Emerald Olive | `#1F5A4E` |
| Moroccan Gold | `#C8A96B` |
| Warm Sand     | `#F5EFE6` |

---

## 🔤 Typography

| Usage           | Font                          |
| --------------- | ----------------------------- |
| Headings        | **Cormorant Garamond**        |
| Body Text       | **Manrope**                   |
| Accent / Quotes | **Cormorant Garamond Italic** |

This pairing creates a **fashion-editorial + modern luxury** aesthetic.

---

## 🚀 Technical Direction

The project is intended for a **custom Shopify, Next.js, or Framer implementation** with a strong focus on performance and visual polish.

### Suggested Stack

* **Next.js**
* **React**
* **Tailwind CSS**
* **Framer Motion**
* **Lenis** for smooth scrolling
* **GSAP** for advanced animations

---

## 📱 Mobile-First Experience

Because most customers will arrive from **Instagram and TikTok**, the interface is optimized for:

* Full-screen mobile storytelling
* Thumb-friendly navigation
* Sticky WhatsApp order button
* Fast product access in under **3 taps**
* Lightweight animations for smooth performance on mobile networks

---

## 🏆 Inspiration

The visual direction is inspired by:

* **Awwwards**
* **Luxury spa websites**
* **Editorial fashion websites**
* **Premium African beauty brands**
* **Modern Moroccan wellness aesthetics**

The goal is to achieve the feeling of a **$10,000 custom-designed beauty website** while remaining accessible to a growing premium African brand.

---

## 💎 Brand Essence

> **ELIEL EMMANUELA — Premium Moroccan-inspired beauty rituals for young African women who want natural results, elegant design, and affordable luxury.**

---

## 📸 Visual Identity

### Hair Care Identity

* Blush pink background
* Soft feminine lighting
* Gold botanical accents
* Confident natural hair representation

### Moroccan Soap Identity

* Deep olive green background
* Moroccan arch motifs
* Gold ornamental details
* Spa-inspired luxury atmosphere

Together, these two identities create a **distinctive dual-universe beauty experience** that sets **ELIEL EMMANUELA** apart from conventional cosmetic e-commerce brands.

---

## 📬 Contact

**ELIEL EMMANUELA**
Premium Moroccan Black Soap & Natural Hair Care
Abidjan, Côte d’Ivoire

* WhatsApp: *Add your number*
* Instagram: *Add your handle*
* TikTok: *Add your handle*
* Email: *Add your email*

---

### ✨ “Le rituel d’une beauté naturellement sublime.”

---
---

# 🛠️ Le site — mode d'emploi

Ce dépôt **est** le site : HTML, CSS et JavaScript statiques, servis tels quels.
Pas de framework, pas de bundler, pas d'étape de build. Ce qui est commité est
ce qui est publié.

```bash
npm run dev     # http://localhost:4200
npm test        # vérifie l'intégrité du site, sans navigateur
```

> **Note sur la langue.** Le site est en français. La marque vend à Abidjan, en
> F CFA, et prend ses commandes sur WhatsApp : le français est la langue de la
> cliente, pas une traduction.

## ⚠️ Avant la première commande

Chaque vente sort du site par un lien `wa.me` — il n'y a ni panier ni page de
paiement. Les fichiers commités contiennent un **numéro WhatsApp de
remplacement**, donc tant qu'il n'est pas remplacé, **aucun bouton
« Commander » ne fonctionne**. `npm run sync` et `npm test` le signalent à
chaque exécution.

```bash
ELIEL_WHATSAPP="225 07 00 00 00 00" \
ELIEL_INSTAGRAM=elielemmanuela \
ELIEL_TIKTOK=elielemmanuela \
ELIEL_EMAIL=contact@elielemmanuela.com \
SITE_URL=https://elielemmanuela.com \
  npm run sync
```

Commitez le résultat. Chaque variable est facultative : une variable non
définie laisse ce qui est déjà en place, le numéro peut donc être posé
aujourd'hui et le domaine le mois prochain.

## ⚙️ Configuration

`config/brand.json` est la source de vérité unique pour tout ce qui change sans
toucher au design : les **deux numéros WhatsApp**, les réseaux sociaux, les
**opérateurs de paiement acceptés** et la devise. Rien de secret n’y figure —
le fichier est public et commité exprès.

Modifiez-le, puis lancez `npm run sync`. Le script écrit les valeurs dans les
neuf pages, entre des marqueurs `<!-- @data:nom -->` :

| Région | Page | Contenu |
| --- | --- | --- |
| `payments-list` | `livraison-retours` | la liste à puces des moyens de paiement |
| `payments-inline` | `faq` | la même liste, en phrase |
| `whatsapp-lines` | `contact` | les deux numéros, avec rôle et horaires |

Ajouter un opérateur se fait donc à un seul endroit. `npm test` échoue si une
région est vide — c’est-à-dire si la config a changé sans que la
synchronisation ait été relancée.

### Les deux numéros WhatsApp

`whatsapp.primary` reçoit les **commandes** : tous les boutons « Commander »
pointent dessus. `whatsapp.secondary` reçoit le **service client et le suivi de
livraison**. Un lien est routé vers le second en lui ajoutant
`data-wa="secondary"` ; sans cet attribut il part vers le premier, ce qui est le
bon défaut pour un bouton de vente.

`WHATSAPP_NUMBER_1` et `WHATSAPP_NUMBER_2` l’emportent sur le fichier, pour
qu’une préproduction utilise d’autres numéros sans modifier un fichier suivi.

### Secrets

Les vraies clés — base de données, IA, paiement, livraison, authentification —
vivent dans `.env`, jamais dans `config/brand.json` ni dans le code client.
Voir `.env.example`.

## 📁 Structure

| Chemin | Contenu |
| --- | --- |
| `index.html` | la page d'accueil, et la source de vérité du chrome partagé |
| `creme-cheveux.html`, `savon-noir.html` | les deux pages produit |
| `a-propos.html`, `avis.html`, `faq.html`, `contact.html`, `livraison-retours.html` | le reste |
| `404.html` | page introuvable, `noindex` |
| `assets/css/main.css` | toute la feuille de style |
| `assets/js/main.js` | amélioration progressive uniquement |
| `assets/img/` | marque et illustrations produit |
| `assets/fonts/` | Cormorant Garamond et Manrope, auto-hébergées |
| `config/brand.json` | numéros, réseaux, opérateurs de paiement |
| `.env.example` | les secrets attendus, sans valeurs |
| `scripts/` | outillage : `check.mjs`, `site.mjs`, `assets.mjs` |

### Le voyage chromatique

L'accueil voyage du rose poudré de l'univers cheveux, à travers un neutre
chaud, jusqu'au vert olive profond du savon noir marocain. C'est du CSS pur :
une section déclare son univers avec une classe `stage--*`, qui repointe les
jetons d'encre, d'accent et de filet — un composant écrit une fois se lit donc
correctement dans les deux mondes. Les bandes `.stage-fade--*` font la
traversée.

Rien dans cette transition ne dépend de JavaScript ni d'un écouteur de
défilement : elle survit à une 3G lente avec le script encore en vol.

### Le chrome partagé

L'en-tête, le tiroir mobile, le pied de page et le bouton WhatsApp flottant
sont dupliqués sur les neuf pages, faute de moteur de gabarit. Ils sont
encadrés par des marqueurs `<!-- @chrome:nom -->`, `index.html` détient la
copie canonique, et `scripts/site.mjs` l'écrit dans les autres en réappliquant
`aria-current` page par page. `scripts/check.mjs` échoue en cas de dérive.

**Modifiez le chrome dans `index.html` uniquement, puis lancez `npm run sync`.**

## 📐 Règles que ce site tient

- **Rien n'exige JavaScript.** Le contenu est lisible, tous les liens
  résolvent et tous les boutons de commande atteignent WhatsApp avec
  `main.js` bloqué. La majorité des visiteuses arrivent du navigateur intégré
  d'Instagram ou de TikTok, sur un réseau mobile, où un script peut simplement
  ne jamais arriver.
- **L'or ne porte pas de texte.** `#C8A96B` sur sable donne 1,9:1. L'or et le
  champagne dessinent les filets, les bordures et l'ornement ; `--ink-gold` est
  le seul or autorisé à porter des mots sur fond clair.
- **Le chemin de commande est vérifié.** Chaque page doit contenir un lien
  `wa.me` bien formé, sinon le test échoue : une page sans lien est une
  impasse commerciale.
- **Les prix utilisent des chiffres alignés.** Cormorant livre des chiffres
  elzéviriens, où `01` se lit `OI`. Partout où un nombre doit se lire comme un
  nombre, `font-variant-numeric` force les chiffres alignés.

## 🖼️ Les logos

Les deux logos officiels ne sont **pas encore dans le dépôt**. Déposez-les ici :

```
assets/img/logo-hair.png     # cercle rose poudré, monogramme EE couronné
assets/img/logo-soap.png     # sceau vert et or, « Moroccan Black Soap »
```

En attendant, le site utilise une marque d'arche marocaine dessinée en SVG
(`assets/img/favicon.svg` et le tracé inline dans l'en-tête), qui fonctionne
sur fond clair comme sur fond sombre. Les deux signatures des logos sont déjà
en place sur leurs pages respectives :

- Cheveux — « L'excellence naturelle au service de chaque chevelure. »
- Savon noir — « Le rituel d'une peau naturellement sublime. »

Les icônes matricielles (`icon-*.png`, `apple-touch-icon.png`, `favicon.ico`,
`og-image.png`) sont générées par `npm run assets` : il n'y a pas de chaîne
d'outils image ici, donc `scripts/assets.mjs` rastérise lui-même la marque et
la carte de partage. Le résultat est commité ; un déploiement normal ne
l'exécute jamais.

## 🚀 Déploiement

Projet Vercel dédié à **ce dépôt**, répertoire racine = la racine du dépôt.
`vercel.json` fournit `cleanUrls`, les en-têtes de cache et les en-têtes de
sécurité. Aucune commande de build : les fichiers sont servis tels quels.

ELIEL EMMANUELA et Harmony Verify sont deux marques distinctes. Ce site ne
partage aucun dépôt, aucun projet Vercel et aucun domaine avec Harmony Verify.
