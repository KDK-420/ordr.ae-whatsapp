-- Restaurant suite: branches, kitchen fields on orders and lines, payments, held tickets, inventory.
-- Additive only; existing rows keep working (new columns are nullable or defaulted).

ALTER TABLE "Order" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Order" ADD COLUMN "tableLabel" TEXT;
ALTER TABLE "Order" ADD COLUMN "contactName" TEXT;
ALTER TABLE "Order" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "Order" ADD COLUMN "discountMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "discountReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "clientRef" TEXT;
ALTER TABLE "Order" ADD COLUMN "publicToken" TEXT;
ALTER TABLE "Order" ADD COLUMN "firedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "readyAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "completedAt" TIMESTAMP(3);

ALTER TABLE "OrderItem" ADD COLUMN "stationId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "kitchenStatus" TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE "OrderItem" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "OrderItem" ADD COLUMN "readyAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Order_publicToken_key" ON "Order"("publicToken");
CREATE UNIQUE INDEX "Order_tenantId_clientRef_key" ON "Order"("tenantId", "clientRef");
CREATE INDEX "Order_tenantId_branchId_createdAt_idx" ON "Order"("tenantId", "branchId", "createdAt");

CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "stations" JSONB NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Branch_tenantId_sortOrder_idx" ON "Branch"("tenantId", "sortOrder");

CREATE TABLE "OrderPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "branchId" TEXT,
    "method" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "tenderedMinor" INTEGER,
    "changeMinor" INTEGER,
    "reference" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderPayment_tenantId_branchId_createdAt_idx" ON "OrderPayment"("tenantId", "branchId", "createdAt");
CREATE INDEX "OrderPayment_orderId_idx" ON "OrderPayment"("orderId");
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HeldTicket" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "label" TEXT,
    "payload" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HeldTicket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HeldTicket_tenantId_branchId_createdAt_idx" ON "HeldTicket"("tenantId", "branchId", "createdAt");

CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'ingredient',
    "baseUnit" TEXT NOT NULL DEFAULT 'each',
    "unitLabel" TEXT NOT NULL DEFAULT '',
    "unitSize" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "reorderLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costMinor" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StockItem_tenantId_name_idx" ON "StockItem"("tenantId", "name");

CREATE TABLE "StockLevel" (
    "branchId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "onHand" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("branchId", "stockItemId")
);
CREATE INDEX "StockLevel_tenantId_branchId_idx" ON "StockLevel"("tenantId", "branchId");

CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitCostMinor" INTEGER,
    "refType" TEXT,
    "refId" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StockMovement_tenantId_branchId_createdAt_idx" ON "StockMovement"("tenantId", "branchId", "createdAt");
CREATE INDEX "StockMovement_tenantId_stockItemId_createdAt_idx" ON "StockMovement"("tenantId", "stockItemId", "createdAt");
CREATE INDEX "StockMovement_refType_refId_idx" ON "StockMovement"("refType", "refId");

CREATE TABLE "RecipeLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "modifierOptionId" TEXT,
    "stockItemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "appliesTo" TEXT NOT NULL DEFAULT 'all',
    CONSTRAINT "RecipeLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RecipeLine_tenantId_offeringId_idx" ON "RecipeLine"("tenantId", "offeringId");

CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "leadDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Supplier_tenantId_name_idx" ON "Supplier"("tenantId", "name");

CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT,
    "number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "lines" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "orderedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PurchaseOrder_tenantId_branchId_createdAt_idx" ON "PurchaseOrder"("tenantId", "branchId", "createdAt");
