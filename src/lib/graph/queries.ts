/**
 * graph/queries.ts — Cypher query builders for the BizBot knowledge graph.
 *
 * Node types:  Topic, Entity, Post, Audience, Platform
 * Relationships: ABOUT, MENTIONS, ENGAGES_WITH, POSTED_ON, RELATED_TO
 */

import { runRead, runWrite } from "./client";
import type { JsonObject, JsonValue } from "@/lib/agent/tools";

interface GraphSearchResult extends JsonObject {
  type: string;
  name: string;
  id: string | null;
}

interface GraphContextResult extends JsonObject {
  topic: string;
  entities: string[];
  platforms: string[];
  postCount: number;
}

// ─── Topics ──────────────────────────────────────────────────────────────────

export async function upsertTopic(name: string, description?: string) {
  return runWrite(
    `MERGE (t:Topic {name: $name})
     ON CREATE SET t.description = $description, t.createdAt = timestamp()
     ON MATCH SET t.description = COALESCE($description, t.description)
     RETURN t`,
    { name, description: description ?? null },
  );
}

export async function getRelatedTopics(topicName: string, limit = 10) {
  return runRead(
    `MATCH (t:Topic {name: $name})-[:RELATED_TO]-(related:Topic)
     RETURN related.name AS name, related.description AS description
     LIMIT $limit`,
    { name: topicName, limit },
  );
}

// ─── Entities ────────────────────────────────────────────────────────────────

export async function upsertEntity(
  id: string,
  type: string,
  name: string,
  properties: JsonObject = {},
) {
  return runWrite(
    `MERGE (e:Entity {id: $id})
     ON CREATE SET e.type = $type, e.name = $name, e.createdAt = timestamp()
     SET e += $properties
     RETURN e`,
    { id, type, name, properties },
  );
}

export async function linkEntityToTopic(entityId: string, topicName: string) {
  return runWrite(
    `MATCH (e:Entity {id: $entityId})
     MERGE (t:Topic {name: $topicName})
     MERGE (e)-[:ABOUT]->(t)`,
    { entityId, topicName },
  );
}

// ─── Posts ───────────────────────────────────────────────────────────────────

export async function createPostNode(
  postId: string,
  content: string,
  platformName: string,
) {
  return runWrite(
    `MERGE (p:Post {id: $postId})
     ON CREATE SET p.content = $content, p.createdAt = timestamp()
     WITH p
     MATCH (pl:Platform {name: $platformName})
     MERGE (p)-[:POSTED_ON]->(pl)
     RETURN p`,
    { postId, content, platformName },
  );
}

export async function linkPostToTopics(postId: string, topicNames: string[]) {
  return runWrite(
    `MATCH (p:Post {id: $postId})
     UNWIND $topicNames AS topicName
     MERGE (t:Topic {name: topicName})
     MERGE (p)-[:ABOUT]->(t)`,
    { postId, topicNames },
  );
}

// ─── Search ──────────────────────────────────────────────────────────────────

export async function searchGraph(
  query: string,
  limit = 20,
): Promise<Array<{ type: string; name: string; id?: string }>> {
  const results = await runRead<GraphSearchResult>(
    `CALL {
       MATCH (t:Topic) WHERE toLower(t.name) CONTAINS toLower($query)
       RETURN 'Topic' AS type, t.name AS name, null AS id
       UNION
       MATCH (e:Entity) WHERE toLower(e.name) CONTAINS toLower($query)
       RETURN 'Entity' AS type, e.name AS name, e.id AS id
     }
     RETURN type, name, id
     LIMIT $limit`,
    { query, limit },
  );

  return results.map((result) => ({
    type: result.type,
    name: result.name,
    ...(result.id ? { id: result.id } : {}),
  }));
}

export async function getContextForPost(
  topicNames: string[],
): Promise<GraphContextResult[]> {
  return runRead<GraphContextResult>(
    `MATCH (t:Topic) WHERE t.name IN $topicNames
     OPTIONAL MATCH (t)<-[:ABOUT]-(e:Entity)
     OPTIONAL MATCH (t)<-[:ABOUT]-(p:Post)-[:POSTED_ON]->(pl:Platform)
     RETURN t.name AS topic, 
            collect(DISTINCT e.name) AS entities, 
            collect(DISTINCT pl.name) AS platforms,
            count(DISTINCT p) AS postCount`,
    { topicNames },
  );
}
