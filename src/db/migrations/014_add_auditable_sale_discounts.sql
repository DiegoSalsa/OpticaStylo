ALTER TABLE sales
  ADD COLUMN discount_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN discount_reason VARCHAR(300);

ALTER TABLE sales
  DROP CONSTRAINT sales_total_consistency,
  ADD CONSTRAINT sales_discount_amount CHECK (
    discount_cents >= 0 AND discount_cents < subtotal_cents
  ),
  ADD CONSTRAINT sales_discount_reason_consistency CHECK (
    (
      discount_cents = 0
      AND discount_reason IS NULL
    )
    OR (
      discount_cents > 0
      AND discount_reason IS NOT NULL
      AND char_length(trim(discount_reason)) BETWEEN 1 AND 300
    )
  ),
  ADD CONSTRAINT sales_total_consistency CHECK (
    total_cents = subtotal_cents - discount_cents
  );

COMMENT ON COLUMN sales.discount_cents IS
  'Descuento manual total aplicado en POS, expresado en pesos chilenos.';

COMMENT ON COLUMN sales.discount_reason IS
  'JustificaciÃ³n auditable exigida cuando la venta tiene descuento.';
