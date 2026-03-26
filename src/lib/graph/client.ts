/**
 * graph/client.ts — Memgraph connection via neo4j-driver (Bolt protocol).
 * Memgraph is fully compatible with the neo4j-driver.
 */

import neo4j, { Driver, Session } from "neo4j-driver";
import type { JsonObject } from "@/lib/agent/tools";

let driver: Driver | null = null;

function getDriver(): Driver {
  if (!driver) {
    const uri = process.env.MEMGRAPH_URI ?? "bolt://localhost:7687";
    const user = process.env.MEMGRAPH_USER ?? "";
    const password = process.env.MEMGRAPH_PASSWORD ?? "";

    driver = neo4j.driver(
      uri,
      neo4j.auth.basic(user, password),
      {
        maxConnectionPoolSize: 10,
        connectionAcquisitionTimeout: 5000,
      },
    );
  }
  return driver;
}

export function getSession(): Session {
  return getDriver().session();
}

export async function closeGraph(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

/** Run a read-only Cypher query. */
export async function runRead<T extends JsonObject>(
  cypher: string,
  params: JsonObject = {},
): Promise<T[]> {
  const session = getSession();
  try {
    const result = await session.executeRead((tx) => tx.run(cypher, params));
    return result.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}

/** Run a write Cypher query. */
export async function runWrite<T extends JsonObject>(
  cypher: string,
  params: JsonObject = {},
): Promise<T[]> {
  const session = getSession();
  try {
    const result = await session.executeWrite((tx) => tx.run(cypher, params));
    return result.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}

/** Verify database connectivity. */
export async function pingGraph(): Promise<boolean> {
  try {
    await runRead("RETURN 1 AS ok");
    return true;
  } catch {
    return false;
  }
}
