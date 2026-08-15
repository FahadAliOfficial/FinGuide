CREATE TABLE "Conversation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Message" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "FinancialProduct" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "annualInterestRate" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Calculation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "messageId" TEXT NOT NULL,
  "productId" TEXT,
  "type" TEXT NOT NULL,
  "inputs" JSONB NOT NULL,
  "result" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "formulaVersion" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Calculation_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Calculation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "FinancialProduct" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FinancialProduct_name_key" ON "FinancialProduct"("name");
CREATE UNIQUE INDEX "FinancialProduct_normalizedName_key" ON "FinancialProduct"("normalizedName");
CREATE UNIQUE INDEX "Calculation_messageId_key" ON "Calculation"("messageId");
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX "Calculation_type_createdAt_idx" ON "Calculation"("type", "createdAt");

