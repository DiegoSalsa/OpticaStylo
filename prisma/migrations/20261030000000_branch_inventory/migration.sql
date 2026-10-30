-- Solo estructura y ubicaciones identificadas; no crea existencias iniciales.
ALTER TABLE products ADD COLUMN inventory_mode VARCHAR(20) NOT NULL DEFAULT 'UNCONFIGURED';
ALTER TABLE products ADD CONSTRAINT products_inventory_mode CHECK (inventory_mode IN ('TRACKED','ON_DEMAND','UNCONFIGURED'));
UPDATE products SET inventory_mode = 'TRACKED' WHERE category = 'FRAME';
CREATE TABLE branches (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(80) NOT NULL UNIQUE,
 name VARCHAR(200) NOT NULL, address VARCHAR(500), information_source TEXT NOT NULL,
 is_active BOOLEAN NOT NULL DEFAULT true, pickup_enabled BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO branches(code,name,address,information_source,pickup_enabled) VALUES
 ('BARROS_ROMANO','Barros Arana, Galería Romano',NULL,'Confirmada por el cliente en el encargo de fase 2, visita 22-10-2026',true),
 ('GALERIA_PALET','Galería Palet','Barros Arana 653, local 4, Concepción','https://opticastylo.cl/ consultado 30-10-2026',true),
 ('CENTRO_MEDICO','Centro Médico','Barros Arana 457, segundo piso, Concepción','https://opticastylo.cl/ consultado 30-10-2026; retiro pendiente de habilitación',false);
CREATE TABLE user_branches (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
 PRIMARY KEY(user_id,branch_id)
);
ALTER TABLE sales ADD COLUMN branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT;
ALTER TABLE store_carts ADD COLUMN branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT;
CREATE INDEX sales_branch_status_index ON sales(branch_id,status,created_at);
CREATE TABLE inventory_stocks (
 branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
 product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
 on_hand INTEGER NOT NULL CHECK(on_hand BETWEEN 0 AND 1000000000),
 reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0 AND reserved <= on_hand),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
 counted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(branch_id,product_id)
);
CREATE TABLE inventory_reservations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
 branch_id UUID NOT NULL, product_id UUID NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity > 0), status VARCHAR(20) NOT NULL CHECK(status IN ('HELD','COMMITTED','RELEASED','EXPIRED')),
 expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(branch_id,product_id) REFERENCES inventory_stocks(branch_id,product_id) ON DELETE RESTRICT,
 UNIQUE(sale_id,product_id)
);
CREATE INDEX inventory_reservations_expiration ON inventory_reservations(status,expires_at);
CREATE TABLE inventory_transfers (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), source_id UUID NOT NULL REFERENCES branches(id),
 destination_id UUID NOT NULL REFERENCES branches(id), product_id UUID NOT NULL REFERENCES products(id),
 quantity INTEGER NOT NULL CHECK(quantity > 0), status VARCHAR(20) NOT NULL DEFAULT 'DISPATCHED' CHECK(status IN ('DISPATCHED','RECEIVED','CANCELLED')),
 reason VARCHAR(500) NOT NULL, created_by UUID NOT NULL REFERENCES users(id), completed_by UUID REFERENCES users(id),
 request_key VARCHAR(80) NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TIMESTAMPTZ, CHECK(source_id <> destination_id)
);
CREATE TABLE inventory_movements (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), branch_id UUID NOT NULL, product_id UUID NOT NULL,
 stock_version INTEGER NOT NULL, kind VARCHAR(30) NOT NULL CHECK(kind IN ('COUNT','ENTRY','EXIT','ADJUST','RESERVE','RELEASE','EXPIRE','SALE','TRANSFER_OUT','TRANSFER_IN','TRANSFER_RETURN')),
 before_on_hand INTEGER, after_on_hand INTEGER NOT NULL, before_reserved INTEGER NOT NULL, after_reserved INTEGER NOT NULL,
 reason VARCHAR(500) NOT NULL, actor_id UUID REFERENCES users(id), sale_id UUID REFERENCES sales(id), transfer_id UUID REFERENCES inventory_transfers(id),
 request_key VARCHAR(80) UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(branch_id,product_id) REFERENCES inventory_stocks(branch_id,product_id),
 UNIQUE(branch_id,product_id,stock_version)
);
CREATE INDEX inventory_movements_branch_date ON inventory_movements(branch_id,created_at DESC);
-- Toda escritura de saldos debe tener su movimiento en la misma transacción.
CREATE FUNCTION check_inventory_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM inventory_movements m WHERE m.branch_id=NEW.branch_id AND m.product_id=NEW.product_id
 AND m.stock_version=NEW.version AND m.after_on_hand=NEW.on_hand AND m.after_reserved=NEW.reserved) THEN
 RAISE EXCEPTION 'El cambio de inventario necesita un movimiento auditado'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER inventory_stock_audit AFTER INSERT OR UPDATE ON inventory_stocks
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_inventory_audit();
CREATE FUNCTION protect_inventory_stock_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.branch_id <> OLD.branch_id OR NEW.product_id <> OLD.product_id OR NEW.version <> OLD.version+1 THEN
 RAISE EXCEPTION 'La identidad del inventario es inmutable y cada cambio requiere nueva versión'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_stock_version BEFORE UPDATE ON inventory_stocks
 FOR EACH ROW EXECUTE FUNCTION protect_inventory_stock_version();
CREATE FUNCTION protect_inventory_movements() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Los movimientos de inventario son inmutables'; END $$;
CREATE TRIGGER inventory_movements_immutable BEFORE UPDATE OR DELETE ON inventory_movements
 FOR EACH ROW EXECUTE FUNCTION protect_inventory_movements();
INSERT INTO permissions(code,description) VALUES
 ('inventory.read','Consultar inventario de sucursal'),('inventory.write','Registrar movimientos de sucursal'),('inventory.manage_all','Administrar inventario de todas las sucursales');
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE
 (r.code='ADMIN' AND p.code IN ('inventory.read','inventory.write','inventory.manage_all')) OR
 (r.code='SALES' AND p.code IN ('inventory.read','inventory.write'));
