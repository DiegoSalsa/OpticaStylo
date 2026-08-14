-- Crear cuentas de compradores, carritos, entrega y recetas externas.
ALTER TABLE customers
  ALTER COLUMN created_by DROP NOT NULL,
  ALTER COLUMN updated_by DROP NOT NULL;

CREATE TABLE customer_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL UNIQUE REFERENCES customers(id) ON DELETE RESTRICT,
  email VARCHAR(254) NOT NULL,
  password_hash TEXT NOT NULL CHECK (length(password_hash) >= 20),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customer_accounts_email_normalized CHECK (
    email = lower(btrim(email)) AND email <> ''
  )
);

CREATE UNIQUE INDEX customer_accounts_email_unique
  ON customer_accounts (lower(email));

CREATE TRIGGER customer_accounts_set_updated_at
BEFORE UPDATE ON customer_accounts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE customer_account_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  created_ip INET,
  user_agent VARCHAR(512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customer_account_sessions_token_hash CHECK (
    token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT customer_account_sessions_expiration CHECK (expires_at > created_at),
  CONSTRAINT customer_account_sessions_revocation CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  )
);

CREATE INDEX customer_account_sessions_account_index
  ON customer_account_sessions (account_id);
CREATE INDEX customer_account_sessions_expiration_index
  ON customer_account_sessions (expires_at);

ALTER TABLE products DROP CONSTRAINT products_category;
ALTER TABLE products ADD CONSTRAINT products_category CHECK (
  category IN (
    'FRAME',
    'PRESCRIPTION_LENS',
    'TREATMENT',
    'ACCESSORY',
    'OTHER'
  )
);

