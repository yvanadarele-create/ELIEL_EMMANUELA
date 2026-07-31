/**
 * ELIEL EMMANUELA — progressive enhancement.
 *
 * Everything here is an improvement on a page that already works: the content is
 * readable, every link resolves and every order button reaches WhatsApp with
 * this file blocked. That is not a stylistic preference — a large share of the
 * traffic arrives through the Instagram and TikTok in-app browsers on a mobile
 * network, where a script can simply fail to arrive.
 *
 * Five behaviours, in order: the masthead, the mobile drawer, scroll reveals,
 * the sticky order bar's clearance, and the footer year.
 */
(() => {
  "use strict";

  const doc = document.documentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* --- Masthead ----------------------------------------------------------
   *
   * Two states. `is-stuck` gives it a background once the page has moved, so the
   * wordmark never sits on top of a heading. `is-dark` flips it for the olive
   * universe: without it the header keeps the blush treatment and the links go
   * to near-invisible cocoa-on-green halfway down the homepage.
   */
  const masthead = document.querySelector("[data-masthead]");

  if (masthead) {
    const DARK = /stage--(olive|emerald|cocoa)/;
    const stages = [...document.querySelectorAll(".stage")];
    let lastY = window.scrollY;

    const sync = () => {
      const y = window.scrollY;
      masthead.classList.toggle("is-stuck", y > 8);

      // Which universe is behind the header right now.
      const probe = masthead.offsetHeight * 0.6;
      const under = stages.find((el) => {
        const box = el.getBoundingClientRect();
        return box.top <= probe && box.bottom > probe;
      });
      // Both classes are set, never just one: the page's opening state comes
      // from a `data-masthead-ink` attribute on <body>, and only an explicit
      // `is-light` can override it once the journey leaves the olive universe.
      const dark = Boolean(under && DARK.test(under.className));
      masthead.classList.toggle("is-dark", dark);
      masthead.classList.toggle("is-light", Boolean(under) && !dark);

      // Reclaim the top of a small screen while reading, but never while the
      // drawer is open and never near the top of the document.
      const hide = y > 480 && y > lastY && !doc.classList.contains("is-locked");
      masthead.classList.toggle("is-hidden", hide);
      lastY = y;
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        sync();
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    sync();
  }

  /* --- Mobile drawer ------------------------------------------------------ */

  const toggle = document.querySelector("[data-nav-toggle]");
  const drawer = document.querySelector("[data-drawer]");

  if (toggle && drawer) {
    const label = toggle.querySelector(".u-visually-hidden");

    const setOpen = (open) => {
      drawer.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      doc.classList.toggle("is-locked", open);
      document.body.style.overflow = open ? "hidden" : "";
      if (label) label.textContent = open ? "Fermer le menu" : "Ouvrir le menu";
      if (open) drawer.querySelector("a")?.focus();
      else if (document.activeElement !== document.body) toggle.focus();
      if (masthead && open) masthead.classList.remove("is-hidden");
    };

    toggle.addEventListener("click", () => setOpen(drawer.hidden));

    drawer.addEventListener("click", (event) => {
      if (event.target.closest("a")) setOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !drawer.hidden) setOpen(false);
    });

    // Crossing into the desktop layout leaves the drawer open over a nav bar
    // that is already showing the same links, and the body still scroll-locked.
    window.matchMedia("(min-width: 60rem)").addEventListener("change", (event) => {
      if (event.matches && !drawer.hidden) setOpen(false);
    });
  }

  /* --- Reveal on scroll --------------------------------------------------
   *
   * The hidden state lives behind the `js` class that the inline head script
   * sets, so a visitor without this file sees everything immediately rather
   * than a blank page. Elements are unobserved once shown: nothing here should
   * keep running for the rest of the session.
   */
  const reveals = document.querySelectorAll(".reveal");

  if (reveals.length && !reduced.matches && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    for (const el of reveals) observer.observe(el);
  } else {
    for (const el of reveals) el.classList.add("is-visible");
  }

  /* --- Sticky order bar --------------------------------------------------
   *
   * The bar and the floating WhatsApp button both live in the bottom-right
   * corner on a phone. Publishing the bar's height as a custom property is what
   * keeps the button above it instead of underneath.
   */
  const buybar = document.querySelector("[data-buybar]");

  if (buybar) {
    const measure = () => {
      const visible = getComputedStyle(buybar).display !== "none";
      doc.style.setProperty("--buybar", visible ? `${buybar.offsetHeight}px` : "0px");
    };
    measure();
    window.addEventListener("resize", measure, { passive: true });
    if ("ResizeObserver" in window) new ResizeObserver(measure).observe(buybar);
  }

  /* --- WhatsApp composer -------------------------------------------------
   *
   * A static site cannot receive a form post, and a contact form that silently
   * goes nowhere is worse than none at all. So the form does not submit: it
   * assembles a message and hands it to WhatsApp, where the visitor still has to
   * press send. The markup is inside `.js-only`, so this never appears unless
   * the code that drives it has actually loaded.
   */
  const composer = document.querySelector("[data-wa-form]");

  if (composer) {
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(composer);
      const name = String(data.get("name") || "").trim();
      const topic = String(data.get("topic") || "").trim();
      const message = String(data.get("message") || "").trim();

      const lines = [
        `Bonjour ELIEL EMMANUELA, je suis ${name || "une cliente"}.`,
        topic && `Objet : ${topic}.`,
        message,
      ].filter(Boolean);

      // The number lives in the markup, not here, so scripts/eliel-site.mjs has
      // a single place to rewrite when the real one is set.
      const base = document.querySelector("a.wa-fab[href]")?.href.split("?")[0];
      if (!base) return;
      window.open(`${base}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank", "noopener");
    });
  }

  /* --- Footer year -------------------------------------------------------- */

  for (const el of document.querySelectorAll("[data-year]")) {
    el.textContent = String(new Date().getFullYear());
  }
})();
