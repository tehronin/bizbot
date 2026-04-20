ALTER TABLE "Conversation"
DROP CONSTRAINT "Conversation_builderProjectId_fkey";

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_builderProjectId_fkey"
FOREIGN KEY ("builderProjectId") REFERENCES "BuilderProject"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;