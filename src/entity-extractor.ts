// Lola Brain — Entity Extractor v1 (regex-based)
import { runQuery } from "./neo4j-client.ts";

interface ExtractedEntity {
  id: string;
  label: string; // Neo4j label
  nome: string;
  props?: Record<string, any>;
}

interface ExtractedRelation {
  fromLabel: string;
  fromId: string;
  rel: string;
  toLabel: string;
  toId: string;
}

// Known entities for matching
const KNOWN_PEOPLE: [RegExp, string, string][] = [
  [/robson/i, "robson", "Robson"],
  [/clara[\s-]?maria|clara[\s-]?nunes|\bclara\b/i, "clara", "Clara"],
  [/clarice/i, "clarice", "Clarice"],
  [/clarissa/i, "clarissa", "Clarissa"],
  [/vitor[\s-]?jassi[eé]/i, "vitor-jassie", "Vitor Jassié"],
  [/raysa/i, "raysa", "Raysa"],
  [/simone/i, "simone", "Simone Chamoun"],
  [/lucas[\s-]?bolleli/i, "lucas-bolleli", "Lucas Bolleli"],
  [/r[oô]mulo/i, "romulo", "Rômulo Oliveira"],
  [/suelen/i, "suelen", "Suelen"],
  [/thiago(?![\s-]?cardoso)/i, "thiago", "Thiago"],
  [/tiago[\s-]?cardoso/i, "tiago-cardoso", "Tiago Cardoso"],
];

const KNOWN_PROJECTS: [RegExp, string, string][] = [
  [/hawthorne/i, "hawthorne", "Hawthorne App"],
  [/crm[\s-]?chamon/i, "crm-chamon", "CRM Chamon"],
  [/ads[\s-]?dashboard/i, "ads-dashboard", "Chamon Ads Dashboard"],
  [/gest[aã]o[\s-]?cl[ií]nica|estoque|financeiro/i, "gestao-clinica", "Gestão da Clínica"],
  [/newsletter|projeto[\s-]?individual/i, "newsletter-ia", "Newsletter de IA"],
  [/crm[\s-]?black|mentoria/i, "crm-black", "Mentoria CRM Black"],
  [/instagram[\s-]?conte[uú]do|@dr\.robsonchamon/i, "instagram-conteudo", "Instagram @dr.robsonchamon"],
  [/prontu[aá]rio/i, "prontuario", "Prontuário Digital"],
  [/lola[\s-]?brain/i, "lola-brain", "Lola Brain"],
  [/visa|adequa[cç][aã]o/i, "visa-inspecao", "Adequação VISA"],
];

const KNOWN_CONCEPTS: [RegExp, string, string][] = [
  [/glp[\s-]?1|semaglutida|tirzepatida|mounjaro|wegovy|ozempic/i, "glp1-gip", "GLP-1/GIP"],
  [/tdee|gasto[\s-]?energ/i, "tdee", "TDEE"],
  [/longevidade/i, "longevidade", "Longevidade"],
  [/emagrecimento/i, "emagrecimento-saude", "Emagrecimento com Saúde"],
  [/taco/i, "taco-db", "Tabela TACO"],
];

export function extractEntities(text: string): { entities: ExtractedEntity[]; relations: ExtractedRelation[] } {
  const entities: ExtractedEntity[] = [];
  const relations: ExtractedRelation[] = [];
  const seen = new Set<string>();

  // Match people
  for (const [pattern, id, nome] of KNOWN_PEOPLE) {
    if (pattern.test(text) && !seen.has(id)) {
      entities.push({ id, label: "Pessoa", nome });
      seen.add(id);
    }
  }

  // Match projects
  for (const [pattern, id, nome] of KNOWN_PROJECTS) {
    if (pattern.test(text) && !seen.has(id)) {
      entities.push({ id, label: "Projeto", nome });
      seen.add(id);
    }
  }

  // Match concepts
  for (const [pattern, id, nome] of KNOWN_CONCEPTS) {
    if (pattern.test(text) && !seen.has(id)) {
      entities.push({ id, label: "Conceito", nome });
      seen.add(id);
    }
  }

  // Detect decisions (lines starting with "Decisão:" or "**Decisão:**" or containing "decidimos")
  const decisionMatch = text.match(/(?:decis[aã]o|decidimos|decidiu)[\s:]*(.{10,100})/i);
  if (decisionMatch) {
    const decId = `d-auto-${Date.now()}`;
    entities.push({
      id: decId,
      label: "Decisao",
      nome: decisionMatch[1].trim().slice(0, 100),
      props: { data: new Date().toISOString().slice(0, 10), auto: true },
    });
    // Link to any detected projects
    const projEntities = entities.filter(e => e.label === "Projeto");
    for (const proj of projEntities) {
      relations.push({ fromLabel: "Decisao", fromId: decId, rel: "SOBRE", toLabel: "Projeto", toId: proj.id });
    }
    relations.push({ fromLabel: "Pessoa", fromId: "robson", rel: "DECIDIU", toLabel: "Decisao", toId: decId });
  }

  return { entities, relations };
}

export async function upsertEntities(entities: ExtractedEntity[], relations: ExtractedRelation[]) {
  let created = 0;
  
  for (const e of entities) {
    await runQuery(
      `MERGE (n:${e.label} {id: $id}) ON CREATE SET n.nome = $nome, n += $props`,
      { id: e.id, nome: e.nome, props: e.props || {} }
    );
    created++;
  }
  
  for (const r of relations) {
    await runQuery(
      `MATCH (a:${r.fromLabel} {id: $fromId}), (b:${r.toLabel} {id: $toId})
       MERGE (a)-[:${r.rel}]->(b)`,
      { fromId: r.fromId, toId: r.toId }
    );
  }
  
  return { entitiesProcessed: created, relationsProcessed: relations.length };
}
