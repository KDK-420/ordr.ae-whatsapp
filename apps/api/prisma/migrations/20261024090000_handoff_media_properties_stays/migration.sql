-- Conversation: when the thread was handed to a person and when staff last replied
ALTER TABLE "Conversation" ADD COLUMN "handedOverAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN "lastStaffReplyAt" TIMESTAMP(3);

-- Offering: room types (type = "stay") belong to a property, sleep maxGuests and exist in units
ALTER TABLE "Offering" ADD COLUMN "propertyId" TEXT;
ALTER TABLE "Offering" ADD COLUMN "maxGuests" INTEGER;
ALTER TABLE "Offering" ADD COLUMN "units" INTEGER;

-- Order: stays carry check-out, guests and the property
ALTER TABLE "Order" ADD COLUMN "checkOutAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "guests" INTEGER;
ALTER TABLE "Order" ADD COLUMN "propertyId" TEXT;

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "address" TEXT,
    "mapsUrl" TEXT,
    "phone" TEXT,
    "checkInTime" TEXT NOT NULL DEFAULT '15:00',
    "checkOutTime" TEXT NOT NULL DEFAULT '12:00',
    "amenities" JSONB NOT NULL DEFAULT '[]',
    "imageUrls" JSONB NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Property_tenantId_sortOrder_idx" ON "Property"("tenantId", "sortOrder");
CREATE INDEX "MediaAsset_tenantId_idx" ON "MediaAsset"("tenantId");
CREATE INDEX "Offering_tenantId_propertyId_idx" ON "Offering"("tenantId", "propertyId");
CREATE INDEX "Order_tenantId_propertyId_scheduledAt_idx" ON "Order"("tenantId", "propertyId", "scheduledAt");

-- AddForeignKey
ALTER TABLE "Offering" ADD CONSTRAINT "Offering_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
