-- ELIEL EMMANUELA — schéma initial
--
-- Postgres 14+. Conçu pour Neon, mais rien ici n'est spécifique à Neon.
--
-- Conventions tenues dans tout le schéma :
--
--   * Montants : entiers, en francs CFA. Le XOF n'a pas de sous-unité — il
--     n'existe pas de centime de franc CFA — donc un entier est le montant
--     exact. Pas de NUMERIC, pas d'arrondi, pas de flottant.
--   * Énumérations : TEXT + CHECK plutôt que des types ENUM. Ajouter un statut
--     de commande devient une migration d'une ligne au lieu d'un ALTER TYPE.
--   * Identifiants : UUID en interne, jamais exposés tels quels. Ce que le
--     public voit — numéro de commande, slug, SKU, code promo — est une colonne
--     distincte, lisible et stable.
--   * Suppression : ON DELETE RESTRICT par défaut sur tout ce qui touche une
--     commande. Une commande est une pièce comptable ; supprimer un produit ne
--     doit pas pouvoir effacer ce qui a été vendu.
--   * Horodatage : TIMESTAMPTZ partout, jamais TIMESTAMP. Abidjan est en UTC+0
--     aujourd'hui, ce qui masque les bugs de fuseau jusqu'au jour où l'on vend
--     ailleurs.

-- gen_random_uuid() est natif depuis Postgres 13 ; pgcrypto reste utile pour
-- le hachage des jetons de session.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Une seule fonction de déclencheur pour tout le schéma.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


/* ===========================================================================
   Réglages et administration
   =========================================================================== */

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       JSONB       NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER settings_updated_at BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE admin_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'staff')),
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER admin_users_updated_at BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seul le hachage du jeton est stocké : une fuite de cette table ne permet pas
-- de se connecter, exactement comme pour un mot de passe.
CREATE TABLE admin_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID        NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash    TEXT        NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  ip            INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_sessions_user_idx ON admin_sessions(admin_user_id);
CREATE INDEX admin_sessions_expiry_idx ON admin_sessions(expires_at);


/* ===========================================================================
   Catalogue
   =========================================================================== */

CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  description TEXT,
  position    INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER categories_updated_at BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE products (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             TEXT        NOT NULL UNIQUE,
  name             TEXT        NOT NULL,
  subtitle         TEXT,
  description      TEXT,
  -- Le récit long de la page produit : composition, rituel, pour qui.
  story            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  category_id      UUID        REFERENCES categories(id) ON DELETE SET NULL,
  -- Prix affiché. compare_at_price est le prix barré : il sert la lisibilité
  -- d'une remise permanente et n'est PAS le moteur de promotion, qui vit dans
  -- promotions/coupons et se calcule à la commande.
  base_price       INTEGER     NOT NULL CHECK (base_price >= 0),
  compare_at_price INTEGER     CHECK (compare_at_price IS NULL OR compare_at_price > base_price),
  currency         CHAR(3)     NOT NULL DEFAULT 'XOF',
  status           TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  is_featured      BOOLEAN     NOT NULL DEFAULT FALSE,
  is_new           BOOLEAN     NOT NULL DEFAULT FALSE,
  tags             TEXT[]      NOT NULL DEFAULT '{}',
  position         INTEGER     NOT NULL DEFAULT 0,
  seo_title        TEXT,
  seo_description  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX products_status_idx ON products(status) WHERE status = 'active';
CREATE INDEX products_category_idx ON products(category_id);
CREATE INDEX products_tags_idx ON products USING GIN(tags);

CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_media (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind       TEXT        NOT NULL DEFAULT 'image' CHECK (kind IN ('image', 'video')),
  url        TEXT        NOT NULL,
  alt        TEXT        NOT NULL DEFAULT '',
  width      INTEGER,
  height     INTEGER,
  position   INTEGER     NOT NULL DEFAULT 0,
  is_primary BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX product_media_product_idx ON product_media(product_id, position);
-- Une seule image principale par produit, garantie par l'index plutôt que par
-- la discipline du code appelant.
CREATE UNIQUE INDEX product_media_one_primary ON product_media(product_id) WHERE is_primary;

CREATE TABLE product_variants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku            TEXT        NOT NULL UNIQUE,
  name           TEXT        NOT NULL,
  option_name    TEXT,
  option_value   TEXT,
  -- NULL = le variant suit le prix du produit. Une valeur le remplace.
  price_override INTEGER     CHECK (price_override IS NULL OR price_override >= 0),
  weight_grams   INTEGER     CHECK (weight_grams IS NULL OR weight_grams >= 0),
  position       INTEGER     NOT NULL DEFAULT 0,
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX product_variants_product_idx ON product_variants(product_id, position);

CREATE TRIGGER product_variants_updated_at BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


/* ===========================================================================
   Stock
   =========================================================================== */

-- Un stock par variant, en 1:1. `reserved` compte ce qu'un panier en cours de
-- paiement retient : c'est la différence entre « il en reste un » et « deux
-- clientes viennent d'acheter le dernier ».
CREATE TABLE inventory (
  variant_id          UUID PRIMARY KEY REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity_on_hand    INTEGER     NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  quantity_reserved   INTEGER     NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  low_stock_threshold INTEGER     NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  allow_backorder     BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_reserved_within_stock
    CHECK (allow_backorder OR quantity_reserved <= quantity_on_hand)
);

CREATE TRIGGER inventory_updated_at BEFORE UPDATE ON inventory
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Journal immuable : tout mouvement de stock laisse une ligne. Sans lui,
-- « il manque trois pots » est une question sans réponse.
CREATE TABLE inventory_movements (
  id         BIGSERIAL PRIMARY KEY,
  variant_id UUID        NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  delta      INTEGER     NOT NULL,
  reason     TEXT        NOT NULL CHECK (reason IN
               ('restock', 'sale', 'reservation', 'release', 'adjustment', 'return', 'loss')),
  order_id   UUID,
  note       TEXT,
  created_by UUID        REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX inventory_movements_variant_idx ON inventory_movements(variant_id, created_at DESC);


/* ===========================================================================
   Clientes
   =========================================================================== */

CREATE TABLE customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Le téléphone est l'identité réelle ici : on vend sur WhatsApp, beaucoup de
  -- clientes n'ont pas d'e-mail. Stocké normalisé, sans espace ni « + ».
  phone           TEXT        NOT NULL UNIQUE,
  email           TEXT,
  first_name      TEXT,
  last_name       TEXT,
  city            TEXT,
  country         CHAR(2)     NOT NULL DEFAULT 'CI',
  whatsapp_opt_in BOOLEAN     NOT NULL DEFAULT TRUE,
  notes           TEXT,
  -- Agrégats entretenus à la commande, pour ne pas recalculer à chaque écran.
  orders_count    INTEGER     NOT NULL DEFAULT 0 CHECK (orders_count >= 0),
  total_spent     INTEGER     NOT NULL DEFAULT 0 CHECK (total_spent >= 0),
  first_order_at  TIMESTAMPTZ,
  last_order_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX customers_email_idx ON customers(lower(email)) WHERE email IS NOT NULL;

CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE addresses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label       TEXT,
  line1       TEXT        NOT NULL,
  line2       TEXT,
  commune     TEXT,
  city        TEXT        NOT NULL DEFAULT 'Abidjan',
  country     CHAR(2)     NOT NULL DEFAULT 'CI',
  -- À Abidjan on livre au repère, pas au numéro de rue.
  landmark    TEXT,
  is_default  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX addresses_customer_idx ON addresses(customer_id);
CREATE UNIQUE INDEX addresses_one_default ON addresses(customer_id) WHERE is_default;

CREATE TRIGGER addresses_updated_at BEFORE UPDATE ON addresses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


/* ===========================================================================
   Attribution et campagnes
   =========================================================================== */

CREATE TABLE campaigns (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT        NOT NULL UNIQUE,
  name       TEXT        NOT NULL,
  source     TEXT        NOT NULL CHECK (source IN
               ('tiktok', 'instagram', 'facebook', 'whatsapp', 'direct', 'referral', 'other')),
  medium     TEXT,
  influencer TEXT,
  starts_at  TIMESTAMPTZ,
  ends_at    TIMESTAMPTZ,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Une ligne par visiteuse identifiée par un jeton anonyme. On garde le premier
-- ET le dernier contact : « TikTok → produit A → WhatsApp → achat » ne se
-- raconte pas si l'on n'a gardé que le dernier maillon.
CREATE TABLE attributions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_token      TEXT        NOT NULL,
  campaign_id        UUID        REFERENCES campaigns(id) ON DELETE SET NULL,

  first_source       TEXT,
  first_medium       TEXT,
  first_campaign     TEXT,
  first_content      TEXT,
  first_term         TEXT,
  first_referrer     TEXT,
  first_landing_path TEXT,
  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  last_source        TEXT,
  last_medium        TEXT,
  last_campaign      TEXT,
  last_content       TEXT,
  last_referrer      TEXT,
  last_landing_path  TEXT,
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  customer_id        UUID        REFERENCES customers(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX attributions_visitor_idx ON attributions(visitor_token);
CREATE INDEX attributions_customer_idx ON attributions(customer_id);
CREATE INDEX attributions_first_source_idx ON attributions(first_source);


/* ===========================================================================
   Promotions et coupons
   =========================================================================== */

CREATE TABLE promotions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             TEXT        NOT NULL UNIQUE,
  name             TEXT        NOT NULL,
  description      TEXT,
  kind             TEXT        NOT NULL CHECK (kind IN ('percentage', 'fixed')),
  -- percentage : 1–100. fixed : un montant en francs.
  value            INTEGER     NOT NULL CHECK (value > 0),
  scope            TEXT        NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'product', 'category')),
  min_subtotal     INTEGER     NOT NULL DEFAULT 0 CHECK (min_subtotal >= 0),
  first_order_only BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Une promotion sans dates court indéfiniment ; avec ends_at, le compte à
  -- rebours affiché sur le site correspond à une vraie échéance.
  starts_at        TIMESTAMPTZ,
  ends_at          TIMESTAMPTZ,
  max_uses         INTEGER     CHECK (max_uses IS NULL OR max_uses > 0),
  uses_count       INTEGER     NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  -- Priorité décroissante : la plus forte gagne quand deux promotions
  -- s'appliquent et qu'aucune n'est cumulable.
  priority         INTEGER     NOT NULL DEFAULT 0,
  stackable        BOOLEAN     NOT NULL DEFAULT FALSE,
  requires_coupon  BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT promotions_percentage_range
    CHECK (kind <> 'percentage' OR value BETWEEN 1 AND 100),
  CONSTRAINT promotions_window_ordered
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX promotions_active_idx ON promotions(is_active, starts_at, ends_at);

CREATE TRIGGER promotions_updated_at BEFORE UPDATE ON promotions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Ce qu'une promotion de portée 'product' ou 'category' vise réellement.
CREATE TABLE promotion_targets (
  promotion_id UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES products(id) ON DELETE CASCADE,
  category_id  UUID REFERENCES categories(id) ON DELETE CASCADE,
  CONSTRAINT promotion_targets_exactly_one
    CHECK (num_nonnulls(product_id, category_id) = 1)
);

CREATE UNIQUE INDEX promotion_targets_product_idx
  ON promotion_targets(promotion_id, product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX promotion_targets_category_idx
  ON promotion_targets(promotion_id, category_id) WHERE category_id IS NOT NULL;

-- Un coupon est une clé qui déverrouille une promotion, pas une remise en soi.
-- Cela évite de dupliquer la logique de calcul dans deux tables.
CREATE TABLE coupons (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 TEXT        NOT NULL UNIQUE,
  promotion_id         UUID        NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  max_uses             INTEGER     CHECK (max_uses IS NULL OR max_uses > 0),
  max_uses_per_customer INTEGER    NOT NULL DEFAULT 1 CHECK (max_uses_per_customer > 0),
  uses_count           INTEGER     NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  starts_at            TIMESTAMPTZ,
  ends_at              TIMESTAMPTZ,
  is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coupons_code_uppercase CHECK (code = upper(code)),
  CONSTRAINT coupons_window_ordered
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX coupons_promotion_idx ON coupons(promotion_id);

CREATE TRIGGER coupons_updated_at BEFORE UPDATE ON coupons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


/* ===========================================================================
   Livraison
   =========================================================================== */

CREATE TABLE shipping_zones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT        NOT NULL UNIQUE,
  name         TEXT        NOT NULL,
  -- Communes couvertes, en minuscules sans accent, pour un appariement direct.
  areas        TEXT[]      NOT NULL DEFAULT '{}',
  fee          INTEGER     NOT NULL DEFAULT 0 CHECK (fee >= 0),
  free_above   INTEGER     CHECK (free_above IS NULL OR free_above > 0),
  min_days     INTEGER     NOT NULL DEFAULT 1 CHECK (min_days >= 0),
  max_days     INTEGER     NOT NULL DEFAULT 2 CHECK (max_days >= 0),
  requires_prepayment BOOLEAN NOT NULL DEFAULT FALSE,
  position     INTEGER     NOT NULL DEFAULT 0,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shipping_zones_days_ordered CHECK (max_days >= min_days)
);

CREATE INDEX shipping_zones_areas_idx ON shipping_zones USING GIN(areas);

CREATE TRIGGER shipping_zones_updated_at BEFORE UPDATE ON shipping_zones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


/* ===========================================================================
   Paniers
   =========================================================================== */

-- Le panier vit en base, pas dans le navigateur : il doit survivre à un
-- rafraîchissement, à un changement d'onglet et au retour depuis WhatsApp.
CREATE TABLE carts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token          TEXT        NOT NULL UNIQUE,
  customer_id    UUID        REFERENCES customers(id) ON DELETE SET NULL,
  attribution_id UUID        REFERENCES attributions(id) ON DELETE SET NULL,
  coupon_id      UUID        REFERENCES coupons(id) ON DELETE SET NULL,
  status         TEXT        NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'converted', 'abandoned')),
  currency       CHAR(3)     NOT NULL DEFAULT 'XOF',
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 days',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX carts_status_idx ON carts(status, updated_at DESC);
CREATE INDEX carts_customer_idx ON carts(customer_id);

CREATE TRIGGER carts_updated_at BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cart_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id    UUID        NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id UUID        NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity   INTEGER     NOT NULL CHECK (quantity > 0),
  -- Prix figé à l'ajout : le prix qui change pendant qu'un panier dort ne doit
  -- pas changer sous les yeux de la cliente sans qu'on le lui dise.
  unit_price INTEGER     NOT NULL CHECK (unit_price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cart_items_unique_variant UNIQUE (cart_id, variant_id)
);

CREATE INDEX cart_items_cart_idx ON cart_items(cart_id);

CREATE TRIGGER cart_items_updated_at BEFORE UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


/* ===========================================================================
   Commandes
   =========================================================================== */

-- Compteur par année, pour un numéro lisible du type EE-2026-000123.
CREATE TABLE order_counters (
  year       INTEGER PRIMARY KEY,
  last_value INTEGER NOT NULL DEFAULT 0
);

-- Le verrou de ligne d'un UPSERT sérialise l'attribution : deux commandes
-- simultanées ne peuvent pas recevoir le même numéro.
CREATE OR REPLACE FUNCTION next_order_number() RETURNS TEXT AS $$
DECLARE
  y INTEGER := EXTRACT(YEAR FROM now())::INTEGER;
  n INTEGER;
BEGIN
  INSERT INTO order_counters(year, last_value) VALUES (y, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = order_counters.last_value + 1
    RETURNING last_value INTO n;
  RETURN 'EE-' || y || '-' || lpad(n::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

CREATE TABLE orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number   TEXT        NOT NULL UNIQUE DEFAULT next_order_number(),
  customer_id    UUID        NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  attribution_id UUID        REFERENCES attributions(id) ON DELETE SET NULL,
  cart_id        UUID        REFERENCES carts(id) ON DELETE SET NULL,
  coupon_id      UUID        REFERENCES coupons(id) ON DELETE SET NULL,

  status         TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN
                   ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
  channel        TEXT        NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'whatsapp', 'admin')),

  subtotal       INTEGER     NOT NULL CHECK (subtotal >= 0),
  discount_total INTEGER     NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  shipping_total INTEGER     NOT NULL DEFAULT 0 CHECK (shipping_total >= 0),
  grand_total    INTEGER     NOT NULL CHECK (grand_total >= 0),
  currency       CHAR(3)     NOT NULL DEFAULT 'XOF',

  -- Adresse figée au moment de la commande. La cliente peut déménager ;
  -- l'endroit où le colis a été livré, lui, ne change pas.
  ship_to_name     TEXT      NOT NULL,
  ship_to_phone    TEXT      NOT NULL,
  ship_to_line1    TEXT      NOT NULL,
  ship_to_line2    TEXT,
  ship_to_commune  TEXT,
  ship_to_city     TEXT      NOT NULL DEFAULT 'Abidjan',
  ship_to_country  CHAR(2)   NOT NULL DEFAULT 'CI',
  ship_to_landmark TEXT,

  notes          TEXT,
  cancel_reason  TEXT,
  placed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at   TIMESTAMPTZ,
  shipped_at     TIMESTAMPTZ,
  delivered_at   TIMESTAMPTZ,
  cancelled_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT orders_totals_add_up
    CHECK (grand_total = subtotal - discount_total + shipping_total),
  CONSTRAINT orders_discount_within_subtotal
    CHECK (discount_total <= subtotal)
);

CREATE INDEX orders_customer_idx ON orders(customer_id, placed_at DESC);
CREATE INDEX orders_status_idx ON orders(status, placed_at DESC);
CREATE INDEX orders_placed_idx ON orders(placed_at DESC);
CREATE INDEX orders_attribution_idx ON orders(attribution_id);

CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Les colonnes recopiées ne sont pas de la redondance : une facture doit
-- rester lisible quand le produit a été renommé ou retiré du catalogue.
CREATE TABLE order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id    UUID        REFERENCES product_variants(id) ON DELETE SET NULL,
  product_id    UUID        REFERENCES products(id) ON DELETE SET NULL,
  product_name  TEXT        NOT NULL,
  variant_name  TEXT        NOT NULL,
  sku           TEXT        NOT NULL,
  unit_price    INTEGER     NOT NULL CHECK (unit_price >= 0),
  quantity      INTEGER     NOT NULL CHECK (quantity > 0),
  line_discount INTEGER     NOT NULL DEFAULT 0 CHECK (line_discount >= 0),
  line_total    INTEGER     NOT NULL CHECK (line_total >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT order_items_total_adds_up
    CHECK (line_total = unit_price * quantity - line_discount)
);

CREATE INDEX order_items_order_idx ON order_items(order_id);
CREATE INDEX order_items_variant_idx ON order_items(variant_id);

ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_order_fk
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;

CREATE TABLE payments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider   TEXT        NOT NULL CHECK (provider IN
               ('wave', 'orange-money', 'moov-money', 'mtn-momo', 'djamo',
                'western-union', 'cash')),
  status     TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN
               ('pending', 'authorized', 'paid', 'failed', 'refunded')),
  amount     INTEGER     NOT NULL CHECK (amount > 0),
  currency   CHAR(3)     NOT NULL DEFAULT 'XOF',
  reference  TEXT,
  -- Réponse brute de l'opérateur, gardée telle quelle pour les litiges.
  raw        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  paid_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payments_order_idx ON payments(order_id);
