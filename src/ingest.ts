#!/usr/bin/env bun
// Lola Brain — Ingest all memory .md files into Qdrant
import { readdir } from "fs/promises";
import { COLLECTIONS } from "./config.ts";
import { upsertChunks, type BrainChunk } from "./qdrant.ts";

const MEMORY_DIR = `${process.env.HOME}/lola/memory`;
const LOLA_DIR = `${process.env.HOME}/lola`;

// Split markdown into chunks by headings (##, ###)
function chunkMarkdown(content: string, source: string, sourceType: string, date?: string): BrainChunk[] {
  const chunks: BrainChunk[] = [];
  const lines = content.split("\n");
  
  let currentSection = "";
  let currentText: string[] = [];
  
  function flush() {
    const text = currentText.join("\n").trim();
    if (text.length > 50) { // skip tiny fragments
      // Extract tags from text (project names, people)
      const tags = extractTags(text);
      chunks.push({
        text,
        source,
        sourceType,
        date,
        tags,
        section: currentSection || undefined,
      });
    }
  }
  
  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) {
      flush();
      currentSection = line.replace(/^#+\s*/, "").trim();
      currentText = [line];
    } else {
      currentText.push(line);
    }
  }
  flush();
  
  return chunks;
}

// Extract known tags from text
const TAG_PATTERNS: [RegExp, string][] = [
  [/hawthorne/i, "hawthorne"],
  [/crm[\s-]?chamon/i, "crm-chamon"],
  [/crm[\s-]?black/i, "crm-black"],
  [/newsletter|projeto[\s-]?individual/i, "newsletter-ia"],
  [/prontu[aá]rio/i, "prontuario"],
  [/estoque/i, "estoque"],
  [/financeiro/i, "financeiro"],
  [/instagram|reels?|roteiro/i, "instagram"],
  [/ads[\s-]?dashboard/i, "ads-dashboard"],
  [/lola[\s-]?brain/i, "lola-brain"],
  [/n8n/i, "n8n"],
  [/evolution/i, "evolution-api"],
  [/notion/i, "notion"],
  [/easypanel/i, "easypanel"],
  [/social[\s-]?seller/i, "social-seller"],
  [/tr[aá]fego/i, "trafego-pago"],
  [/glp-?1|semaglutida|mounjaro|wegovy|tirzepatida/i, "glp1-gip"],
  [/tdee|gasto[\s-]?energ/i, "tdee"],
  [/taco|fatsecret/i, "nutricao-db"],
  [/robson/i, "robson"],
  [/clara[\s-]?maria|clara[\s-]?nunes/i, "clara"],
  [/clarice/i, "clarice"],
  [/raysa/i, "raysa"],
  [/simone/i, "simone"],
  [/vitor[\s-]?jassi[eé]/i, "vitor-jassie"],
];

function extractTags(text: string): string[] {
  const tags: string[] = [];
  for (const [pattern, tag] of TAG_PATTERNS) {
    if (pattern.test(text)) tags.push(tag);
  }
  return [...new Set(tags)];
}

async function ingestMemoryFiles() {
  console.log("🧠 Lola Brain — Ingestão Fase 1\n");
  
  // 1. Daily memory files
  const memoryFiles = (await readdir(MEMORY_DIR))
    .filter(f => f.endsWith(".md"))
    .sort();
  
  console.log(`📁 ${memoryFiles.length} arquivos em memory/`);
  
  let totalChunks = 0;
  
  for (const file of memoryFiles) {
    const path = `${MEMORY_DIR}/${file}`;
    const content = await Bun.file(path).text();
    const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch ? dateMatch[1] : undefined;
    
    // Determine source type
    let sourceType = "memory-daily";
    if (file.includes("foodlog")) sourceType = "memory-foodlog";
    else if (file.includes("debug")) sourceType = "memory-debug";
    else if (file.includes("checkpoint")) sourceType = "memory-checkpoint";
    else if (file.includes("perfil")) sourceType = "memory-profile";
    else if (file.includes("roteiro")) sourceType = "content-roteiro";
    else if (file.includes("revisao")) sourceType = "memory-review";
    
    const chunks = chunkMarkdown(content, `memory/${file}`, sourceType, date);
    
    // Decide collection
    let collection = COLLECTIONS.notes;
    if (sourceType.startsWith("content")) collection = COLLECTIONS.content;
    
    if (chunks.length > 0) {
      const n = await upsertChunks(collection, chunks);
      totalChunks += n;
      console.log(`  ✅ ${file}: ${n} chunks → ${collection}`);
    }
  }
  
  // 2. Main MEMORY.md
  {
    const content = await Bun.file(`${LOLA_DIR}/MEMORY.md`).text();
    const chunks = chunkMarkdown(content, "MEMORY.md", "memory-long");
    const n = await upsertChunks(COLLECTIONS.notes, chunks);
    totalChunks += n;
    console.log(`  ✅ MEMORY.md: ${n} chunks → ${COLLECTIONS.notes}`);
  }
  
  // 3. ROTINA-ROBSON.md
  {
    const content = await Bun.file(`${LOLA_DIR}/ROTINA-ROBSON.md`).text();
    const chunks = chunkMarkdown(content, "ROTINA-ROBSON.md", "memory-routine");
    const n = await upsertChunks(COLLECTIONS.notes, chunks);
    totalChunks += n;
    console.log(`  ✅ ROTINA-ROBSON.md: ${n} chunks → ${COLLECTIONS.notes}`);
  }
  
  // 4. Content files (roteiros)
  try {
    const roteiroDir = `${MEMORY_DIR}/roteiros-instagram`;
    const roteiros = (await readdir(roteiroDir)).filter(f => f.endsWith(".md"));
    for (const file of roteiros) {
      const content = await Bun.file(`${roteiroDir}/${file}`).text();
      const chunks = chunkMarkdown(content, `memory/roteiros-instagram/${file}`, "content-roteiro");
      const n = await upsertChunks(COLLECTIONS.content, chunks);
      totalChunks += n;
      console.log(`  ✅ roteiros/${file}: ${n} chunks → ${COLLECTIONS.content}`);
    }
  } catch { /* no roteiros dir */ }
  
  // 5. Projeto individual docs
  try {
    const piDir = `${MEMORY_DIR}/projeto-individual`;
    const subdirs = await readdir(piDir, { recursive: true });
    const mdFiles = subdirs.filter((f: string) => f.endsWith(".md"));
    for (const file of mdFiles) {
      const content = await Bun.file(`${piDir}/${file}`).text();
      const chunks = chunkMarkdown(content, `memory/projeto-individual/${file}`, "memory-project");
      const n = await upsertChunks(COLLECTIONS.notes, chunks);
      totalChunks += n;
      console.log(`  ✅ projeto-individual/${file}: ${n} chunks → ${COLLECTIONS.notes}`);
    }
  } catch { /* no PI dir */ }
  
  console.log(`\n🎉 Total: ${totalChunks} chunks ingeridos no Qdrant`);
}

ingestMemoryFiles().catch(console.error);
