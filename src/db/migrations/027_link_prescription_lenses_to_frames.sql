ALTER TABLE sale_items
  ADD COLUMN mount_source VARCHAR(20),
  ADD COLUMN mounted_on_product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  ADD CONSTRAINT sale_items_lens_mount_valid CHECK (
    (mount_source IS NULL AND mounted_on_product_id IS NULL)
    OR (mount_source = 'SOLD_FRAME' AND mounted_on_product_id IS NOT NULL)
    OR (mount_source = 'CUSTOMER_FRAME' AND mounted_on_product_id IS NULL)
  );
