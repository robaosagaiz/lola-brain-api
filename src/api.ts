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

    // POST /send-whatsapp — relay to Evolution API (same Docker network)
    if (url.pathname === "/send-whatsapp" && req.method === "POST") {
      const body = await req.json();
      const { instance, number, text, apikey } = body;
      if (!instance || !number || !text || !apikey) {
        return Response.json({ error: "instance, number, text, apikey required" }, { status: 400 });
      }
      try {
        const evoRes = await fetch(`http://evolution-api:8080/message/sendText/${instance}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey },
          body: JSON.stringify({ number, text }),
        });
        const data = await evoRes.json();
        return Response.json(data);
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
      }
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
    
    // ============================================================
    // CPET TOOLS — Kcal Estimator & Query Brain (for n8n agents)
    // ============================================================

    // POST /has-cpet — Check if patient has CPET data in Neo4j
    if (url.pathname === "/has-cpet" && req.method === "POST") {
      const body = await req.json();
      const { patientName, grupoId } = body;
      if (!patientName && !grupoId) return Response.json({ error: "patientName or grupoId required" }, { status: 400 });

      try {
        const cpet = await fetchCPETFromNeo4j(patientName, grupoId);
        return Response.json({
          patientName: patientName || cpet.resolvedName,
          grupoId: grupoId || null,
          hasCPET: cpet.hasCPET,
          testDate: cpet.testDate,
          vo2max: cpet.vo2max,
          zones: cpet.zones.length,
        });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    // POST /estimate-kcal — Estimate activity calories using CPET zones
    if (url.pathname === "/estimate-kcal" && req.method === "POST") {
      const body = await req.json();
      const { patientName, grupoId, type, durationMin, avgHR, maxHR, avgSpeed } = body;
      if ((!patientName && !grupoId) || !type || !durationMin) {
        return Response.json({ error: "(patientName or grupoId), type, and durationMin required" }, { status: 400 });
      }

      try {
        const cpet = await fetchCPETFromNeo4j(patientName, grupoId);
        const resolvedName = patientName || cpet.resolvedName || grupoId;
        const result = estimateKcal(resolvedName, { type, durationMin, avgHR, maxHR, avgSpeed }, cpet);
        return Response.json(result);
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    // POST /analyze-workout — Full workout analysis with formatted message (for Cora/agents)
    if (url.pathname === "/analyze-workout" && req.method === "POST") {
      const body = await req.json();
      const { grupoId, patientName, segments, deviceKcal, date, patientFirstName } = body;
      if ((!grupoId && !patientName) || !segments || !Array.isArray(segments) || segments.length === 0) {
        return Response.json({ error: "(grupoId or patientName), segments[] required. Each segment: {type, durationMin, avgHR?, maxHR?}" }, { status: 400 });
      }

      try {
        const cpet = await fetchCPETFromNeo4j(patientName, grupoId);
        const resolvedName = patientName || cpet.resolvedName || "Paciente";
        const firstName = patientFirstName || resolvedName.split(" ")[0];

        // Estimate each segment
        const segResults = segments.map((seg: any) => estimateKcal(resolvedName, {
          type: seg.type, durationMin: seg.durationMin, avgHR: seg.avgHR, maxHR: seg.maxHR, avgSpeed: seg.avgSpeed,
        }, cpet));

        // Totals
        const totalKcal = segResults.reduce((s: number, r: any) => s + r.totalKcal, 0);
        const totalFatKcal = segResults.reduce((s: number, r: any) => s + r.fatKcal, 0);
        const totalFatG = Math.round(totalFatKcal / 9 * 10) / 10;
        const totalMin = segments.reduce((s: number, seg: any) => s + seg.durationMin, 0);

        // Dominant zone (from largest segment)
        const largestSeg = segResults.reduce((max: any, r: any, i: number) =>
          segments[i].durationMin > (segments[max.idx]?.durationMin || 0) ? { idx: i, r } : max, { idx: 0, r: segResults[0] });
        const dominantZone = largestSeg.r.dominantZone || "N/A";

        // Average intensity
        const avgZoneNum = segResults.reduce((s: number, r: any, i: number) => {
          const zNum = r.breakdown?.[0]?.zone?.match(/Z(\d)/)?.[1];
          return s + (Number(zNum) || 2) * segments[i].durationMin;
        }, 0) / totalMin;
        const intensity = avgZoneNum < 1.5 ? "Leve" : avgZoneNum < 2.5 ? "Moderada" : avgZoneNum < 3.5 ? "Intensa" : "Muito intensa";

        // Emoji map
        const emojiMap: Record<string, string> = {
          bike: "🚴", ciclismo: "🚴", pedal: "🚴", spinning: "🚴",
          corrida: "🏃", caminhada: "🚶", esteira: "🏃", trail: "🏃",
          musculacao: "🏋️", funcional: "🏋️", crossfit: "💪",
          natacao: "🏊", alongamento: "🧘", yoga: "🧘",
          abdominais: "🏋️", abs: "🏋️",
        };

        // Format date
        const dias = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
        let dateStr = "";
        if (date) {
          const d = new Date(date + "T12:00:00");
          const dia = dias[d.getDay()];
          dateStr = `${dia}, ${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}`;
        }

        // Build message
        const lines: string[] = [];
        lines.push(`📊 *Análise do Treino de Hoje — ${firstName}*`);
        if (dateStr) lines.push(`\n${dateStr}`);
        lines.push("\n━━━━━━━━━━━━━━━━━━\n");

        // Each segment
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const res = segResults[i];
          const emoji = emojiMap[seg.type] || "🏃";
          const typeName = seg.type.charAt(0).toUpperCase() + seg.type.slice(1);

          if (seg.durationMin >= 15) {
            // Detailed segment
            lines.push(`${emoji} *${typeName} (${seg.durationMin} min)*`);
            if (seg.avgHR) lines.push(`• FC média: ${seg.avgHR} bpm${seg.maxHR ? ` | máx: ${seg.maxHR} bpm` : ""}`);
            lines.push(`• Gasto: *${res.totalKcal} kcal*`);
            lines.push(`• Gordura oxidada: *${res.fatGrams}g*`);
            if (res.dominantZone && res.dominantZone !== "N/A") {
              lines.push(`• Zona dominante: ${res.dominantZone}`);
            }
            lines.push("");
          } else {
            // Short segment (one line)
            lines.push(`${emoji} *${typeName} (${seg.durationMin} min)* → *${res.totalKcal} kcal*`);
          }
        }

        lines.push("━━━━━━━━━━━━━━━━━━\n");
        lines.push("📈 *Resumo*");
        lines.push(`• Total: *${totalKcal} kcal* | Gordura: *~${Math.round(totalFatG)}g*`);

        if (deviceKcal) {
          const diff = Math.round((deviceKcal / totalKcal - 1) * 100);
          if (diff > 10) {
            lines.push(`• Relógio marcou: ${deviceKcal} kcal (superestimou ~${diff}%)`);
          } else if (diff < -10) {
            lines.push(`• Relógio marcou: ${deviceKcal} kcal (subestimou ~${Math.abs(diff)}%)`);
          } else {
            lines.push(`• Relógio marcou: ${deviceKcal} kcal (próximo do real ✅)`);
          }
        }

        lines.push(`• Intensidade geral: ${intensity}`);

        // Phase-aware tip
        if (cpet.hasCPET) {
          const fatmaxFc = cpet.fatMaxFc;
          const mainSeg = segments.reduce((max: any, s: any) => s.durationMin > (max.durationMin || 0) ? s : max, segments[0]);
          if (mainSeg.avgHR && fatmaxFc) {
            const diff = Math.abs(mainSeg.avgHR - fatmaxFc);
            if (diff <= 10) {
              lines.push(`\n💡 FC média de ${mainSeg.avgHR} está perto do FATmax (FC ~${fatmaxFc}) — máxima oxidação de gordura.`);
            } else if (mainSeg.avgHR < fatmaxFc) {
              lines.push(`\n💡 FC média de ${mainSeg.avgHR} está abaixo do FATmax (FC ~${fatmaxFc}). Pode aumentar levemente a intensidade para otimizar queima de gordura.`);
            } else {
              lines.push(`\n💡 FC média de ${mainSeg.avgHR} está acima do FATmax (FC ~${fatmaxFc}). Bom para condicionamento, mas a oxidação de gordura é menor nessa faixa.`);
            }
          }
        }

        const message = lines.join("\n");

        return Response.json({
          success: true,
          patientName: resolvedName,
          usedCPET: cpet.hasCPET,
          testDate: cpet.testDate,
          totalKcal,
          totalFatG,
          totalMin,
          deviceKcal: deviceKcal || null,
          deviceDiff: deviceKcal ? Math.round((deviceKcal / totalKcal - 1) * 100) : null,
          intensity,
          dominantZone,
          segments: segResults.map((r: any, i: number) => ({
            type: segments[i].type,
            durationMin: segments[i].durationMin,
            kcal: r.totalKcal,
            fatG: r.fatGrams,
            zone: r.dominantZone,
          })),
          message,
        });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    // POST /query-brain — Semantic search in patient brain (for chatbot agents)
    if (url.pathname === "/query-brain" && req.method === "POST") {
      const body = await req.json();
      const { patientName, grupoId, query: q, limit: lim = 5, patient_id } = body;
      if (!q) return Response.json({ error: "query required" }, { status: 400 });

      try {
        const searchQuery = patientName ? `${patientName} ${q}` : q;
        const vector = await embed(searchQuery);

        const filter: any = { must: [] };
        if (grupoId) {
          filter.must.push({ key: "grupo_id", match: { value: grupoId } });
        } else if (patient_id) {
          filter.must.push({ key: "patient_id", match: { value: patient_id } });
        } else if (patientName) {
          filter.must.push({ key: "patient_name", match: { value: patientName } });
        }

        const results = await qdrantClient.search(PATIENT_COLLECTION, {
          vector,
          limit: lim,
          with_payload: true,
          ...(filter.must.length > 0 ? { filter } : {}),
        });

        const cpetTypes = ["cpet-analise", "cpet-prescricao", "cpet-periodizacao", "analise_cpet"];
        const hasCPET = results.some(r => {
          const st = (r.payload as any).source_type || (r.payload as any).type;
          return st && cpetTypes.includes(st);
        });
        const cpetDate = results.find(r => {
          const st = (r.payload as any).source_type || (r.payload as any).type;
          return st && cpetTypes.includes(st);
        })?.payload as any;

        return Response.json({
          success: true,
          patientName: patientName || null,
          query: q,
          results: results.map(r => ({
            score: r.score,
            text: (r.payload as any).text,
            source_type: (r.payload as any).source_type,
            topic: (r.payload as any).topic,
            date: (r.payload as any).date,
          })),
          resultCount: results.length,
          hasCPET,
          cpetDate: cpetDate?.date || null,
        });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    return Response.json({ error: "not found", routes: ["/health", "/search", "/cypher", "/stats", "/estimate-kcal", "/has-cpet", "/query-brain", "/patient-search", "/patient-ingest", "/patient-stats"] }, { status: 404 });
  },
});

// ============================================================
// CPET Kcal Estimation (inline — no external dependency)
// ============================================================

interface ZoneData {
  numero: number; nome: string;
  fc_min: number; fc_max: number;
  speed_min: number; speed_max: number;
  kcal_hora: number;
}

interface CPETResult {
  hasCPET: boolean;
  resolvedName?: string;
  testDate?: string;
  vo2max?: number;
  classificacao?: string;
  ergometro?: string;
  fatMaxFc?: number;
  zones: ZoneData[];
}

async function resolvePatientId(grupoId?: string, patientName?: string): Promise<{ matchField: string; matchValue: string } | null> {
  // Priority: grupoId > patientName (grupoId is unique, name can have duplicates)
  if (grupoId) return { matchField: "grupo_id", matchValue: grupoId };
  if (patientName) return { matchField: "nome", matchValue: patientName };
  return null;
}

async function fetchCPETFromNeo4j(patientName?: string, grupoId?: string): Promise<CPETResult> {
  try {
    // grupoId is preferred (unique), patientName is fallback (may have duplicates)
    const query = grupoId
      ? `MATCH (p:Paciente {grupo_id: $val})-[:REALIZOU_EXAME]->(e:Exame {tipo: "TCPE"})
         OPTIONAL MATCH (e)-[:TEM_ZONA]->(z:ZonaTreino)
         RETURN p.nome as patientName, e.data as data, e.vo2max as vo2max, e.classificacao as classificacao,
                e.ergometro as ergometro, e.fat_max_fc as fatMaxFc,
                z.numero as zNum, z.nome as zNome, z.fc_min as zFcMin, z.fc_max as zFcMax,
                z.speed_min as zSpeedMin, z.speed_max as zSpeedMax, z.kcal_hora as zKcalH
         ORDER BY e.data DESC, z.numero ASC`
      : `MATCH (p:Paciente {nome: $val})-[:REALIZOU_EXAME]->(e:Exame {tipo: "TCPE"})
         OPTIONAL MATCH (e)-[:TEM_ZONA]->(z:ZonaTreino)
         RETURN p.nome as patientName, e.data as data, e.vo2max as vo2max, e.classificacao as classificacao,
                e.ergometro as ergometro, e.fat_max_fc as fatMaxFc,
                z.numero as zNum, z.nome as zNome, z.fc_min as zFcMin, z.fc_max as zFcMax,
                z.speed_min as zSpeedMin, z.speed_max as zSpeedMax, z.kcal_hora as zKcalH
         ORDER BY e.data DESC, z.numero ASC`;

    const val = grupoId || patientName;
    const result = await runQuery(query, { val });

    if (result.records.length === 0) return { hasCPET: false, zones: [] };

    const first = result.records[0];
    const zones: ZoneData[] = result.records
      .filter(r => r.get("zNum") != null)
      .map(r => ({
        numero: r.get("zNum")?.toNumber ? r.get("zNum").toNumber() : r.get("zNum"),
        nome: r.get("zNome"),
        fc_min: r.get("zFcMin")?.toNumber ? r.get("zFcMin").toNumber() : r.get("zFcMin"),
        fc_max: r.get("zFcMax")?.toNumber ? r.get("zFcMax").toNumber() : r.get("zFcMax"),
        speed_min: r.get("zSpeedMin")?.toNumber ? r.get("zSpeedMin").toNumber() : r.get("zSpeedMin"),
        speed_max: r.get("zSpeedMax")?.toNumber ? r.get("zSpeedMax").toNumber() : r.get("zSpeedMax"),
        kcal_hora: r.get("zKcalH")?.toNumber ? r.get("zKcalH").toNumber() : r.get("zKcalH"),
      }))
      .reduce((acc: ZoneData[], z) => {
        if (!acc.find(a => a.numero === z.numero)) acc.push(z);
        return acc;
      }, [])
      .sort((a, b) => a.numero - b.numero);

    if (zones.length === 0) return { hasCPET: false, zones: [] };

    return {
      hasCPET: true,
      resolvedName: first.get("patientName"),
      testDate: first.get("data"),
      vo2max: first.get("vo2max")?.toNumber ? first.get("vo2max").toNumber() : first.get("vo2max"),
      classificacao: first.get("classificacao"),
      ergometro: first.get("ergometro"),
      fatMaxFc: first.get("fatMaxFc")?.toNumber ? first.get("fatMaxFc").toNumber() : first.get("fatMaxFc"),
      zones,
    };
  } catch (err) {
    console.error("[fetchCPETFromNeo4j] Error:", err);
    return { hasCPET: false, zones: [] };
  }
}

function estimateKcal(
  patientName: string,
  activity: { type: string; durationMin: number; avgHR?: number; maxHR?: number; avgSpeed?: number },
  cpet: CPETResult,
) {
  const notes: string[] = [];

  if (!cpet.hasCPET) {
    const mets: Record<string, number> = { caminhada: 3.5, corrida: 8, bike: 6.5, natacao: 7, crossfit: 8, funcional: 5, musculacao: 4, eliptico: 5, outro: 5 };
    const met = mets[activity.type] || 5;
    const totalKcal = Math.round(met * 3.5 * 75 / 200 * activity.durationMin);
    return {
      success: true, patientName, usedCPET: false, testDate: null, activity,
      totalKcal, fatKcal: Math.round(totalKcal * 0.4), choKcal: Math.round(totalKcal * 0.6),
      fatGrams: Math.round(totalKcal * 0.4 / 9), breakdown: [],
      dominantZone: "N/A", intensity: "estimado",
      notes: ["Paciente sem CPET — estimativa genérica baseada em METs populacionais (peso assumido 75kg)"],
      summary: `${activity.type} ${activity.durationMin}min: ~${totalKcal} kcal (estimativa genérica — sem CPET)`,
    };
  }

  const { zones } = cpet;
  // Cross-modal HR correction (~10% difference between bike and treadmill)
  // Same metabolic load → bike FC is ~10% lower than treadmill FC
  // So: bike FC ÷ 0.9 = equivalent treadmill FC (to look up in treadmill zones)
  //     treadmill FC × 0.9 = equivalent bike FC (to look up in bike zones)
  let hrMult = 1.0;
  const isBikeActivity = ["bike", "ciclismo", "pedal", "spinning"].includes(activity.type);
  const isTreadActivity = ["corrida", "caminhada", "esteira", "trail"].includes(activity.type);
  if (isBikeActivity && cpet.ergometro === "esteira") {
    hrMult = 1 / 0.9; // elevate bike FC to compare with treadmill zones
    notes.push("FC ajustada: CPET em esteira, treino em bike (FC÷0.9 para comparar com zonas)");
  } else if (isTreadActivity && cpet.ergometro === "bike") {
    hrMult = 0.9; // lower treadmill FC to compare with bike zones
    notes.push("FC ajustada: CPET em bike, treino em esteira (FC×0.9 para comparar com zonas)");
  }

  function findZone(hr: number): ZoneData {
    const adj = hr * hrMult;
    for (const z of zones) { if (adj >= z.fc_min && adj <= z.fc_max) return z; }
    // If HR falls in a gap between zones, find the closest zone boundary
    if (adj < zones[0].fc_min) return zones[0];
    let closest = zones[0];
    let minDist = Infinity;
    for (const z of zones) {
      const dist = Math.min(Math.abs(adj - z.fc_min), Math.abs(adj - z.fc_max));
      if (dist < minDist) { minDist = dist; closest = z; }
    }
    return closest;
  }

  let breakdown: { zone: ZoneData; minutes: number }[];

  if (activity.avgHR) {
    const main = findZone(activity.avgHR);
    if (activity.maxHR && activity.maxHR > activity.avgHR + 15) {
      breakdown = [
        { zone: findZone(activity.avgHR - 10), minutes: activity.durationMin * 0.2 },
        { zone: main, minutes: activity.durationMin * 0.6 },
        { zone: findZone(Math.min(activity.avgHR + 15, activity.maxHR)), minutes: activity.durationMin * 0.2 },
      ];
      notes.push("Distribuição estimada: 60% zona média, 20% abaixo, 20% acima");
    } else {
      breakdown = [{ zone: main, minutes: activity.durationMin }];
    }
  } else if (activity.avgSpeed) {
    const z = zones.reduce((best, z) => {
      const mid = (z.speed_min + z.speed_max) / 2;
      return Math.abs(mid - activity.avgSpeed!) < Math.abs((best.speed_min + best.speed_max) / 2 - activity.avgSpeed!) ? z : best;
    }, zones[0]);
    breakdown = [{ zone: z, minutes: activity.durationMin }];
    notes.push("Zona estimada pela velocidade (sem FC)");
  } else {
    const defaults: Record<string, number> = { caminhada: 0, corrida: 1, crossfit: 2, funcional: 2 };
    const idx = Math.min(defaults[activity.type] ?? 1, zones.length - 1);
    breakdown = [{ zone: zones[idx], minutes: activity.durationMin }];
    notes.push("Sem FC/velocidade — zona estimada pelo tipo de atividade");
  }

  const result = breakdown.map(b => {
    const kcal = Math.round(b.zone.kcal_hora / 60 * b.minutes);
    const fatPct = b.zone.numero === 1 ? 60 : b.zone.numero === 2 ? 35 : b.zone.numero === 3 ? 15 : 5;
    return {
      zone: `Z${b.zone.numero} (${b.zone.nome})`, minutes: Math.round(b.minutes),
      kcal, fuelMix: fatPct > 50 ? "Gordura predominante" : fatPct > 25 ? "Misto" : "CHO predominante", fatPct,
    };
  });

  const totalKcal = result.reduce((s, r) => s + r.kcal, 0);
  const fatKcal = result.reduce((s, r) => s + Math.round(r.kcal * r.fatPct / 100), 0);
  const dominant = result.reduce((max, r) => r.minutes > max.minutes ? r : max, result[0]);
  const avgZone = breakdown.reduce((s, b) => s + b.zone.numero * b.minutes, 0) / activity.durationMin;
  const intensity = avgZone < 1.5 ? "Leve" : avgZone < 2.5 ? "Moderado" : avgZone < 3.5 ? "Intenso" : "Muito intenso";

  return {
    success: true, patientName, usedCPET: true, testDate: cpet.testDate || null, activity,
    totalKcal, fatKcal, choKcal: totalKcal - fatKcal, fatGrams: Math.round(fatKcal / 9 * 10) / 10,
    breakdown: result, dominantZone: dominant.zone, intensity, notes,
    summary: `${activity.type} ${activity.durationMin}min${activity.avgHR ? ` (FC ${activity.avgHR})` : ""}: ${totalKcal} kcal (${Math.round(fatKcal / 9)}g gordura). Intensidade: ${intensity}. [CPET ${cpet.testDate}]`,
  };
}

console.log(`🧠 Lola Brain API running on http://localhost:${PORT}`);
