export const DEFAULT_AGENT_USER_ID = "local-user";

export function resolveAgentUserId(userId?: string | null): string {
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  return normalizedUserId.length > 0 ? normalizedUserId : DEFAULT_AGENT_USER_ID;
}