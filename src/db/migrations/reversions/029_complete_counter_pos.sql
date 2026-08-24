ALTER TABLE customers
  ALTER COLUMN last_names SET NOT NULL,
  ALTER COLUMN phone SET NOT NULL,
  ALTER COLUMN email SET NOT NULL,
  ALTER COLUMN address SET NOT NULL,
  DROP CONSTRAINT customers_names_normalized,
  DROP CONSTRAINT customers_phone_format,
  DROP CONSTRAINT customers_email_normalized,
  DROP CONSTRAINT customers_address_normalized,
  ADD CONSTRAINT customers_names_normalized CHECK (
    first_names = btrim(first_names)
    AND first_names <> ''
    AND last_names = btrim(last_names)
    AND last_names <> ''
  ),
  ADD CONSTRAINT customers_phone_format CHECK (phone ~ '^\+?[0-9]{8,15}$'),
  ADD CONSTRAINT customers_email_normalized CHECK (
    email = lower(btrim(email)) AND email <> ''
  ),
  ADD CONSTRAINT customers_address_normalized CHECK (
    address = btrim(address) AND address <> ''
  );

DROP TABLE cash_register_movements;
DROP TABLE cash_register_sessions;

DROP INDEX sale_payments_request_key_unique;
ALTER TABLE sale_payments
  DROP CONSTRAINT sale_payments_cash_consistency,
  DROP CONSTRAINT sale_payments_request_key_normalized,
  DROP COLUMN change_cents,
  DROP COLUMN cash_received_cents,
  DROP COLUMN request_key;

DROP TABLE discount_authorization_grants;

DROP INDEX sales_actor_request_key_unique;
ALTER TABLE sales
  DROP CONSTRAINT sales_request_key_normalized,
  DROP COLUMN request_key;
