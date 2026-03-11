// Lola Brain — Patient Graph (Neo4j entities for consultations)
import { runQuery } from "./neo4j-client.ts";

interface ConsultationMeta {
  patient_id: string;
  patient_name?: string;
  date?: string;
  consultation_number?: number;
  source_type?: string;
  peso?: number;
  gordura_pct?: number;
  massa_magra?: number;
  objetivo?: string;
}

// Extract medical entities from consultation text
function extractMedicalEntities(text: string) {
  const medicacoes: string[] = [];
  const orientacoes: string[] = [];
  const exames: string[] = [];
  const metricas: Record<string, string> = {};

  // Medicações comuns
  const medPatterns = [
    /semaglutida[\s:]*([\d,\.]+\s*mg)?/gi,
    /tirzepatida[\s:]*([\d,\.]+\s*mg)?/gi,
    /mounjaro[\s:]*([\d,\.]+\s*mg)?/gi,
    /wegovy[\s:]*([\d,\.]+\s*mg)?/gi,
    /ozempic[\s:]*([\d,\.]+\s*mg)?/gi,
    /liraglutida[\s:]*([\d,\.]+\s*mg)?/gi,
    /metformina[\s:]*([\d,\.]+\s*mg)?/gi,
    /whey/gi,
    /creatina/gi,
    /vitamina\s*\w+/gi,
    /omega[\s-]?3/gi,
    /magnésio|magnesio/gi,
    /zinco/gi,
    /ferro/gi,
    /b12/gi,
  ];

  for (const pattern of medPatterns) {
    const matches = text.matchAll(pattern);
    for (const m of matches) {
      const med = m[0].trim();
      if (!medicacoes.includes(med.toLowerCase())) {
        medicacoes.push(med);
      }
    }
  }

  // Métricas (peso, gordura, etc.)
  const pesoMatch = text.match(/peso[\s:]*(\d+[,\.]\d+|\d+)\s*kg/i);
  if (pesoMatch) metricas.peso = pesoMatch[1].replace(',', '.');

  const gorduraMatch = text.match(/gordura[\s:]*(\d+[,\.]\d+)\s*%/i);
  if (gorduraMatch) metricas.gordura_pct = gorduraMatch[1].replace(',', '.');

  const massaMagraMatch = text.match(/massa\s*(?:magra|muscular)[\s:]*(\d+[,\.]\d+)\s*kg/i);
  if (massaMagraMatch) metricas.massa_magra = massaMagraMatch[1].replace(',', '.');

  const visceralMatch = text.match(/(?:gordura\s*)?visceral[\s:]*(\d+)/i);
  if (visceralMatch) metricas.gordura_visceral = visceralMatch[1];

  // Exames
  const examePatterns = [
    /hemograma/gi, /glicemia/gi, /hba1c|hemoglobina\s*glicada/gi,
    /colesterol/gi, /triglicérides|triglicerides/gi, /tsh/gi,
    /t4[\s-]?livre/gi, /vitamina\s*d/gi, /ferritina/gi,
    /pcr|proteína\s*c\s*reativa/gi, /insulina/gi, /creatinina/gi,
    /ácido\s*úrico|acido\s*urico/gi, /tgo|tgp|ast|alt/gi,
    /bioimpedância|bioimpedancia/gi,
  ];

  for (const pattern of examePatterns) {
    const matches = text.matchAll(pattern);
    for (const m of matches) {
      const exame = m[0].trim();
      if (!exames.some(e => e.toLowerCase() === exame.toLowerCase())) {
        exames.push(exame);
      }
    }
  }

  return { medicacoes: [...new Set(medicacoes)], orientacoes, exames: [...new Set(exames)], metricas };
}

