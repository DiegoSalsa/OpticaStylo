-- Ampliar el registro existente sin retirar imágenes ni modificar productos o existencias.
ALTER TABLE product_images ADD COLUMN provenance JSONB;
ALTER TABLE product_images ADD COLUMN import_key CHAR(64);
CREATE UNIQUE INDEX product_images_import_key_key ON product_images(import_key);
CREATE INDEX product_images_product_hash_index ON product_images(product_id, file_sha256);
ALTER TABLE product_images ADD CONSTRAINT product_images_import_provenance CHECK (
  import_key IS NULL OR (
    import_key ~ '^[0-9a-f]{64}$'
    AND provenance IS NOT NULL
    AND provenance->'authorization'->>'status' = 'AUTHORIZED'
    AND provenance->'authorization'->>'commercialUse' = 'true'
    AND provenance->'verification'->>'status' = 'EXACT'
    AND provenance->'verification'->>'colorConfirmed' = 'true'
  ) IS TRUE
);
