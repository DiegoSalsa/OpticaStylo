DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM product_images) THEN
    RAISE EXCEPTION 'No se puede revertir la migración mientras existan imágenes de productos en Cloudinary.';
  END IF;
  IF EXISTS (SELECT 1 FROM product_events WHERE event_type IN ('IMAGE_ADDED', 'IMAGE_RETIRED')) THEN
    RAISE EXCEPTION 'No se puede revertir la migración mientras existan eventos de imágenes de productos.';
  END IF;
  IF EXISTS (SELECT 1 FROM external_prescriptions WHERE cloudinary_asset_id IS NOT NULL) THEN
    RAISE EXCEPTION 'No se puede revertir la migración mientras existan recetas almacenadas en Cloudinary.';
  END IF;
END $$;

DROP INDEX external_prescriptions_cloudinary_asset_unique;
DROP INDEX product_images_active_position_unique;
ALTER TABLE external_prescriptions DROP CONSTRAINT external_prescriptions_source_consistency;
ALTER TABLE external_prescriptions ADD CONSTRAINT external_prescriptions_source_consistency CHECK (
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
);
ALTER TABLE external_prescriptions
  DROP COLUMN cloudinary_format,
  DROP COLUMN cloudinary_version,
  DROP COLUMN cloudinary_public_id,
  DROP COLUMN cloudinary_asset_id;

ALTER TABLE product_events DROP CONSTRAINT product_events_type;
ALTER TABLE product_events ADD CONSTRAINT product_events_type CHECK (
  event_type IN ('CREATED', 'UPDATED')
);
DROP TABLE product_images;
