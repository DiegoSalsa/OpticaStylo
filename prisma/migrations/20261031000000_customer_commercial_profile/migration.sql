-- Perfil comercial sobre las identidades existentes. No fusiona clientes ni modifica ventas históricas.
ALTER TABLE customers ADD COLUMN record_version INTEGER NOT NULL DEFAULT 1 CHECK(record_version>0),
 ADD COLUMN commercial_preferences JSONB CHECK(commercial_preferences IS NULL OR jsonb_typeof(commercial_preferences)='object');
ALTER TABLE customer_accounts ADD COLUMN email_verified_at TIMESTAMPTZ,
 ADD COLUMN clinical_link_recheck_required BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX customers_normalized_rut_lookup ON customers ((ltrim(upper(regexp_replace(rut,'[^0-9kK]','','g')),'0'))) WHERE rut IS NOT NULL;
CREATE TABLE customer_commercial_events (
 -- El audit conserva el UUID y snapshot aun si se elimina un alta sin operaciones; no propaga eliminaciones.
 id BIGSERIAL PRIMARY KEY, customer_id UUID NOT NULL,
 event_type VARCHAR(20) NOT NULL, record_version INTEGER NOT NULL, changed_fields TEXT[] NOT NULL DEFAULT '{}',
 snapshot JSONB NOT NULL, performed_by UUID REFERENCES users(id) ON DELETE RESTRICT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX customer_commercial_events_date ON customer_commercial_events(customer_id,created_at);
CREATE TABLE customer_commercial_notes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
 branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,content VARCHAR(2000) NOT NULL CHECK(btrim(content)<>''),
 created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX customer_commercial_notes_date ON customer_commercial_notes(customer_id,created_at);
CREATE TABLE customer_contact_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
 channel VARCHAR(10) NOT NULL CHECK(channel IN ('EMAIL','PHONE')),decision VARCHAR(10) NOT NULL CHECK(decision IN ('GRANTED','REVOKED')),
 source VARCHAR(30) NOT NULL CHECK(source IN ('IN_PERSON','WRITTEN','CUSTOMER_SELF')),statement_version VARCHAR(40) NOT NULL,
 evidence VARCHAR(500),destination VARCHAR(254),performed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 account_id UUID REFERENCES customer_accounts(id) ON DELETE RESTRICT,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((performed_by IS NOT NULL)::int+(account_id IS NOT NULL)::int=1),
 CHECK(decision<>'GRANTED' OR (destination IS NOT NULL AND (source='CUSTOMER_SELF' OR COALESCE(btrim(evidence),'')<>'')))
);
CREATE INDEX customer_contact_events_latest ON customer_contact_events(customer_id,channel,created_at);
CREATE TABLE customer_commerce_challenges (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
 account_id UUID REFERENCES customer_accounts(id) ON DELETE RESTRICT,sale_id UUID REFERENCES sales(id) ON DELETE RESTRICT,
 purpose VARCHAR(20) NOT NULL CHECK(purpose IN ('REGISTRATION','ORDER')),email VARCHAR(254) NOT NULL,code_hash CHAR(64) NOT NULL,
 attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),expires_at TIMESTAMPTZ NOT NULL,
 delivered_at TIMESTAMPTZ,consumed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((purpose='REGISTRATION' AND account_id IS NULL AND sale_id IS NULL) OR (purpose='ORDER' AND account_id IS NOT NULL AND sale_id IS NOT NULL))
);
CREATE INDEX customer_commerce_challenges_lookup ON customer_commerce_challenges(customer_id,purpose,created_at);
CREATE TABLE customer_order_links (
 sale_id UUID PRIMARY KEY REFERENCES sales(id) ON DELETE RESTRICT,account_id UUID NOT NULL REFERENCES customer_accounts(id) ON DELETE RESTRICT,
 challenge_id UUID NOT NULL UNIQUE REFERENCES customer_commerce_challenges(id) ON DELETE RESTRICT,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX customer_order_links_account ON customer_order_links(account_id,created_at);
CREATE FUNCTION audit_commercial_customer() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE changed TEXT[];
BEGIN
 IF TG_OP='UPDATE' THEN NEW.record_version:=OLD.record_version+1; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER customer_version BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION audit_commercial_customer();
CREATE FUNCTION record_commercial_customer() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE changed TEXT[];
BEGIN
 IF TG_OP='INSERT' THEN changed:=ARRAY['created'];
 ELSE SELECT array_agg(key) INTO changed FROM jsonb_each(to_jsonb(NEW)-'updated_at'-'record_version'-'patient_id') WHERE value IS DISTINCT FROM (to_jsonb(OLD)->key); END IF;
 INSERT INTO customer_commercial_events(customer_id,event_type,record_version,changed_fields,snapshot,performed_by)
 VALUES(NEW.id,CASE WHEN TG_OP='INSERT' THEN 'CREATED' ELSE 'UPDATED' END,NEW.record_version,COALESCE(changed,'{}'),to_jsonb(NEW)-'patient_id',nullif(current_setting('stylo.customer_actor',true),'')::uuid);
 RETURN NEW;
END $$;
CREATE TRIGGER customer_history AFTER INSERT OR UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION record_commercial_customer();
CREATE FUNCTION protect_commercial_history() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'El registro comercial conserva su trazabilidad'; END $$;
CREATE TRIGGER commercial_events_immutable BEFORE UPDATE OR DELETE ON customer_commercial_events FOR EACH ROW EXECUTE FUNCTION protect_commercial_history();
CREATE TRIGGER commercial_notes_immutable BEFORE UPDATE OR DELETE ON customer_commercial_notes FOR EACH ROW EXECUTE FUNCTION protect_commercial_history();
CREATE TRIGGER customer_contact_immutable BEFORE UPDATE OR DELETE ON customer_contact_events FOR EACH ROW EXECUTE FUNCTION protect_commercial_history();
CREATE TRIGGER customer_order_links_immutable BEFORE UPDATE OR DELETE ON customer_order_links FOR EACH ROW EXECUTE FUNCTION protect_commercial_history();
-- Se usa el libro de pagos existente. Operaciones con reembolsos/contracargos informados quedan excluidas hasta su conciliación.
CREATE VIEW commercial_purchase_facts AS
SELECT s.*,COALESCE(p.paid,0) AS paid_cents,p.last_paid_at AS purchase_at,
 (s.status IN ('PAID','IN_PREPARATION','READY','DELIVERED') AND s.total_cents>0 AND COALESCE(p.paid,0)>=s.total_cents AND NOT COALESCE(p.refund_review,FALSE)) AS is_valid_purchase,
 COALESCE(p.refund_review,FALSE) AS refund_review
FROM sales s LEFT JOIN LATERAL (
 SELECT sum(sp.amount_cents) AS paid,max(sp.paid_at) AS last_paid_at,
 bool_or(lower(COALESCE(pa.provider_status,'')) IN ('refunded','charged_back','partially_refunded')) AS refund_review
 FROM sale_payments sp LEFT JOIN payment_attempts pa ON pa.id=sp.provider_attempt_id WHERE sp.sale_id=s.id
) p ON TRUE;
ALTER TABLE transactional_email_outbox DROP CONSTRAINT transactional_email_template;
ALTER TABLE transactional_email_outbox ADD CONSTRAINT transactional_email_template CHECK(template_code IN (
 'ACCOUNT_CREATED','CUSTOMER_PATIENT_OTP','CUSTOMER_COMMERCE_OTP','APPOINTMENT_CONFIRMED','APPOINTMENT_REMINDER','ORDER_CONFIRMED','PAYMENT_CONFIRMED','POS_PAYMENT_RECEIPT','POS_FINAL_RECEIPT'));
