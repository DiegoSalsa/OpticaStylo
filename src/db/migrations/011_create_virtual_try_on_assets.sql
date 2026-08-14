-- Registrar versiones inmutables de los recursos usados por la prueba virtual.
CREATE TABLE virtual_try_on_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  original_filename VARCHAR(255) NOT NULL,
  media_type VARCHAR(50) NOT NULL,
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0),
  file_sha256 CHAR(64) NOT NULL,
  file_data BYTEA NOT NULL,
  width_scale NUMERIC(5, 3) NOT NULL DEFAULT 2.200,
  vertical_offset NUMERIC(5, 3) NOT NULL DEFAULT 0.000,
  rotation_offset_degrees NUMERIC(5, 2) NOT NULL DEFAULT 0.000,
  notes VARCHAR(500),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  retired_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retired_at TIMESTAMPTZ,
  CONSTRAINT virtual_try_on_assets_product_version UNIQUE (product_id, version),
  CONSTRAINT virtual_try_on_assets_status CHECK (status IN ('ACTIVE', 'RETIRED')),
  CONSTRAINT virtual_try_on_assets_media_type CHECK (
    media_type IN ('image/png', 'image/webp')
  ),
  CONSTRAINT virtual_try_on_assets_file_hash CHECK (
    file_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT virtual_try_on_assets_width_scale CHECK (
    width_scale BETWEEN 1.200 AND 4.000
  ),
  CONSTRAINT virtual_try_on_assets_vertical_offset CHECK (
    vertical_offset BETWEEN -1.000 AND 1.000
  ),
  CONSTRAINT virtual_try_on_assets_rotation_offset CHECK (
    rotation_offset_degrees BETWEEN -30.000 AND 30.000
  ),
  CONSTRAINT virtual_try_on_assets_retirement CHECK (
    (
      status = 'ACTIVE'
      AND retired_by IS NULL
      AND retired_at IS NULL
    )
    OR (
      status = 'RETIRED'
      AND retired_by IS NOT NULL
      AND retired_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX virtual_try_on_assets_active_product_index
  ON virtual_try_on_assets (product_id)
  WHERE status = 'ACTIVE';

CREATE INDEX virtual_try_on_assets_product_history_index
  ON virtual_try_on_assets (product_id, version DESC);
