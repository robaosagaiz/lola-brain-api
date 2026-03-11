// Lola Brain — Neo4j client
import neo4j, { Driver, Session } from "neo4j-driver";
import { NEO4J_URI, NEO4J_USER, NEO4J_PASS } from "./config.ts";

let driver: Driver | null = null;

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASS));
  }
  return driver;
}

export function getSession(): Session {
  return getDriver().session();
}

export async function runQuery(cypher: string, params: Record<string, any> = {}) {
  const session = getSession();
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

export async function close() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
