ALTER TABLE store_cart_items
  ADD COLUMN mounted_on_product_id UUID REFERENCES products(id) ON DELETE RESTRICT;
