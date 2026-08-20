ALTER TABLE external_prescriptions
  ALTER COLUMN cart_id DROP NOT NULL,
  ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
  ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT external_prescriptions_owner CHECK (
    num_nonnulls(cart_id, customer_id) = 1
  );

CREATE INDEX external_prescriptions_customer_index
  ON external_prescriptions (customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;
