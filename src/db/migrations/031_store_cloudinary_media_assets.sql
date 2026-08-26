-- Centraliza las imágenes nuevas fuera de PostgreSQL sin perder archivos históricos.

CREATE TABLE product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 99),
  alt_text VARCHAR(300) NOT NULL CHECK (btrim(alt_text) <> ''),
  original_filename VARCHAR(255) NOT NULL,
  media_type VARCHAR(100) NOT NULL CHECK (media_type IN (
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
  )),
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes BETWEEN 1 AND 4194304),
  file_sha256 CHAR(64) NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  cloudinary_asset_id VARCHAR(100) NOT NULL UNIQUE,
  cloudinary_public_id VARCHAR(500) NOT NULL UNIQUE,
  cloudinary_version BIGINT NOT NULL CHECK (cloudinary_version > 0),
  cloudinary_url VARCHAR(2000) NOT NULL CHECK (cloudinary_url LIKE 'https://%'),
  cloudinary_format VARCHAR(30) NOT NULL,
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  retired_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retired_at TIMESTAMPTZ,
  CONSTRAINT product_images_retirement CHECK (
    (status = 'ACTIVE' AND retired_by IS NULL AND retired_at IS NULL)
    OR (status = 'RETIRED' AND retired_by IS NOT NULL AND retired_at IS NOT NULL)
  )
);

CREATE INDEX product_images_active_product_index
  ON product_images (product_id, position, id)
  WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX product_images_active_position_unique
  ON product_images (product_id, position)
  WHERE status = 'ACTIVE';

ALTER TABLE product_events DROP CONSTRAINT product_events_type;
ALTER TABLE product_events ADD CONSTRAINT product_events_type CHECK (
  event_type IN ('CREATED', 'UPDATED', 'IMAGE_ADDED', 'IMAGE_RETIRED')
);

ALTER TABLE external_prescriptions
  ADD COLUMN cloudinary_asset_id VARCHAR(100),
  ADD COLUMN cloudinary_public_id VARCHAR(500),
  ADD COLUMN cloudinary_version BIGINT,
  ADD COLUMN cloudinary_format VARCHAR(30);

ALTER TABLE external_prescriptions DROP CONSTRAINT external_prescriptions_source_consistency;
ALTER TABLE external_prescriptions ADD CONSTRAINT external_prescriptions_source_consistency CHECK (
  (
    source = 'MANUAL'
    AND file_data IS NULL
    AND original_filename IS NULL
    AND media_type IS NULL
    AND file_size_bytes IS NULL
    AND file_sha256 IS NULL
    AND cloudinary_asset_id IS NULL
    AND cloudinary_public_id IS NULL
    AND cloudinary_version IS NULL
    AND cloudinary_format IS NULL
  )
  OR (
    source = 'IMAGE'
    AND original_filename IS NOT NULL
    AND media_type IS NOT NULL
    AND file_size_bytes > 0
    AND file_sha256 IS NOT NULL
    AND (
      (file_data IS NOT NULL AND cloudinary_asset_id IS NULL AND cloudinary_public_id IS NULL
        AND cloudinary_version IS NULL AND cloudinary_format IS NULL)
      OR
      (file_data IS NULL AND cloudinary_asset_id IS NOT NULL AND cloudinary_public_id IS NOT NULL
        AND cloudinary_version > 0 AND cloudinary_format IS NOT NULL)
    )
  )
);

CREATE UNIQUE INDEX external_prescriptions_cloudinary_asset_unique
  ON external_prescriptions (cloudinary_asset_id)
  WHERE cloudinary_asset_id IS NOT NULL;

COMMENT ON TABLE product_images IS
  'Galería pública de productos almacenada en Cloudinary.';
COMMENT ON COLUMN external_prescriptions.cloudinary_asset_id IS
  'Identificador inmutable de Cloudinary para recetas privadas.';
