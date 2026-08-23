ALTER TABLE sale_items
  DROP CONSTRAINT sale_items_lens_mount_valid,
  DROP COLUMN mounted_on_product_id,
  DROP COLUMN mount_source;
