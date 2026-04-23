import type { JsonValue } from "@/lib/agent/tools";
import type { SidecarThinkingChunk, SidecarThinkingChunkKind, SidecarThinkingSnapshot, SidecarThinkingStatus } from "@/lib/sidecar/types";

const DEFAULT_THINKING_CHUNK_CAP = 150;

interface SidecarThinkingStore {
  snapshotByConversation: Map<string, SidecarThinkingSnapshot>;
}

interface StartThinkingSessionInput {
  conversationId: string;
  sessionId?: string;
  status?: SidecarThinkingStatus;
  title?: string;
  summary?: string;
}

interface AppendThinkingChunkInput {
  conversationId: string;
  kind: SidecarThinkingChunkKind;
  text: string;
  metadata?: Record<string, JsonValue>;
  chunkId?: string;
  timestamp?: string;
}

function getSidecarThinkingStore(): SidecarThinkingStore {
  const globalStore = globalThis as typeof globalThis & {
    __bizbotSidecarThinkingStore__?: SidecarThinkingStore;
  };

  if (!globalStore.__bizbotSidecarThinkingStore__) {
    globalStore.__bizbotSidecarThinkingStore__ = {
      snapshotByConversation: new Map<string, SidecarThinkingSnapshot>(),
    };
  }

  return globalStore.__bizbotSidecarThinkingStore__;
}

const thinkingStore = getSidecarThinkingStore();
const snapshotByConversation = thinkingStore.snapshotByConversation;

function cloneThinkingChunk(chunk: SidecarThinkingChunk): SidecarThinkingChunk {
  return {
    ...chunk,
    ...(chunk.metadata ? { metadata: structuredClone(chunk.metadata) } : {}),
  };
}

function cloneThinkingSnapshot(snapshot: SidecarThinkingSnapshot): SidecarThinkingSnapshot {
  return {
    ...snapshot,
    chunks: snapshot.chunks.map(cloneThinkingChunk),
  };
}

function buildChunk(input: AppendThinkingChunkInput): SidecarThinkingChunk {
  return {
    id: input.chunkId?.trim() || crypto.randomUUID(),
    kind: input.kind,
    text: input.text,
    timestamp: input.timestamp ?? new Date().toISOString(),
    ...(input.metadata ? { metadata: structuredClone(input.metadata) } : {}),
  };
}

function withIncrementedRevision(snapshot: SidecarThinkingSnapshot): SidecarThinkingSnapshot {
  return {
    ...snapshot,
    revision: snapshot.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}

function getChunkCap(): number {
  return DEFAULT_THINKING_CHUNK_CAP;
}

export function getThinkingSnapshotForConversation(conversationId: string): SidecarThinkingSnapshot | null {
  const snapshot = snapshotByConversation.get(conversationId);
  return snapshot ? cloneThinkingSnapshot(snapshot) : null;
}

export function startThinkingSession(input: StartThinkingSessionInput): SidecarThinkingSnapshot {
  const now = new Date().toISOString();
  const nextSnapshot: SidecarThinkingSnapshot = {
    conversationId: input.conversationId,
    sessionId: input.sessionId?.trim() || crypto.randomUUID(),
    status: input.status ?? "streaming",
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
    chunks: [],
    updatedAt: now,
    revision: 1,
  };

  snapshotByConversation.set(input.conversationId, nextSnapshot);
  return cloneThinkingSnapshot(nextSnapshot);
}

export function appendThinkingChunk(input: AppendThinkingChunkInput): SidecarThinkingSnapshot {
  const existing = snapshotByConversation.get(input.conversationId);
  if (!existing) {
    throw new Error("Sidecar thinking session is not active for this conversation.");
  }

  const nextChunks = [...existing.chunks, buildChunk(input)];
  const cappedChunks = nextChunks.slice(-getChunkCap());
  const nextSnapshot = withIncrementedRevision({
    ...existing,
    status: existing.status === "complete" ? "streaming" : existing.status,
    chunks: cappedChunks,
  });

  snapshotByConversation.set(input.conversationId, nextSnapshot);
  return cloneThinkingSnapshot(nextSnapshot);
}

export function completeThinkingSession(conversationId: string, summary?: string): SidecarThinkingSnapshot {
  const existing = snapshotByConversation.get(conversationId);
  if (!existing) {
    throw new Error("Sidecar thinking session is not active for this conversation.");
  }

  const nextSnapshot = withIncrementedRevision({
    ...existing,
    status: "complete",
    ...(summary?.trim() ? { summary: summary.trim() } : {}),
  });

  snapshotByConversation.set(conversationId, nextSnapshot);
  return cloneThinkingSnapshot(nextSnapshot);
}

export function failThinkingSession(conversationId: string, errorText: string): SidecarThinkingSnapshot {
  const existing = snapshotByConversation.get(conversationId);
  if (!existing) {
    throw new Error("Sidecar thinking session is not active for this conversation.");
  }

  const nextSnapshot = withIncrementedRevision({
    ...existing,
    status: "error",
    summary: errorText,
  });

  snapshotByConversation.set(conversationId, nextSnapshot);
  return cloneThinkingSnapshot(nextSnapshot);
}

export function clearThinkingSession(conversationId: string): void {
  snapshotByConversation.delete(conversationId);
}

export function resetThinkingSessionsForTests(): void {
  snapshotByConversation.clear();
}