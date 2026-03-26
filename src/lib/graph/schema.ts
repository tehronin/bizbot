/**
 * graph/schema.ts — Initialize Memgraph schema constraints and indexes.
 * Run once on startup to ensure graph schema is ready.
 */

import { runWrite } from "./client";

const SCHEMA_QUERIES = [
  // Node constraints (uniqueness)
  "CREATE CONSTRAINT ON (t:Topic) ASSERT t.name IS UNIQUE;",
  "CREATE CONSTRAINT ON (e:Entity) ASSERT e.id IS UNIQUE;",
  "CREATE CONSTRAINT ON (p:Post) ASSERT p.id IS UNIQUE;",
  "CREATE CONSTRAINT ON (pl:Platform) ASSERT pl.name IS UNIQUE;",

  // Ensure platform nodes exist
  "MERGE (pl:Platform {name: 'twitter'}) ON CREATE SET pl.displayName = 'Twitter/X';",
  "MERGE (pl:Platform {name: 'facebook'}) ON CREATE SET pl.displayName = 'Facebook';",
  "MERGE (pl:Platform {name: 'instagram'}) ON CREATE SET pl.displayName = 'Instagram';",
];

export async function initGraphSchema(): Promise<void> {
  for (const query of SCHEMA_QUERIES) {
    try {
      await runWrite(query);
    } catch {
      // Ignore duplicate constraint errors on re-runs
    }
  }
}
