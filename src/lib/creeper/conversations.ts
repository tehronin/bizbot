import { db } from "@/lib/db";

export async function getConversationCompanyProfileId(conversationId: string | undefined): Promise<string | null> {
  if (!conversationId) {
    return null;
  }

  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { companyProfileId: true },
  });

  return conversation?.companyProfileId ?? null;
}

export async function requireConversationCompanyProfileId(conversationId: string | undefined): Promise<string> {
  const companyProfileId = await getConversationCompanyProfileId(conversationId);
  if (!companyProfileId) {
    throw new Error("No company profile is selected for this conversation yet.");
  }

  return companyProfileId;
}