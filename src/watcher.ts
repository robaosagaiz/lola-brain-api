#!/usr/bin/env bun
// Lola Brain — File Watcher (detects changed .md files and re-ingests)
import { readdir, stat } from "fs/promises";
import { COLLECTIONS } from "./config.ts";
import { upsertChunks, type BrainChunk } from "./qdrant.ts";
import { extractEntities, upsertEntities } from "./entity-extractor.ts";
import crypto from "crypto";

const MEMORY_DIR = `${process.env.HOME}/lola/memory`;
const LOLA_DIR = `${process.env.HOME}/lola`;
const STATE_FILE = `${process.env.HOME}/.config/lola-brain/state.json`;

interface FileState {
  [path: string]: { mtime: number; hash: string };
}

async function loadState(): Promise<FileState> {
  try {
    return JSON.parse(await Bun.file(STATE_FILE).text());
  } catch {
    return {};
  }
}

async function saveState(state: FileState) {
  await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
}

function hashContent(content: string): string {
  return crypto.createHash("md5").update(content).digest("hex");
}

// Same chunking logic as ingest.ts
function chunkMarkdown(content: string, source: string, sourceType: string, date?: string): BrainChunk[] {
  const chunks: BrainChunk[] = [];
  const lines = content.split("\n");
  let currentSection = "";
  let currentText: string[] = [];

  const TAG_PATTERNS: [RegExp, string][] = [
    [/hawthorne/i, "hawthorne"], [/crm[\s-]?chamon/i, "crm-chamon"],
    [/crm[\s-]?black/i, "crm-black"], [/newsletter|projeto[\s-]?individual/i, "newsletter-ia"],
    [/prontu[aá]rio/i, "prontuario"], [/estoque/i, "estoque"], [/financeiro/i, "financeiro"],
    [/instagram|reels?|roteiro/i, "instagram"], [/ads[\s-]?dashboard/i, "ads-dashboard"],
    [/lola[\s-]?brain/i, "lola-brain"], [/n8n/i, "n8n"], [/evolution/i, "evolution-api"],
    [/notion/i, "notion"], [/easypanel/i, "easypanel"], [/social[\s-]?seller/i, "social-seller"],
    [/tr[aá]fego/i, "trafego-pago"], [/glp-?1|semaglutida|mounjaro|wegovy|tirzepatida/i, "glp1-gip"],
    [/tdee|gasto[\s-]?energ/i, "tdee"], [/taco|fatsecret/i, "nutricao-db"],
    [/robson/i, "robson"], [/clara[\s-]?maria/i, "clara"], [/clarice/i, "clarice"],
    [/raysa/i, "raysa"], [/simone/i, "simone"], [/vitor[\s-]?jassi[eé]/i, "vitor-jassie"],
  ];

  function extractTags(text: string): string[] {
    const tags: string[] = [];
    for (const [p, t] of TAG_PATTERNS) if (p.test(text)) tags.push(t);
    return [...new Set(tags)];
  }

  function flush() {
    const text = currentText.join("\n").trim();
    if (text.length > 50) {
      chunks.push({ text, source, sourceType, date, tags: extractTags(text), section: currentSection || undefined });
    }
  }

  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) { flush(); currentSection = line.replace(/^#+\s*/, "").trim(); currentText = [line]; }
    else currentText.push(line);
  }
  flush();
  return chunks;
}

