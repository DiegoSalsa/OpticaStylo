UPDATE products
SET requires_prescription = FALSE
WHERE category <> 'PRESCRIPTION_LENS'
  AND requires_prescription = TRUE;

ALTER TABLE products
ADD CONSTRAINT products_prescription_only_for_lenses CHECK (
  category = 'PRESCRIPTION_LENS' OR requires_prescription = FALSE
);
