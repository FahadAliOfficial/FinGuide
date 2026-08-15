PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Conversation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "lastMessageAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "new_Conversation" ("id", "title", "createdAt", "updatedAt", "lastMessageAt")
SELECT
  conversation."id",
  (
    SELECT SUBSTR(message."content", 1, 80)
    FROM "Message" AS message
    WHERE message."conversationId" = conversation."id" AND message."role" = 'USER'
    ORDER BY message."createdAt" ASC, message."id" ASC
    LIMIT 1
  ),
  conversation."createdAt",
  conversation."updatedAt",
  COALESCE(
    (SELECT MAX(message."createdAt") FROM "Message" AS message WHERE message."conversationId" = conversation."id"),
    conversation."createdAt"
  )
FROM "Conversation" AS conversation;

DROP TABLE "Conversation";
ALTER TABLE "new_Conversation" RENAME TO "Conversation";
CREATE INDEX "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt");

PRAGMA foreign_keys=ON;
