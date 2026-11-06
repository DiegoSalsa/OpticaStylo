-- Conserva las sesiones y pagos históricos sin atribuirlos por aproximación horaria.
CREATE TABLE cash_register_terminals (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
 name VARCHAR(100) NOT NULL CHECK (name=btrim(name) AND name<>''), is_active BOOLEAN NOT NULL DEFAULT true,
 CONSTRAINT cash_register_terminals_branch_id_name_key UNIQUE(branch_id,name)
);
ALTER TABLE cash_register_sessions ADD COLUMN branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
 ADD COLUMN terminal_id UUID REFERENCES cash_register_terminals(id) ON DELETE RESTRICT,
 ADD COLUMN closing_summary JSONB,
 ADD CONSTRAINT cash_register_location CHECK ((branch_id IS NULL)=(terminal_id IS NULL));
ALTER TABLE cash_register_sessions ALTER COLUMN is_test_configuration SET DEFAULT false;
DROP INDEX cash_register_one_open_session;
CREATE UNIQUE INDEX cash_register_terminal_open ON cash_register_sessions(terminal_id) WHERE status='OPEN';
CREATE UNIQUE INDEX cash_register_legacy_open ON cash_register_sessions(status) WHERE status='OPEN' AND terminal_id IS NULL;
ALTER TABLE sale_payments ADD COLUMN cash_session_id UUID REFERENCES cash_register_sessions(id) ON DELETE RESTRICT,
 ADD COLUMN request_hash VARCHAR(64);
ALTER TABLE sales ADD COLUMN cash_session_id UUID REFERENCES cash_register_sessions(id) ON DELETE RESTRICT;
CREATE INDEX cash_register_payments_session ON sale_payments(cash_session_id,paid_at);
CREATE INDEX cash_register_sales_session ON sales(cash_session_id,status);
ALTER TABLE sales DROP CONSTRAINT sales_payment_method;
ALTER TABLE sales ADD CONSTRAINT sales_payment_method CHECK(payment_method IS NULL OR payment_method IN ('CASH','BANK_TRANSFER','MERCADO_PAGO','TRANSBANK','GETNET','MIXED'));
ALTER TABLE cash_register_movements ADD COLUMN payment_id UUID UNIQUE REFERENCES sale_payments(id) ON DELETE RESTRICT,
 ADD COLUMN reversal_of UUID UNIQUE REFERENCES cash_register_movements(id) ON DELETE RESTRICT,
 ADD COLUMN request_key VARCHAR(80) UNIQUE;
ALTER TABLE cash_register_movements DROP CONSTRAINT cash_register_movements_type;
ALTER TABLE cash_register_movements ADD CONSTRAINT cash_register_movements_type CHECK(movement_type IN ('MANUAL_IN','MANUAL_OUT','WITHDRAWAL','PAYMENT','REVERSAL')),
 ADD CONSTRAINT cash_movement_links CHECK((movement_type='PAYMENT')=(payment_id IS NOT NULL) AND (movement_type='REVERSAL')=(reversal_of IS NOT NULL));

CREATE FUNCTION protect_cash_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Las sesiones de caja no se eliminan'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.status='CLOSED' OR NEW.opened_by<>OLD.opened_by OR NEW.opened_at<>OLD.opened_at OR NEW.opening_amount_cents<>OLD.opening_amount_cents
   OR NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.terminal_id IS DISTINCT FROM OLD.terminal_id
   OR NEW.opening_notes IS DISTINCT FROM OLD.opening_notes OR NEW.is_test_configuration<>OLD.is_test_configuration THEN
   RAISE EXCEPTION 'La apertura y el cierre histórico son inmutables'; END IF;
 END IF;
 IF NEW.terminal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cash_register_terminals t WHERE t.id=NEW.terminal_id AND t.branch_id=NEW.branch_id) THEN
  RAISE EXCEPTION 'La caja no pertenece a la sucursal'; END IF;
 IF NEW.status='CLOSED' AND NEW.branch_id IS NOT NULL AND (NEW.closing_summary IS NULL OR NEW.difference_cents<>NEW.closing_counted_cents-NEW.expected_amount_cents OR (NEW.difference_cents<>0 AND COALESCE(btrim(NEW.closing_notes),'')='')) THEN
  RAISE EXCEPTION 'El cierre requiere arqueo y justificación de diferencias'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cash_session_guard BEFORE INSERT OR UPDATE OR DELETE ON cash_register_sessions FOR EACH ROW EXECUTE FUNCTION protect_cash_session();