CREATE TABLE store_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash CHAR(64) NOT NULL UNIQUE,
  customer_account_id UUID REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  buyer_rut VARCHAR(10),
  buyer_first_names VARCHAR(150),
  buyer_last_names VARCHAR(150),
  buyer_phone VARCHAR(16),
  buyer_email VARCHAR(254),
  buyer_address VARCHAR(500),
  fulfillment_method VARCHAR(20),
  delivery_address VARCHAR(500),
  delivery_city VARCHAR(120),
  delivery_region VARCHAR(120),
  delivery_notes VARCHAR(500),
  shipping_fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (shipping_fee_cents >= 0),
  shipping_quote_source VARCHAR(20),
  clinical_prescription_id UUID REFERENCES optical_prescriptions(id) ON DELETE RESTRICT,
  sale_id UUID UNIQUE REFERENCES sales(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  checked_out_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT store_carts_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT store_carts_status CHECK (
    status IN ('ACTIVE', 'CHECKED_OUT', 'ABANDONED')
  ),
  CONSTRAINT store_carts_fulfillment CHECK (
    fulfillment_method IS NULL OR fulfillment_method IN ('PICKUP', 'DELIVERY')
  ),
  CONSTRAINT store_carts_shipping_source CHECK (
    shipping_quote_source IS NULL OR shipping_quote_source IN ('MOCK', 'EXTERNAL')
  ),
  CONSTRAINT store_carts_prescription_choice CHECK (
    clinical_prescription_id IS NULL OR customer_account_id IS NOT NULL
  ),
  CONSTRAINT store_carts_checkout_consistency CHECK (
    (
      status = 'CHECKED_OUT'
      AND sale_id IS NOT NULL
      AND checked_out_at IS NOT NULL
      AND buyer_rut IS NOT NULL
      AND buyer_first_names IS NOT NULL
      AND buyer_last_names IS NOT NULL
      AND buyer_phone IS NOT NULL
      AND buyer_email IS NOT NULL
      AND buyer_address IS NOT NULL
      AND fulfillment_method IS NOT NULL
    )
    OR (
      status <> 'CHECKED_OUT'
      AND sale_id IS NULL
      AND checked_out_at IS NULL
    )
  ),
  CONSTRAINT store_carts_delivery_consistency CHECK (
    fulfillment_method <> 'DELIVERY'
    OR (
      delivery_address IS NOT NULL
      AND delivery_city IS NOT NULL
      AND delivery_region IS NOT NULL
      AND shipping_quote_source IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX store_carts_active_account_index
  ON store_carts (customer_account_id)
  WHERE customer_account_id IS NOT NULL AND status = 'ACTIVE';
CREATE INDEX store_carts_expiration_index
  ON store_carts (status, expires_at);

CREATE TRIGGER store_carts_set_updated_at
BEFORE UPDATE ON store_carts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE store_cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES store_carts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT store_cart_items_product_unique UNIQUE (cart_id, product_id)
);

CREATE INDEX store_cart_items_cart_index
  ON store_cart_items (cart_id, created_at, id);

CREATE TRIGGER store_cart_items_set_updated_at
BEFORE UPDATE ON store_cart_items
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TABLE external_prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL UNIQUE REFERENCES store_carts(id) ON DELETE CASCADE,
  source VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  original_filename VARCHAR(255),
  media_type VARCHAR(100),
  file_size_bytes INTEGER,
  file_sha256 CHAR(64),
  file_data BYTEA,
  extraction_status VARCHAR(30) NOT NULL DEFAULT 'NOT_REQUESTED',
  extraction_provider VARCHAR(50),
  extracted_data JSONB,
  confirmed_data JSONB,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT external_prescriptions_source CHECK (source IN ('MANUAL', 'IMAGE')),
  CONSTRAINT external_prescriptions_status CHECK (status IN ('DRAFT', 'READY')),
  CONSTRAINT external_prescriptions_extraction_status CHECK (
    extraction_status IN (
      'NOT_REQUESTED', 'PENDING', 'COMPLETED', 'FAILED', 'NOT_CONFIGURED'
    )
  ),
  CONSTRAINT external_prescriptions_file_hash CHECK (
    file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT external_prescriptions_source_consistency CHECK (
    (
      source = 'MANUAL'
      AND file_data IS NULL
      AND original_filename IS NULL
      AND media_type IS NULL
      AND file_size_bytes IS NULL
      AND file_sha256 IS NULL
    )
    OR (
      source = 'IMAGE'
      AND file_data IS NOT NULL
      AND original_filename IS NOT NULL
      AND media_type IS NOT NULL
      AND file_size_bytes > 0
      AND file_sha256 IS NOT NULL
    )
  ),
  CONSTRAINT external_prescriptions_ready_consistency CHECK (
    (
      status = 'READY'
      AND confirmed_data IS NOT NULL
      AND confirmed_at IS NOT NULL
    )
    OR (
      status = 'DRAFT'
      AND confirmed_at IS NULL
    )
  )
);

CREATE INDEX external_prescriptions_status_index
  ON external_prescriptions (status, created_at);

CREATE TRIGGER external_prescriptions_set_updated_at
BEFORE UPDATE ON external_prescriptions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

ALTER TABLE sales
  ADD COLUMN origin VARCHAR(20) NOT NULL DEFAULT 'IN_STORE',
  ADD COLUMN external_prescription_id UUID
    REFERENCES external_prescriptions(id) ON DELETE RESTRICT,
  ADD COLUMN fulfillment_method VARCHAR(20),
  ADD COLUMN delivery_address VARCHAR(500),
  ADD COLUMN delivery_city VARCHAR(120),
  ADD COLUMN delivery_region VARCHAR(120),
  ADD COLUMN delivery_notes VARCHAR(500),
  ADD COLUMN shipping_fee_cents BIGINT NOT NULL DEFAULT 0
    CHECK (shipping_fee_cents >= 0),
  ADD COLUMN shipping_quote_source VARCHAR(20),
  DROP CONSTRAINT sales_total_consistency,
  ADD CONSTRAINT sales_origin CHECK (origin IN ('IN_STORE', 'ONLINE')),
  ADD CONSTRAINT sales_prescription_choice CHECK (
    prescription_id IS NULL OR external_prescription_id IS NULL
  ),
  ADD CONSTRAINT sales_fulfillment CHECK (
    fulfillment_method IS NULL OR fulfillment_method IN ('PICKUP', 'DELIVERY')
  ),
  ADD CONSTRAINT sales_shipping_source CHECK (
    shipping_quote_source IS NULL OR shipping_quote_source IN ('MOCK', 'EXTERNAL')
  ),
  ADD CONSTRAINT sales_total_consistency CHECK (
    subtotal_cents + shipping_fee_cents = total_cents
  ),
  ADD CONSTRAINT sales_online_consistency CHECK (
    origin <> 'ONLINE'
    OR fulfillment_method IS NOT NULL
  ),
  ADD CONSTRAINT sales_delivery_consistency CHECK (
    fulfillment_method <> 'DELIVERY'
    OR (
      delivery_address IS NOT NULL
      AND delivery_city IS NOT NULL
      AND delivery_region IS NOT NULL
      AND shipping_quote_source IS NOT NULL
    )
  );

CREATE INDEX sales_external_prescription_index
  ON sales (external_prescription_id)
  WHERE external_prescription_id IS NOT NULL;
CREATE INDEX sales_origin_date_index
  ON sales (origin, created_at DESC);