async function processFile(filePath: string, relativePath: string): Promise<{ chunks: number; entities: number }> {
  const content = await Bun.file(filePath).text();
  const dateMatch = relativePath.match(/(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : undefined;

  // Determine type and collection
  let sourceType = "memory-daily";
  let collection = COLLECTIONS.notes;

  if (relativePath.includes("roteiro")) { sourceType = "content-roteiro"; collection = COLLECTIONS.content; }
  else if (relativePath.includes("foodlog")) sourceType = "memory-foodlog";
  else if (relativePath.includes("perfil")) sourceType = "memory-profile";
  else if (relativePath.includes("revisao")) sourceType = "memory-review";
  else if (relativePath === "MEMORY.md") sourceType = "memory-long";
  else if (relativePath === "ROTINA-ROBSON.md") sourceType = "memory-routine";

  const chunks = chunkMarkdown(content, relativePath, sourceType, date);
  const chunkCount = chunks.length > 0 ? await upsertChunks(collection, chunks) : 0;

  // Extract and upsert entities
  const { entities, relations } = extractEntities(content);
  let entityCount = 0;
  if (entities.length > 0) {
    const result = await upsertEntities(entities, relations);
    entityCount = result.entitiesProcessed;
  }

  return { chunks: chunkCount, entities: entityCount };
}

async function watchCycle() {
  const state = await loadState();
  const newState: FileState = {};
  let totalChunks = 0;
  let totalEntities = 0;
  let filesProcessed = 0;

  // Scan all target files
  const targets: { path: string; relative: string }[] = [];

  // memory/*.md (top-level)
  const memFiles = (await readdir(MEMORY_DIR)).filter(f => f.endsWith(".md"));
  for (const f of memFiles) targets.push({ path: `${MEMORY_DIR}/${f}`, relative: `memory/${f}` });

  // memory/roteiros-instagram/*.md
  try {
    const roteiros = (await readdir(`${MEMORY_DIR}/roteiros-instagram`)).filter(f => f.endsWith(".md"));
    for (const f of roteiros) targets.push({ path: `${MEMORY_DIR}/roteiros-instagram/${f}`, relative: `memory/roteiros-instagram/${f}` });
  } catch {}

  // memory/projeto-individual/**/*.md
  try {
    const piFiles = await readdir(`${MEMORY_DIR}/projeto-individual`, { recursive: true });
    for (const f of piFiles) {
      if (typeof f === "string" && f.endsWith(".md")) {
        targets.push({ path: `${MEMORY_DIR}/projeto-individual/${f}`, relative: `memory/projeto-individual/${f}` });
      }
    }
  } catch {}

  // Top-level files
  for (const f of ["MEMORY.md", "ROTINA-ROBSON.md"]) {
    targets.push({ path: `${LOLA_DIR}/${f}`, relative: f });
  }

  for (const { path, relative } of targets) {
    try {
      const st = await stat(path);
      const content = await Bun.file(path).text();
      const hash = hashContent(content);

      newState[relative] = { mtime: st.mtimeMs, hash };

      // Skip if unchanged
      if (state[relative] && state[relative].hash === hash) continue;

      const result = await processFile(path, relative);
      totalChunks += result.chunks;
      totalEntities += result.entities;
      filesProcessed++;

      if (result.chunks > 0 || result.entities > 0) {
        console.log(`  ✅ ${relative}: ${result.chunks} chunks, ${result.entities} entities`);
      }
    } catch (e: any) {
      console.error(`  ❌ ${relative}: ${e.message}`);
    }
  }

  await saveState(newState);
  return { filesProcessed, totalChunks, totalEntities };
}

// Main
const mode = process.argv[2];

if (mode === "--daemon") {
  // Run in loop every 30 minutes
  console.log("🧠 Lola Brain Watcher — daemon mode (30min interval)");
  while (true) {
    const now = new Date().toISOString();
    console.log(`\n[${now}] Scanning...`);
    const result = await watchCycle();
    if (result.filesProcessed > 0) {
      console.log(`  Processed ${result.filesProcessed} files: ${result.totalChunks} chunks, ${result.totalEntities} entities`);
    } else {
      console.log("  No changes detected");
    }
    await Bun.sleep(30 * 60 * 1000); // 30 min
  }
} else {
  // Single run
  console.log("🧠 Lola Brain Watcher — single scan\n");
  const result = await watchCycle();
  console.log(`\n📊 Processed ${result.filesProcessed} files: ${result.totalChunks} chunks, ${result.totalEntities} entities`);
}
