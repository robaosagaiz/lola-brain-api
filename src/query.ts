#!/usr/bin/env bun
// Lola Brain — Query test (semantic + graph)
import { search } from "./qdrant.ts";
import { runQuery, close } from "./neo4j-client.ts";
import { COLLECTIONS } from "./config.ts";

const query = process.argv[2] || "decisões sobre o Hawthorne";

console.log(`\n🔍 Query: "${query}"\n`);

// 1. Semantic search across collections
console.log("═══ Busca Semântica (Qdrant) ═══");
for (const [name, col] of Object.entries(COLLECTIONS)) {
  const results = await search(col, query, 3);
  if (results.length > 0) {
    console.log(`\n📁 ${name} (${col}):`);
    for (const r of results) {
      const p = r.payload as any;
      console.log(`  [${(r.score * 100).toFixed(1)}%] ${p.source}${p.section ? ` → ${p.section}` : ""}`);
      console.log(`    ${p.text.slice(0, 150).replace(/\n/g, " ")}...`);
      if (p.tags?.length) console.log(`    🏷️ ${p.tags.join(", ")}`);
    }
  }
}

// 2. Graph search — find related entities
console.log("\n═══ Busca no Grafo (Neo4j) ═══");

// Extract potential entity names from query
const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);

// Search nodes by name
const graphResult = await runQuery(`
  MATCH (n)
  WHERE any(kw IN $keywords WHERE toLower(n.nome) CONTAINS kw OR toLower(n.id) CONTAINS kw)
  OPTIONAL MATCH (n)-[r]-(m)
  RETURN n, type(r) AS rel, m
  LIMIT 20
`, { keywords });

if (graphResult.records.length > 0) {
  const seen = new Set<string>();
  for (const rec of graphResult.records) {
    const n = rec.get("n");
    const rel = rec.get("rel");
    const m = rec.get("m");
    
    const key = `${n.properties.id}-${rel}-${m?.properties?.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    
    if (m && rel) {
      console.log(`  ${n.properties.nome || n.properties.id} --[${rel}]--> ${m.properties.nome || m.properties.id}`);
    }
  }
} else {
  console.log("  Nenhuma entidade encontrada no grafo para essa query");
}

await close();
console.log("\n✅ Done");
