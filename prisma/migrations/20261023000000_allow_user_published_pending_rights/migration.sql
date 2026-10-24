-- Permitir publicación explícita del propietario con derechos de terceros aún pendientes.
-- La interfaz conserva el estado REVIEW y nunca lo presenta como autorización de marca.
ALTER TABLE product_images DROP CONSTRAINT product_images_import_provenance;
ALTER TABLE product_images ADD CONSTRAINT product_images_import_provenance CHECK (
  import_key IS NULL OR (
    import_key ~ '^[0-9a-f]{64}$'
    AND provenance IS NOT NULL
    AND (
      (
        provenance->'authorization'->>'status' = 'AUTHORIZED'
        AND provenance->'authorization'->>'commercialUse' = 'true'
        AND provenance->'verification'->>'status' = 'EXACT'
      ) OR (
        provenance->'authorization'->>'status' = 'USER_PUBLISHED_PENDING_RIGHTS'
        AND provenance->'authorization'->>'commercialUse' = 'false'
        AND provenance->'verification'->>'status' = 'EXACT_CODE_CANDIDATE'
      )
    )
    AND provenance->'verification'->>'colorConfirmed' = 'true'
  ) IS TRUE
);
