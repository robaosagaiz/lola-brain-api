#!/usr/bin/env bun
// Lola Brain — API Server (port 3005)
import { search, upsertChunks, type BrainChunk, qdrantClient } from "./qdrant.ts";
import { runQuery } from "./neo4j-client.ts";
import { COLLECTIONS, PATIENT_COLLECTION } from "./config.ts";
import { extractEntities, upsertEntities } from "./entity-extractor.ts";
import { upsertPatientGraph } from "./patient-graph.ts";
import { embed } from "./embeddings.ts";
import crypto from "crypto";

const PORT = 3005;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    
    // Health check
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "lola-brain", version: "1.0.0" });
    }
    
    // Hybrid search: semantic + graph
    if (url.pathname === "/search" && req.method === "POST") {
      const body = await req.json();
      const { query, limit = 5, collections, graphQuery } = body;
      
      if (!query) return Response.json({ error: "query required" }, { status: 400 });
      
      const results: any = { query };
      
      // Semantic search
      const cols = collections || Object.values(COLLECTIONS);
      results.semantic = {};
      for (const col of cols) {
        const hits = await search(col, query, limit);
        if (hits.length > 0) {
          results.semantic[col] = hits.map(h => ({
            score: h.score,
            text: (h.payload as any).text,
            source: (h.payload as any).source,
            section: (h.payload as any).section,
            tags: (h.payload as any).tags,
            date: (h.payload as any).date,
          }));
        }
      }
      
      // Graph search
      if (graphQuery) {
        try {
          const gResult = await runQuery(graphQuery);
          results.graph = gResult.records.map(r => {
            const obj: any = {};
            for (const key of r.keys) {
              const val = r.get(key);
              if (val && typeof val === "object" && val.properties) {
                obj[key] = { ...val.properties, _labels: val.labels };
              } else {
                obj[key] = val?.toNumber ? val.toNumber() : val;
              }
            }
            return obj;
          });
        } catch (e: any) {
          results.graphError = e.message;
        }
      } else {
        // Auto graph: search entities matching keywords
        const keywords = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
        if (keywords.length > 0) {
          try {
            const gResult = await runQuery(`
              MATCH (n)
              WHERE any(kw IN $keywords WHERE toLower(n.nome) CONTAINS kw OR toLower(n.id) CONTAINS kw)
              OPTIONAL MATCH (n)-[r]-(m)
              RETURN DISTINCT n.nome AS entity, labels(n)[0] AS type, type(r) AS rel, m.nome AS related, labels(m)[0] AS relatedType
              LIMIT 30
            `, { keywords });
            results.graph = gResult.records.map(r => ({
              entity: r.get("entity"),
              type: r.get("type"),
              rel: r.get("rel"),
              related: r.get("related"),
              relatedType: r.get("relatedType"),
            }));
          } catch { /* graph optional */ }
        }
      }
      
      return Response.json(results);
    }
    
    // Cypher query endpoint
    if (url.pathname === "/cypher" && req.method === "POST") {
      const body = await req.json();
      try {
        const result = await runQuery(body.query, body.params || {});
        return Response.json({
          records: result.records.map(r => {
            const obj: any = {};
            for (const key of r.keys) {
              const val = r.get(key);
              if (val && typeof val === "object" && val.properties) {
                obj[key] = { ...val.properties, _labels: val.labels };
              } else {
                obj[key] = val?.toNumber ? val.toNumber() : val;
              }
            }
            return obj;
          }),
        });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    }
    
    // Ingest endpoint — for external integrations
    if (url.pathname === "/ingest" && req.method === "POST") {
      const body = await req.json();
      const { text, source, sourceType = "external", date, tags = [], collection = "brain-notes", extractGraph = true } = body;
      
      if (!text || !source) return Response.json({ error: "text and source required" }, { status: 400 });
      
      // Chunk the text
      const lines = text.split("\n");
      const chunks: BrainChunk[] = [];
      let currentSection = "";
      let currentText: string[] = [];
      
      function flush() {
        const t = currentText.join("\n").trim();
        if (t.length > 50) {
          chunks.push({ text: t, source, sourceType, date, tags, section: currentSection || undefined });
        }
      }
      
      for (const line of lines) {
        if (/^#{1,3}\s/.test(line)) { flush(); currentSection = line.replace(/^#+\s*/, "").trim(); currentText = [line]; }
        else currentText.push(line);
      }
      flush();
      
      const col = (COLLECTIONS as any)[collection] || collection;
      const chunkCount = chunks.length > 0 ? await upsertChunks(col, chunks) : 0;
      
      // Extract entities if requested
      let entityResult = { entitiesProcessed: 0, relationsProcessed: 0 };
      let detectedEntities: any[] = [];
      if (extractGraph) {
        const { entities, relations } = extractEntities(text);
        detectedEntities = entities;
        if (entities.length > 0) {
          entityResult = await upsertEntities(entities, relations);
        }
      }
      
      return Response.json({
        chunks: chunkCount,
        entities: entityResult.entitiesProcessed,
        relations: entityResult.relationsProcessed,
        detectedEntities: detectedEntities.map(e => ({ id: e.id, label: e.label, nome: e.nome })),
      });
    }
    
    // === PATIENT BRAIN (isolated — never touched by /search) ===
    
    // Patient search — requires patient_id
    if (url.pathname === "/patient-search" && req.method === "POST") {
      const body = await req.json();
      const { query, patient_id, limit = 5 } = body;
      
      if (!query) return Response.json({ error: "query required" }, { status: 400 });
      if (!patient_id) return Response.json({ error: "patient_id required — this endpoint never searches without it" }, { status: 400 });
      
      const vector = await embed(query);
      const results = await qdrantClient.search(PATIENT_COLLECTION, {
        vector,
        limit,
        with_payload: true,
        filter: {
          must: [{ key: "patient_id", match: { value: patient_id } }],
        },
      });
      
      return Response.json({
        query,
        patient_id,
        results: results.map(r => ({
          score: r.score,
          text: (r.payload as any).text,
          source_type: (r.payload as any).source_type,
          speaker: (r.payload as any).speaker,
          date: (r.payload as any).date,
          topic: (r.payload as any).topic,
          consultation_number: (r.payload as any).consultation_number,
        })),
      });
    }
    
    // Patient ingest — stores consultation chunks for a patient
    if (url.pathname === "/patient-ingest" && req.method === "POST") {
      const body = await req.json();
      const { text, patient_id, patient_name, source_type = "consulta", speaker, date, consultation_number, topic } = body;
      
      if (!text) return Response.json({ error: "text required" }, { status: 400 });
      if (!patient_id) return Response.json({ error: "patient_id required" }, { status: 400 });
      
      // Chunk by headings or paragraphs
      const lines = text.split("\n");
      const chunks: { text: string; section?: string }[] = [];
      let currentSection = "";
      let currentText: string[] = [];
      
      function flush() {
        const t = currentText.join("\n").trim();
        if (t.length > 30) {
          chunks.push({ text: t, section: currentSection || undefined });
        }
      }
      
      for (const line of lines) {
        if (/^#{1,3}\s/.test(line)) { flush(); currentSection = line.replace(/^#+\s*/, "").trim(); currentText = [line]; }
        else currentText.push(line);
      }
      flush();
      
      // If no headings found, chunk by ~500 char blocks
      if (chunks.length === 0 && text.length > 30) {
        const words = text.split(/\s+/);
        let buf: string[] = [];
        let len = 0;
        for (const w of words) {
          buf.push(w);
          len += w.length + 1;
          if (len > 500) {
            chunks.push({ text: buf.join(" ") });
            buf = [];
            len = 0;
          }
        }
        if (buf.length > 0) chunks.push({ text: buf.join(" ") });
      }
      
      // Split oversized chunks (>2000 chars) into ~500 char sub-chunks
      const MAX_CHUNK = 2000;
      const finalChunks: typeof chunks = [];
      for (const chunk of chunks) {
        if (chunk.text.length <= MAX_CHUNK) {
          finalChunks.push(chunk);
        } else {
          const words = chunk.text.split(/\s+/);
          let buf: string[] = [];
          let len = 0;
          for (const w of words) {
            buf.push(w);
            len += w.length + 1;
            if (len > 500) {
              finalChunks.push({ text: buf.join(" "), section: chunk.section });
              buf = [];
              len = 0;
            }
          }
          if (buf.length > 0) finalChunks.push({ text: buf.join(" "), section: chunk.section });
        }
      }
      chunks.length = 0;
      chunks.push(...finalChunks);
      
      // Embed and upsert
      const BATCH = 20;
      let total = 0;
      
      for (let i = 0; i < chunks.length; i += BATCH) {
        const batch = chunks.slice(i, i + BATCH);
        const vectors = await Promise.all(batch.map(c => embed(c.text)));
        
        const points = batch.map((chunk, idx) => ({
          id: crypto.createHash("md5").update(`${patient_id}:${date || ""}:${chunk.text.slice(0, 100)}`).digest("hex"),
          vector: vectors[idx],
          payload: {
            text: chunk.text,
            patient_id,
            patient_name: patient_name || null,
            source_type,
            speaker: speaker || null,
            date: date || null,
            topic: topic || chunk.section || null,
            consultation_number: consultation_number || null,
          },
        }));
        
        await qdrantClient.upsert(PATIENT_COLLECTION, { points });
        total += batch.length;
      }
      
      // Also update Neo4j graph
      let graphResult: any = null;
      try {
        graphResult = await upsertPatientGraph(
          { patient_id, patient_name, date, consultation_number, source_type },
          text
        );
      } catch (e: any) {
        graphResult = { error: e.message };
      }
      
      return Response.json({ chunks: total, patient_id, collection: PATIENT_COLLECTION, graph: graphResult });
    }
    
    // Patient stats
    if (url.pathname === "/patient-stats" && req.method === "GET") {
      const patientId = url.searchParams.get("patient_id");
      
      try {
        const colInfo = await fetch(`http://localhost:6333/collections/${PATIENT_COLLECTION}`, {
          headers: { "api-key": "hawthorne-qdrant-2025" },
        });
        const data = await colInfo.json();
        const totalPoints = data.result?.points_count || 0;
        
        const result: any = { collection: PATIENT_COLLECTION, total_points: totalPoints };
        
        if (patientId) {
          // Count points for specific patient
          const countRes = await qdrantClient.count(PATIENT_COLLECTION, {
            filter: { must: [{ key: "patient_id", match: { value: patientId } }] },
            exact: true,
          });
          result.patient_id = patientId;
          result.patient_points = countRes.count;
        }
        
        return Response.json(result);
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }
    
    // Stats
    if (url.pathname === "/stats") {
      const stats: any = {};
      
      // Qdrant stats
      for (const [name, col] of Object.entries(COLLECTIONS)) {
        try {
          const res = await fetch(`http://localhost:6333/collections/${col}`, {
            headers: { "api-key": "hawthorne-qdrant-2025" },
          });
          const data = await res.json();
          stats[name] = { collection: col, points: data.result?.points_count };
        } catch {}
      }
      
      // Neo4j stats
      try {
        const nodeResult = await runQuery("MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count ORDER BY count DESC");
        stats.graph_nodes = nodeResult.records.map(r => ({ label: r.get("label"), count: r.get("count").toNumber() }));
        
        const relResult = await runQuery("MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS count ORDER BY count DESC");
        stats.graph_rels = relResult.records.map(r => ({ type: r.get("type"), count: r.get("count").toNumber() }));
      } catch {}
      
      return Response.json(stats);
    }
    
    return Response.json({ error: "not found", routes: ["/health", "/search", "/cypher", "/stats"] }, { status: 404 });
  },
});

console.log(`🧠 Lola Brain API running on http://localhost:${PORT}`);
