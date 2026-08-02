/**
 * ELIEL EMMANUELA — le commerce, côté navigateur.
 *
 * Ce fichier branche les pages statiques sur /api : prix et disponibilité lus
 * en base, panier serveur, livraison calculée, commande créée, récapitulatif
 * WhatsApp.
 *
 * Une règle gouverne tout le fichier : **l'API enrichit, elle ne remplace
 * pas**. Le HTML garde ses prix et ses textes ; si /api est injoignable — base
 * non configurée, fonction froide, réseau coupé dans un navigateur intégré
 * Instagram — la page reste exactement ce qu'elle est aujourd'hui et vend par
 * WhatsApp. Une boutique qui devient blanche parce qu'une requête a échoué est
 * pire qu'une boutique statique.
 *
 * Concrètement : rien ici ne s'affiche avant d'avoir reçu une réponse. Le
 * bouton « Ajouter au panier » n'est inséré qu'une fois le produit confirmé
 * par le serveur, le compteur de panier qu'une fois le panier lu.
 */
(() => {
  "use strict";

  const API = "/api";
  const STORE = { cart: "ee.cart", visitor: "ee.visitor" };
  const money = (n) => `${Number(n).toLocaleString("fr-FR").replace(/ | /g, " ")} F`;

  /* --- Stockage local, tolérant ------------------------------------------
   *
   * Le navigateur intégré d'Instagram refuse parfois localStorage en navigation
   * privée. Un accès qui lève ne doit pas emporter le reste du fichier.
   */
  const store = {
    get(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* mémoire seulement pour cette session */
      }
    },
    del(key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignoré */
      }
    },
  };

  async function api(path, { method = "GET", body } = {}) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.details = payload?.details;
      throw error;
    }
    return payload;
  }

  /* --- Visiteuse et attribution ------------------------------------------
   *
   * Le jeton est aléatoire et anonyme. Les paramètres UTM sont lus une fois à
   * l'arrivée puis conservés : la cliente clique « Commander », part sur
   * WhatsApp, revient — et sans cette mémoire la campagne TikTok qui l'a
   * amenée aurait disparu du parcours.
   */
  const visitor = (() => {
    let token = store.get(STORE.visitor);
    if (!token) {
      token = `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      store.set(STORE.visitor, token);
    }
    return token;
  })();

  const utm = (() => {
    const params = new URLSearchParams(location.search);
    const picked = {};
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref", "influencer"]) {
      const value = params.get(key);
      if (value) picked[key] = value;
    }
    if (Object.keys(picked).length) store.set("ee.utm", JSON.stringify(picked));
    try {
      return Object.keys(picked).length ? picked : JSON.parse(store.get("ee.utm") || "{}");
    } catch {
      return picked;
    }
  })();

  /**
   * Un événement ne doit jamais retarder ni casser la page : sendBeacon quand
   * il existe, fetch en dernier recours, et l'échec est avalé.
   */
  function track(name, props = {}) {
    const body = JSON.stringify({
      name,
      visitor_token: visitor,
      path: location.pathname,
      referrer: document.referrer || undefined,
      utm,
      props,
    });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(`${API}/analytics/collect`, new Blob([body], { type: "application/json" }));
        return;
      }
    } catch {
      /* on retombe sur fetch */
    }
    fetch(`${API}/analytics/collect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }

  /* --- Panier -------------------------------------------------------------- */

  const cart = {
    token: store.get(STORE.cart),
    state: null,

    async read() {
      if (!this.token) return null;
      try {
        const { cart: data } = await api(`/cart?token=${encodeURIComponent(this.token)}`);
        this.state = data;
        return data;
      } catch (error) {
        // Panier expiré ou converti : on repart proprement plutôt que de
        // garder un jeton qui échouera à chaque page.
        if (error.status === 404) {
          store.del(STORE.cart);
          this.token = null;
          this.state = null;
        }
        return null;
      }
    },

    async add(variantId, quantity = 1) {
      const { cart: data } = await api("/cart/items", {
        method: "POST",
        body: { token: this.token, variant_id: variantId, quantity },
      });
      this.token = data.token;
      this.state = data;
      store.set(STORE.cart, data.token);
      return data;
    },

    async setQuantity(itemId, quantity) {
      const { cart: data } = await api("/cart/items", {
        method: "PATCH",
        body: { token: this.token, item_id: itemId, quantity },
      });
      this.state = data;
      return data;
    },

    async coupon(code) {
      const { cart: data } = await api("/cart/coupon", {
        method: "POST",
        body: { token: this.token, code },
      });
      this.state = data;
      return data;
    },

    async dropCoupon() {
      const { cart: data } = await api("/cart/coupon", { method: "DELETE", body: { token: this.token } });
      this.state = data;
      return data;
    },
  };

  /* --- Récapitulatif WhatsApp ---------------------------------------------
   *
   * Le message porte tout ce qu'il faut pour confirmer un paiement mobile sans
   * rien redemander : numéro de commande, articles, quantités, total, adresse.
   */
  function summary(order, cartState, contact) {
    const lines = [`Bonjour ELIEL EMMANUELA,`, ""];

    if (order?.order_number) lines.push(`Commande : ${order.order_number}`, "");
    else lines.push("je souhaite commander :", "");

    for (const item of cartState.items) {
      lines.push(`${item.quantity} × ${item.product_name} (${item.variant_name}) — ${money(item.line_total)}`);
    }

    const totals = order?.totals ?? cartState.totals;
    lines.push("");
    lines.push(`Sous-total : ${money(totals.subtotal)}`);
    if (totals.discount_total > 0) lines.push(`Remise : −${money(totals.discount_total)}`);
    if (totals.shipping_total) lines.push(`Livraison : ${money(totals.shipping_total)}`);
    lines.push(`Total : ${money(totals.grand_total ?? totals.total)}`);

    if (contact?.name) lines.push("", `Nom : ${contact.name}`);
    if (contact?.address) {
      lines.push(`Livraison : ${contact.address}${contact.commune ? `, ${contact.commune}` : ""}`);
    }
    if (contact?.payment) lines.push(`Paiement : ${contact.payment}`);

    return lines.join("\n");
  }

  /** Le numéro de la ligne « commandes » est déjà dans la page, sur le bouton flottant. */
  function ordersNumber() {
    const href = document.querySelector("a.wa-fab[href]")?.getAttribute("href") || "";
    return /wa\.me\/(\d+)/.exec(href)?.[1] ?? null;
  }

  function openWhatsApp(text) {
    const number = ordersNumber();
    if (!number) return false;
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    return true;
  }

  /* --- Tiroir panier -------------------------------------------------------- */

  let drawer;
  let step = "cart";

  function ensureDrawer() {
    if (drawer) return drawer;
    drawer = document.createElement("div");
    drawer.className = "cart-drawer";
    drawer.hidden = true;
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-label", "Votre panier");
    document.body.appendChild(drawer);

    drawer.addEventListener("click", onDrawerClick);
    drawer.addEventListener("submit", onDrawerSubmit);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !drawer.hidden) closeDrawer();
    });
    return drawer;
  }

  function openDrawer() {
    ensureDrawer().hidden = false;
    document.body.style.overflow = "hidden";
    renderDrawer();
    drawer.querySelector("button, input, a")?.focus();
  }

  function closeDrawer() {
    if (!drawer) return;
    drawer.hidden = true;
    document.body.style.overflow = "";
    step = "cart";
  }

  function renderDrawer(message = "") {
    const state = cart.state;
    if (!state) return;

    const empty = state.items.length === 0;
    const totals = state.totals;

    const items = state.items
      .map(
        (item) => `
        <li class="cart-line">
          <div>
            <p class="cart-line__name">${item.product_name}</p>
            <p class="cart-line__meta">${item.variant_name} · ${money(item.unit_price)}</p>
          </div>
          <div class="cart-line__qty">
            <button type="button" data-qty="${item.id}" data-to="${item.quantity - 1}" aria-label="Retirer un exemplaire">−</button>
            <span aria-label="Quantité">${item.quantity}</span>
            <button type="button" data-qty="${item.id}" data-to="${item.quantity + 1}" aria-label="Ajouter un exemplaire">+</button>
          </div>
          <p class="cart-line__total">${money(item.line_total)}</p>
        </li>`,
      )
      .join("");

    const totalsBlock = `
      <dl class="cart-totals">
        <div><dt>Sous-total</dt><dd>${money(totals.subtotal)}</dd></div>
        ${totals.discount_total > 0 ? `<div class="is-discount"><dt>Remise${state.coupon ? ` (${state.coupon.code})` : ""}</dt><dd>−${money(totals.discount_total)}</dd></div>` : ""}
        <div class="cart-totals__grand"><dt>Total</dt><dd>${money(totals.total)}</dd></div>
      </dl>
      <p class="cart-note">Livraison calculée à l'étape suivante.</p>`;

    const cartStep = `
      <ul class="cart-lines">${items}</ul>
      ${totalsBlock}
      <form class="cart-coupon" data-form="coupon">
        <label for="cart-code" class="u-visually-hidden">Code promo</label>
        <input id="cart-code" name="code" type="text" placeholder="Code promo" autocomplete="off" value="${state.coupon?.code ?? ""}">
        <button class="btn btn--ghost" type="submit">Appliquer</button>
      </form>
      <button class="btn btn--wa cart-cta" type="button" data-step="details">Commander</button>`;

    const detailsStep = `
      <form class="cart-details" data-form="checkout">
        <div class="field">
          <label for="co-name">Votre nom</label>
          <input id="co-name" name="name" type="text" autocomplete="name" required>
        </div>
        <div class="field">
          <label for="co-phone">Téléphone (WhatsApp)</label>
          <input id="co-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="07 00 00 00 00" required>
        </div>
        <div class="field">
          <label for="co-commune">Commune</label>
          <input id="co-commune" name="commune" type="text" list="ee-communes" placeholder="Cocody" required>
          <datalist id="ee-communes"></datalist>
          <p class="field__hint" data-shipping></p>
        </div>
        <div class="field">
          <label for="co-address">Adresse et repère</label>
          <input id="co-address" name="address" type="text" placeholder="Rue, immeuble, en face de…" required>
        </div>
        <div class="field">
          <label for="co-payment">Paiement</label>
          <select id="co-payment" name="payment_operator"></select>
        </div>
        <button class="btn btn--wa" type="submit">Valider et ouvrir WhatsApp</button>
        <button class="btn btn--ghost cart-back" type="button" data-step="cart">Retour au panier</button>
      </form>`;

    drawer.innerHTML = `
      <div class="cart-drawer__panel">
        <header class="cart-drawer__head">
          <h2>${step === "cart" ? "Votre panier" : "Vos coordonnées"}</h2>
          <button type="button" class="cart-close" data-close aria-label="Fermer le panier">×</button>
        </header>
        ${message ? `<p class="cart-message" role="status">${message}</p>` : ""}
        ${empty ? `<p class="cart-empty">Votre panier est vide.</p>` : step === "cart" ? cartStep : detailsStep}
      </div>`;

    if (!empty && step === "details") fillDetailsStep();
  }

  async function fillDetailsStep() {
    const select = drawer.querySelector("#co-payment");
    // Les opérateurs viennent de la page (générés depuis config/brand.json),
    // donc la liste ne peut pas diverger de ce que la boutique accepte.
    const operators = [...document.querySelectorAll("[data-payments] li")].map((li) => li.textContent.trim());
    const fallback = ["Wave", "Orange Money", "Moov Money", "MTN MoMo", "Djamo", "Espèces à la livraison"];
    for (const name of operators.length ? operators : fallback) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select?.appendChild(option);
    }

    try {
      const { zones } = await api("/shipping/zones");
      const list = drawer.querySelector("#ee-communes");
      for (const zone of zones) {
        for (const area of zone.areas) {
          const option = document.createElement("option");
          option.value = area;
          list?.appendChild(option);
        }
      }
    } catch {
      /* la saisie libre reste possible */
    }
  }

  const OPERATOR_IDS = {
    Wave: "wave",
    "Orange Money": "orange-money",
    "Moov Money": "moov-money",
    "MTN MoMo": "mtn-momo",
    Djamo: "djamo",
    "Western Union": "western-union",
  };
  const operatorId = (label) => OPERATOR_IDS[label] ?? "cash";

  async function onDrawerClick(event) {
    if (event.target.closest("[data-close]")) return closeDrawer();

    const stepButton = event.target.closest("[data-step]");
    if (stepButton) {
      step = stepButton.dataset.step;
      renderDrawer();
      return;
    }

    const qty = event.target.closest("[data-qty]");
    if (qty) {
      const to = Number(qty.dataset.to);
      qty.disabled = true;
      try {
        await cart.setQuantity(qty.dataset.qty, Math.max(0, to));
        track(to === 0 ? "remove_from_cart" : "add_to_cart", { item_id: qty.dataset.qty });
        renderDrawer();
        paintCount();
      } catch (error) {
        renderDrawer(error.message);
      }
    }
  }

  async function onDrawerSubmit(event) {
    event.preventDefault();
    const form = event.target;

    if (form.dataset.form === "coupon") {
      const code = new FormData(form).get("code")?.toString().trim();
      try {
        if (!code) await cart.dropCoupon();
        else {
          await cart.coupon(code);
          track("coupon_applied", { code });
        }
        renderDrawer();
      } catch (error) {
        renderDrawer(error.message);
      }
      return;
    }

    if (form.dataset.form !== "checkout") return;

    const data = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Création de la commande…";
    track("begin_checkout");

    try {
      const { order } = await api("/checkout", {
        method: "POST",
        body: {
          token: cart.token,
          name: data.name,
          phone: data.phone,
          commune: data.commune,
          address: data.address,
          payment_operator: operatorId(data.payment_operator),
        },
      });

      const text = summary(order, cart.state, {
        name: data.name,
        address: data.address,
        commune: data.commune,
        payment: data.payment_operator,
      });

      track("purchase", { order_number: order.order_number, value: order.totals.grand_total });

      // Le panier est consommé côté serveur ; le jeton local doit suivre,
      // sinon la page suivante lit un panier converti et repart en erreur.
      store.del(STORE.cart);
      cart.token = null;

      drawer.innerHTML = `
        <div class="cart-drawer__panel">
          <header class="cart-drawer__head">
            <h2>Commande enregistrée</h2>
            <button type="button" class="cart-close" data-close aria-label="Fermer">×</button>
          </header>
          <p class="cart-confirm__number">${order.order_number}</p>
          <p class="cart-note">
            Total ${money(order.totals.grand_total)}, livraison ${order.shipping.zone}
            sous ${order.shipping.estimated_days[0]} à ${order.shipping.estimated_days[1]} jours.
          </p>
          <p class="cart-note">Envoyez le message WhatsApp pour confirmer votre paiement.</p>
          <button class="btn btn--wa" type="button" data-send>Ouvrir WhatsApp</button>
        </div>`;
      drawer.querySelector("[data-send]")?.addEventListener("click", () => openWhatsApp(text));
      openWhatsApp(text);
      paintCount();
    } catch (error) {
      submit.disabled = false;
      submit.textContent = "Valider et ouvrir WhatsApp";
      const box = form.parentElement.querySelector(".cart-message") ?? document.createElement("p");
      box.className = "cart-message";
      box.setAttribute("role", "status");
      box.textContent = error.message;
      form.parentElement.insertBefore(box, form);
    }
  }

  /* --- Compteur dans l'en-tête --------------------------------------------- */

  function paintCount() {
    const count = cart.state?.item_count ?? 0;
    let button = document.querySelector("[data-cart-button]");

    if (!button) {
      if (count === 0) return;
      const toggle = document.querySelector("[data-nav-toggle]");
      if (!toggle) return;
      button = document.createElement("button");
      button.type = "button";
      button.className = "cart-button";
      button.dataset.cartButton = "";
      button.addEventListener("click", openDrawer);
      toggle.parentElement.insertBefore(button, toggle);
    }

    button.hidden = count === 0;
    button.innerHTML = `<span class="u-visually-hidden">Voir le panier —</span>Panier <span class="cart-button__count">${count}</span>`;
  }

  /* --- Hydratation d'une page produit --------------------------------------
   *
   * Le prix et la disponibilité affichés viennent de la base. Tant que la
   * réponse n'est pas là, le HTML statique reste en place : c'est lui qui a
   * raison si le serveur ne répond pas.
   */
  async function hydrateProduct(slug) {
    let product;
    try {
      ({ product } = await api(`/products/${encodeURIComponent(slug)}`));
    } catch {
      return; // Le HTML statique fait le travail.
    }

    track("product_view", { slug });

    const pricing = product.pricing;
    for (const node of document.querySelectorAll("[data-price]")) {
      const unit = node.querySelector("small")?.outerHTML ?? "";
      const promo =
        pricing.compare_at && pricing.compare_at > pricing.price
          ? `<s class="price__was">${money(pricing.compare_at)}</s> `
          : "";
      node.innerHTML = `${promo}${money(pricing.price)} CFA ${unit}`;
    }

    if (pricing.discount_percent) {
      for (const node of document.querySelectorAll("[data-price]")) {
        const badge = document.createElement("span");
        badge.className = "price-badge";
        badge.textContent = `−${pricing.discount_percent} %`;
        node.appendChild(badge);
      }
    }

    const variant = product.variants[0];
    if (!variant) return;

    const host = document.querySelector("[data-buy]");
    if (!host) return;

    const outOfStock = variant.stock === "out_of_stock";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn--gold add-to-cart";
    button.disabled = outOfStock;
    button.textContent = outOfStock ? "Rupture de stock" : "Ajouter au panier";

    if (!outOfStock) {
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Ajout…";
        try {
          await cart.add(variant.id, 1);
          track("add_to_cart", { slug, sku: variant.sku, value: pricing.price });
          paintCount();
          openDrawer();
        } catch (error) {
          button.textContent = error.message;
          setTimeout(() => {
            button.textContent = "Ajouter au panier";
            button.disabled = false;
          }, 2500);
          return;
        }
        button.textContent = "Ajouter au panier";
        button.disabled = false;
      });
    }

    host.prepend(button);

    if (variant.stock === "low") {
      const note = document.createElement("p");
      note.className = "stock-note";
      note.textContent = "Derniers exemplaires disponibles.";
      host.after(note);
    }
  }

  /* --- Démarrage ------------------------------------------------------------ */

  async function start() {
    track("page_view");

    for (const link of document.querySelectorAll('a[href*="wa.me"]')) {
      link.addEventListener("click", () => track("whatsapp_click", { href: link.getAttribute("href") }));
    }

    await cart.read();
    paintCount();

    const slug = document.body.dataset.product;
    if (slug) await hydrateProduct(slug);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