CREATE FUNCTION protect_session_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s cash_register_sessions; sale_branch UUID;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Los pagos recibidos no se modifican ni eliminan'; END IF;
 IF NEW.cash_session_id IS NOT NULL THEN
  SELECT * INTO s FROM cash_register_sessions WHERE id=NEW.cash_session_id FOR UPDATE;
  SELECT branch_id INTO sale_branch FROM sales WHERE id=NEW.sale_id;
  IF s.status<>'OPEN' OR s.branch_id IS NULL OR s.branch_id IS DISTINCT FROM sale_branch THEN RAISE EXCEPTION 'El pago requiere una sesión abierta de la misma sucursal'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER session_payment_guard BEFORE INSERT OR UPDATE OR DELETE ON sale_payments FOR EACH ROW EXECUTE FUNCTION protect_session_payment();

CREATE FUNCTION protect_cash_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s cash_register_sessions; original cash_register_movements;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Los movimientos solo se corrigen con reversos'; END IF;
 SELECT * INTO s FROM cash_register_sessions WHERE id=NEW.session_id FOR UPDATE;
 IF s.status<>'OPEN' OR s.branch_id IS NULL THEN RAISE EXCEPTION 'La sesión no admite movimientos'; END IF;
 IF NEW.payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sale_payments p WHERE p.id=NEW.payment_id AND p.cash_session_id=NEW.session_id AND p.payment_method='CASH' AND p.amount_cents=NEW.amount_cents) THEN RAISE EXCEPTION 'El movimiento no corresponde al efectivo cobrado'; END IF;
 IF NEW.reversal_of IS NOT NULL THEN
  SELECT * INTO original FROM cash_register_movements WHERE id=NEW.reversal_of;
  IF original.session_id<>NEW.session_id OR original.movement_type NOT IN ('MANUAL_IN','MANUAL_OUT','WITHDRAWAL') OR original.amount_cents<>NEW.amount_cents THEN RAISE EXCEPTION 'El reverso no corresponde a un movimiento manual de esta sesión'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cash_movement_guard BEFORE INSERT OR UPDATE OR DELETE ON cash_register_movements FOR EACH ROW EXECUTE FUNCTION protect_cash_movement();
CREATE FUNCTION check_cash_payment_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.cash_session_id IS NOT NULL AND NEW.payment_method='CASH' AND NOT EXISTS(SELECT 1 FROM cash_register_movements m WHERE m.payment_id=NEW.id AND m.session_id=NEW.cash_session_id AND m.amount_cents=NEW.amount_cents) THEN RAISE EXCEPTION 'El cobro en efectivo requiere movimiento de caja'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER cash_payment_audit AFTER INSERT ON sale_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_cash_payment_audit();
CREATE FUNCTION protect_commercial_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Los comprobantes comerciales no se eliminan'; END IF;
 IF NEW.id<>OLD.id OR NEW.receipt_number<>OLD.receipt_number OR NEW.sale_id<>OLD.sale_id OR NEW.payload<>OLD.payload OR NEW.issued_at<>OLD.issued_at
 OR NEW.payment_id IS DISTINCT FROM OLD.payment_id OR NEW.receipt_type<>OLD.receipt_type OR NEW.generated_by<>OLD.generated_by OR NEW.emailed_to IS DISTINCT FROM OLD.emailed_to THEN
 RAISE EXCEPTION 'El contenido histórico del comprobante es inmutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER commercial_receipt_guard BEFORE UPDATE OR DELETE ON sale_receipts FOR EACH ROW EXECUTE FUNCTION protect_commercial_receipt();
INSERT INTO permissions(code,description) VALUES ('cash.read','Consultar caja e historial'),('cash.operate','Abrir, cobrar, mover y cerrar caja propia'),('cash.adjust','Reversar movimientos manuales'),('cash.manage_all','Gestionar cajas de todas las sucursales');
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE
 (r.code='ADMIN' AND p.code LIKE 'cash.%') OR (r.code='SALES' AND p.code IN ('cash.read','cash.operate'));