CREATE INDEX payments_status_idx ON payments(status);
CREATE UNIQUE INDEX payments_provider_reference_idx
  ON payments(provider, reference) WHERE reference IS NOT NULL;

CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE shipments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  zone_id            UUID        REFERENCES shipping_zones(id) ON DELETE SET NULL,
  provider           TEXT        NOT NULL DEFAULT 'internal',
  tracking_reference TEXT,
  status             TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN
                       ('pending', 'preparing', 'dispatched', 'in_transit',
                        'delivered', 'failed', 'returned')),
  fee                INTEGER     NOT NULL DEFAULT 0 CHECK (fee >= 0),
  estimated_min_days INTEGER,
  estimated_max_days INTEGER,
  dispatched_at      TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX shipments_order_idx ON shipments(order_id);
CREATE INDEX shipments_status_idx ON shipments(status);
CREATE UNIQUE INDEX shipments_tracking_idx
  ON shipments(provider, tracking_reference) WHERE tracking_reference IS NOT NULL;

CREATE TRIGGER shipments_updated_at BEFORE UPDATE ON shipments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE coupon_redemptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id         UUID        NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  order_id          UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id       UUID        REFERENCES customers(id) ON DELETE SET NULL,
  amount_discounted INTEGER     NOT NULL CHECK (amount_discounted >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coupon_redemptions_once_per_order UNIQUE (coupon_id, order_id)
);

