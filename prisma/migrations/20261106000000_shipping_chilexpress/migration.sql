-- AlterTable
ALTER TABLE "products" ADD COLUMN     "shipping_logistics" JSONB;

-- Preserve historical MOCK/EXTERNAL rows. New code only emits explicit sources.
ALTER TABLE store_carts DROP CONSTRAINT store_carts_shipping_source;
ALTER TABLE store_carts ADD CONSTRAINT store_carts_shipping_source CHECK (shipping_quote_source IS NULL OR shipping_quote_source IN ('MOCK','EXTERNAL','SYNTHETIC','CHILEXPRESS'));
ALTER TABLE sales DROP CONSTRAINT sales_shipping_source;
ALTER TABLE sales ADD CONSTRAINT sales_shipping_source CHECK (shipping_quote_source IS NULL OR shipping_quote_source IN ('MOCK','EXTERNAL','SYNTHETIC','CHILEXPRESS'));
ALTER TABLE transactional_email_outbox DROP CONSTRAINT transactional_email_template;
ALTER TABLE transactional_email_outbox ADD CONSTRAINT transactional_email_template CHECK (template_code IN ('ACCOUNT_CREATED','CUSTOMER_PATIENT_OTP','CUSTOMER_COMMERCE_OTP','APPOINTMENT_CONFIRMED','APPOINTMENT_REMINDER','ORDER_CONFIRMED','PAYMENT_CONFIRMED','POS_PAYMENT_RECEIPT','POS_FINAL_RECEIPT','SHIPPING_UPDATE'));

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "shipping_quote_id" UUID;

-- AlterTable
ALTER TABLE "store_carts" ADD COLUMN     "shipping_destination" JSONB,
ADD COLUMN     "shipping_quote_id" UUID;

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "shipping_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shipping_origin" JSONB;

-- CreateTable
CREATE TABLE "shipping_packaging" (
    "code" VARCHAR(40) NOT NULL,
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "tare_weight_kg" DECIMAL(8,2) NOT NULL,
    "height_cm" DECIMAL(8,2) NOT NULL,
    "width_cm" DECIMAL(8,2) NOT NULL,
    "length_cm" DECIMAL(8,2) NOT NULL,
    "max_units" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_packaging_pkey" PRIMARY KEY ("code")
);
ALTER TABLE shipping_packaging ADD CONSTRAINT shipping_packaging_values CHECK (tare_weight_kg >= 0 AND height_cm > 0 AND height_cm <= 200 AND width_cm > 0 AND width_cm <= 200 AND length_cm > 0 AND length_cm <= 200 AND max_units > 0 AND max_units <= 100);

-- CreateTable
CREATE TABLE "shipping_quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cart_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "environment" VARCHAR(20) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "service_code" VARCHAR(20) NOT NULL,
    "service_name" VARCHAR(200) NOT NULL,
    "conditions" TEXT NOT NULL,
    "provider_cost" BIGINT NOT NULL,
    "customer_charge" BIGINT NOT NULL,
    "free_threshold" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shipping_quotes_pkey" PRIMARY KEY ("id")
);
ALTER TABLE shipping_quotes ADD CONSTRAINT shipping_quote_values CHECK (provider_cost >= 0 AND customer_charge >= 0 AND customer_charge <= provider_cost AND free_threshold >= 0 AND environment IN ('synthetic','test','production'));

-- CreateTable
CREATE TABLE "shipping_shipments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sale_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "state" VARCHAR(30) NOT NULL DEFAULT 'PENDING_PREPARATION',
    "reference" VARCHAR(80) NOT NULL,
    "ot" VARCHAR(80),
    "certificate" VARCHAR(80),
    "label_data" BYTEA,
    "label_mime" VARCHAR(40),
    "issued_service" VARCHAR(200),
    "last_checked_at" TIMESTAMPTZ(6),
    "next_sync_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(80),
    "provider_status" VARCHAR(300),
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "handed_over_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shipping_shipments_pkey" PRIMARY KEY ("id")
);
ALTER TABLE shipping_shipments ADD CONSTRAINT shipping_shipment_state CHECK (state IN ('PENDING_PREPARATION','PREPARED','ISSUING','UNCERTAIN','OT_ISSUED','HANDED_OVER','IN_TRANSIT','DELIVERED','EXCEPTION','CANCELLED'));

-- CreateTable
CREATE TABLE "shipping_tracking_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "location" VARCHAR(200),
    "motive" VARCHAR(300),
    "occurred_at" TIMESTAMPTZ(6),
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_operations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "actor_id" UUID,
    "operation" VARCHAR(40) NOT NULL,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipping_quotes_cart_id_expires_at_idx" ON "shipping_quotes"("cart_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_shipments_sale_id_key" ON "shipping_shipments"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_shipments_quote_id_key" ON "shipping_shipments"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_shipments_reference_key" ON "shipping_shipments"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_shipments_ot_key" ON "shipping_shipments"("ot");

-- CreateIndex
CREATE INDEX "shipping_shipments_state_next_sync_at_idx" ON "shipping_shipments"("state", "next_sync_at");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_tracking_events_shipment_id_fingerprint_key" ON "shipping_tracking_events"("shipment_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "sales_shipping_quote_id_key" ON "sales"("shipping_quote_id");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_shipping_quote_id_fkey" FOREIGN KEY ("shipping_quote_id") REFERENCES "shipping_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_quotes" ADD CONSTRAINT "shipping_quotes_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "store_carts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_shipments" ADD CONSTRAINT "shipping_shipments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_shipments" ADD CONSTRAINT "shipping_shipments_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "shipping_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_tracking_events" ADD CONSTRAINT "shipping_tracking_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipping_shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_operations" ADD CONSTRAINT "shipping_operations_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipping_shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

