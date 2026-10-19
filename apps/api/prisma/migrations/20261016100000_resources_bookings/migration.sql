-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "durationMinutes" INTEGER,
ADD COLUMN     "resourceId" TEXT;

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'staff',
    "name" JSONB NOT NULL,
    "hours" JSONB NOT NULL DEFAULT '{}',
    "skills" JSONB NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Resource_tenantId_sortOrder_idx" ON "Resource"("tenantId", "sortOrder");

-- CreateIndex
CREATE INDEX "Order_tenantId_scheduledAt_idx" ON "Order"("tenantId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Order_resourceId_scheduledAt_idx" ON "Order"("resourceId", "scheduledAt");

