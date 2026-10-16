-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'UTILITY',
    "purpose" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "metaId" TEXT,
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageTemplate_tenantId_purpose_status_idx" ON "MessageTemplate"("tenantId", "purpose", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_tenantId_name_language_key" ON "MessageTemplate"("tenantId", "name", "language");