export async function upsertPatientGraph(meta: ConsultationMeta, text: string) {
  const { patient_id, patient_name, date, consultation_number, source_type } = meta;

  // 1. Create/update Patient node
  await runQuery(
    `MERGE (p:Paciente {patient_id: $patient_id})
     ON CREATE SET p.nome = $nome, p.created = datetime()
     ON MATCH SET p.nome = COALESCE($nome, p.nome), p.updated = datetime()`,
    { patient_id, nome: patient_name || null }
  );

  // Link patient to Hawthorne project
  await runQuery(
    `MATCH (p:Paciente {patient_id: $patient_id}), (proj:Projeto {id: 'hawthorne'})
     MERGE (p)-[:PACIENTE_DE]->(proj)`,
    { patient_id }
  );

  // 2. Create Consultation node (only if we have a date)
  if (date) {
    const consultaId = `consulta-${patient_id}-${date}`;
    const tipo = source_type?.includes('crua') ? 'crua' : (source_type?.includes('tratada') ? 'tratada' : 'geral');

    await runQuery(
      `MERGE (c:Consulta {id: $id})
       ON CREATE SET c.data = $date, c.numero = $numero, c.tipo_transcricao = $tipo, c.created = datetime()
       ON MATCH SET c.tipo_transcricao = CASE WHEN c.tipo_transcricao = 'tratada' THEN c.tipo_transcricao ELSE $tipo END`,
      { id: consultaId, date, numero: consultation_number || null, tipo }
    );

    // Patient -> Consultation
    await runQuery(
      `MATCH (p:Paciente {patient_id: $patient_id}), (c:Consulta {id: $consultaId})
       MERGE (p)-[:FEZ_CONSULTA]->(c)`,
      { patient_id, consultaId }
    );

    // Robson attended
    await runQuery(
      `MATCH (r:Pessoa {id: 'robson'}), (c:Consulta {id: $consultaId})
       MERGE (r)-[:ATENDEU]->(c)`,
      { consultaId }
    );

    // Clara participated (if mentioned)
    if (/clara/i.test(text)) {
      await runQuery(
        `MATCH (cl:Pessoa {id: 'clara'}), (c:Consulta {id: $consultaId})
         MERGE (cl)-[:PARTICIPOU]->(c)`,
        { consultaId }
      );
    }

    // 3. Extract and link medical entities
    const { medicacoes, exames, metricas } = extractMedicalEntities(text);

    // Medications
    for (const med of medicacoes) {
      const medId = `med-${med.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;
      await runQuery(
        `MERGE (m:Medicacao {id: $medId})
         ON CREATE SET m.nome = $nome
         WITH m
         MATCH (c:Consulta {id: $consultaId})
         MERGE (c)-[:PRESCREVEU]->(m)`,
        { medId, nome: med, consultaId }
      );
    }

    // Exams
    for (const exame of exames) {
      const exameId = `exame-${exame.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;
      await runQuery(
        `MERGE (e:Exame {id: $exameId})
         ON CREATE SET e.nome = $nome
         WITH e
         MATCH (c:Consulta {id: $consultaId})
         MERGE (c)-[:SOLICITOU]->(e)`,
        { exameId, nome: exame, consultaId }
      );
    }

    // Metrics on consultation
    if (Object.keys(metricas).length > 0) {
      await runQuery(
        `MATCH (c:Consulta {id: $consultaId})
         SET c += $metricas`,
        { consultaId, metricas }
      );
    }

    return {
      patient_node: patient_id,
      consultation_node: consultaId,
      medicacoes: medicacoes.length,
      exames: exames.length,
      metricas: Object.keys(metricas),
    };
  }

  return { patient_node: patient_id, consultation_node: null };
}

// ==================== PLANO ALIMENTAR ====================

interface PlanoAlimentarMeta {
  patient_id: string;
  patient_name?: string;
  date: string;
  consultation_number?: number;
  kcal: number;
  proteina: number;
  carboidrato: number;
  gordura: number;
  num_refeicoes: number;
  meta_hidrica_ml?: number;
  observacoes?: string;
}

export async function upsertPlanoAlimentar(meta: PlanoAlimentarMeta) {
  const {
    patient_id, patient_name, date, consultation_number,
    kcal, proteina, carboidrato, gordura, num_refeicoes,
    meta_hidrica_ml, observacoes
  } = meta;

  const planoId = `plano-${patient_id}-${date}`;
  const consultaId = `consulta-${patient_id}-${date}`;

  // Ensure patient exists
  await runQuery(
    `MERGE (p:Paciente {patient_id: $patient_id})
     ON CREATE SET p.nome = $nome, p.created = datetime()
     ON MATCH SET p.nome = COALESCE($nome, p.nome), p.updated = datetime()`,
    { patient_id, nome: patient_name || null }
  );

  // Create/update PlanoAlimentar node
  await runQuery(
    `MERGE (pa:PlanoAlimentar {id: $planoId})
     ON CREATE SET
       pa.data = $date,
       pa.kcal = $kcal,
       pa.proteina = $proteina,
       pa.carboidrato = $carboidrato,
       pa.gordura = $gordura,
       pa.num_refeicoes = $num_refeicoes,
       pa.meta_hidrica_ml = $meta_hidrica_ml,
       pa.observacoes = $observacoes,
       pa.created = datetime()
     ON MATCH SET
       pa.kcal = $kcal,
       pa.proteina = $proteina,
       pa.carboidrato = $carboidrato,
       pa.gordura = $gordura,
       pa.num_refeicoes = $num_refeicoes,
       pa.meta_hidrica_ml = $meta_hidrica_ml,
       pa.observacoes = $observacoes,
       pa.updated = datetime()`,
    { planoId, date, kcal, proteina, carboidrato, gordura, num_refeicoes, meta_hidrica_ml: meta_hidrica_ml || null, observacoes: observacoes || null }
  );

  // Patient -> PlanoAlimentar
  await runQuery(
    `MATCH (p:Paciente {patient_id: $patient_id}), (pa:PlanoAlimentar {id: $planoId})
     MERGE (p)-[:TEM_PLANO]->(pa)`,
    { patient_id, planoId }
  );

  // Consulta -> PlanoAlimentar (if consultation exists)
  await runQuery(
    `MATCH (c:Consulta {id: $consultaId}), (pa:PlanoAlimentar {id: $planoId})
     MERGE (c)-[:GEROU_PLANO]->(pa)`,
    { consultaId, planoId }
  );

  // Clara authored
  await runQuery(
    `MATCH (cl:Pessoa {id: 'clara'}), (pa:PlanoAlimentar {id: $planoId})
     MERGE (cl)-[:ELABOROU]->(pa)`,
    { planoId }
  );

  return { plano_node: planoId, patient_id, date };
}
