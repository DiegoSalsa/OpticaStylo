CREATE TABLE virtual_try_on_3d_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  original_filename VARCHAR(255) NOT NULL,
  media_type VARCHAR(100) NOT NULL DEFAULT 'model/gltf-binary',
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes BETWEEN 1 AND 52428800),
  file_sha256 CHAR(64) NOT NULL,
  model_data BYTEA NOT NULL,
  model_metadata JSONB NOT NULL,
  license_code VARCHAR(40) NOT NULL,
  attribution_text VARCHAR(500),
  source_url VARCHAR(1000),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  retired_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retired_at TIMESTAMPTZ,
  CONSTRAINT virtual_try_on_3d_status CHECK (status IN ('ACTIVE', 'RETIRED')),
  CONSTRAINT virtual_try_on_3d_media_type CHECK (media_type = 'model/gltf-binary'),
  CONSTRAINT virtual_try_on_3d_hash CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT virtual_try_on_3d_license CHECK (
    license_code IN ('CC0-1.0', 'CC-BY-4.0', 'OWNED_BY_OPTICA_STYLO')
  ),
  CONSTRAINT virtual_try_on_3d_attribution CHECK (
    license_code <> 'CC-BY-4.0'
    OR (attribution_text IS NOT NULL AND char_length(trim(attribution_text)) > 0)
  ),
  CONSTRAINT virtual_try_on_3d_retirement CHECK (
    (status = 'ACTIVE' AND retired_by IS NULL AND retired_at IS NULL)
    OR (status = 'RETIRED' AND retired_by IS NOT NULL AND retired_at IS NOT NULL)
  ),
  UNIQUE (product_id, version)
);

CREATE UNIQUE INDEX virtual_try_on_3d_one_active_per_product
  ON virtual_try_on_3d_assets (product_id)
  WHERE status = 'ACTIVE';

CREATE INDEX virtual_try_on_3d_product_history
  ON virtual_try_on_3d_assets (product_id, version DESC);

COMMENT ON TABLE virtual_try_on_3d_assets IS
  'Catálogo GLB versionado para prueba virtual 3D. Solo admite activos propios o licencias libres aprobadas.';