CREATE INDEX coupon_redemptions_customer_idx ON coupon_redemptions(customer_id);


/* ===========================================================================
   Conversations et agent IA
   =========================================================================== */

CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel         TEXT        NOT NULL DEFAULT 'whatsapp'
                    CHECK (channel IN ('whatsapp', 'web', 'instagram')),
  -- Lequel des deux numéros a été utilisé : « commandes » ou « service ».
  line            TEXT        CHECK (line IN ('primary', 'secondary')),
  customer_id     UUID        REFERENCES customers(id) ON DELETE SET NULL,
  visitor_token   TEXT,
  status          TEXT        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'awaiting_human', 'closed')),
  assigned_to     UUID        REFERENCES admin_users(id) ON DELETE SET NULL,
  subject         TEXT,
  product_id      UUID        REFERENCES products(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX conversations_status_idx ON conversations(status, last_message_at DESC);
CREATE INDEX conversations_customer_idx ON conversations(customer_id);

CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction       TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  author          TEXT        NOT NULL CHECK (author IN ('customer', 'ai', 'human', 'system')),
  body            TEXT        NOT NULL,
  meta            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX messages_conversation_idx ON messages(conversation_id, created_at);

-- Singleton, garanti par la contrainte plutôt que par convention.
CREATE TABLE ai_agent_config (
  id                  BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  is_enabled          BOOLEAN     NOT NULL DEFAULT FALSE,
  model               TEXT,
  system_prompt       TEXT        NOT NULL DEFAULT '',
  temperature         NUMERIC(3,2) NOT NULL DEFAULT 0.2 CHECK (temperature BETWEEN 0 AND 2),
  max_tokens          INTEGER     NOT NULL DEFAULT 600 CHECK (max_tokens > 0),
  -- Mots qui font passer la main à un humain sans discussion.
  escalation_keywords TEXT[]      NOT NULL DEFAULT '{}',
  handoff_line        TEXT        NOT NULL DEFAULT 'secondary'
                        CHECK (handoff_line IN ('primary', 'secondary')),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER ai_agent_config_updated_at BEFORE UPDATE ON ai_agent_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- La base de connaissance de l'agent. Il répond à partir d'ici et du catalogue,
-- jamais de sa mémoire : c'est ce qui l'empêche d'inventer un prix.
CREATE TABLE ai_knowledge (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       TEXT        NOT NULL CHECK (kind IN ('faq', 'policy', 'product_note', 'brand')),
  question   TEXT        NOT NULL,
  answer     TEXT        NOT NULL,
  product_id UUID        REFERENCES products(id) ON DELETE CASCADE,
  position   INTEGER     NOT NULL DEFAULT 0,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ai_knowledge_active_idx ON ai_knowledge(is_active, kind, position);

CREATE TRIGGER ai_knowledge_updated_at BEFORE UPDATE ON ai_knowledge
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


/* ===========================================================================
   Analytique
   =========================================================================== */

-- Volumineuse par nature : BIGSERIAL plutôt qu'UUID, index pensés pour les
-- questions réellement posées (« combien de mises au panier depuis TikTok
-- cette semaine ») plutôt que pour la lecture d'une ligne isolée.
CREATE TABLE analytics_events (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT        NOT NULL CHECK (name IN
                   ('page_view', 'product_view', 'add_to_cart', 'remove_from_cart',
                    'begin_checkout', 'purchase', 'whatsapp_click', 'promotion_click',
                    'coupon_applied', 'search')),
  visitor_token  TEXT,
  session_token  TEXT,
  attribution_id UUID        REFERENCES attributions(id) ON DELETE SET NULL,
  customer_id    UUID        REFERENCES customers(id) ON DELETE SET NULL,
  cart_id        UUID        REFERENCES carts(id) ON DELETE SET NULL,
  order_id       UUID        REFERENCES orders(id) ON DELETE SET NULL,
  product_id     UUID        REFERENCES products(id) ON DELETE SET NULL,
  variant_id     UUID        REFERENCES product_variants(id) ON DELETE SET NULL,
  path           TEXT,
  value          INTEGER,
  currency       CHAR(3),
  props          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX analytics_events_name_time_idx ON analytics_events(name, created_at DESC);
CREATE INDEX analytics_events_visitor_idx ON analytics_events(visitor_token, created_at DESC);
CREATE INDEX analytics_events_attribution_idx ON analytics_events(attribution_id);
CREATE INDEX analytics_events_product_idx ON analytics_events(product_id, created_at DESC);
