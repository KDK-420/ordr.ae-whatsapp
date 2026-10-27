-- Conversation: an operator typing in the inbox holds the bot's reply until this instant
ALTER TABLE "Conversation" ADD COLUMN "staffTypingUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "HandoffRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reason" TEXT,
    "preview" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAlertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alerts" INTEGER NOT NULL DEFAULT 1,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "HandoffRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HandoffRequest_tenantId_resolvedAt_createdAt_idx" ON "HandoffRequest"("tenantId", "resolvedAt", "createdAt");
CREATE INDEX "HandoffRequest_conversationId_resolvedAt_idx" ON "HandoffRequest"("conversationId", "resolvedAt");

-- AddForeignKey
ALTER TABLE "HandoffRequest" ADD CONSTRAINT "HandoffRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
