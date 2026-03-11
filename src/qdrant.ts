// Lola Brain — Qdrant client
import { QdrantClient } from "@qdrant/js-client-rest";
import { QDRANT_URL, QDRANT_API_KEY } from "./config.ts";
import { embed } from "./embeddings.ts";
import crypto from "crypto";

const client = new QdrantClient({ url: QDRANT_URL, apiKey: QDRANT_API_KEY });

export interface BrainChunk {
  id?: string;
  text: string;
  source: string;       // file path or identifier
  sourceType: string;   // "memory-daily" | "memory-long" | "transcript" | "content" | "decision"
  date?: string;        // ISO date if known
  tags?: string[];      // project names, people, etc.
  section?: string;     // heading or section name
}

function generateId(chunk: BrainChunk): string {
  return crypto.createHash("md5").update(`${chunk.source}:${chunk.section || ""}:${chunk.text.slice(0, 100)}`).digest("hex");
}

export async function upsertChunks(collection: string, chunks: BrainChunk[]): Promise<number> {
  if (chunks.length === 0) return 0;

  const BATCH = 20;
  let total = 0;
  
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const vectors = await Promise.all(batch.map(c => embed(c.text)));
    
    const points = batch.map((chunk, idx) => ({
      id: generateId(chunk),
      vector: vectors[idx],
      payload: {
        text: chunk.text,
        source: chunk.source,
        sourceType: chunk.sourceType,
        date: chunk.date || null,
        tags: chunk.tags || [],
        section: chunk.section || null,
      },
    }));
    
    await client.upsert(collection, { points });
    total += batch.length;
    if (chunks.length > BATCH) {
      console.log(`  [${collection}] ${total}/${chunks.length} chunks upserted`);
    }
  }
  
  return total;
}

export async function search(collection: string, query: string, limit = 5, filter?: Record<string, any>) {
  const vector = await embed(query);
  return client.search(collection, {
    vector,
    limit,
    with_payload: true,
    filter: filter || undefined,
  });
}

export { client as qdrantClient };
