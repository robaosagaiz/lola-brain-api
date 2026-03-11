#!/usr/bin/env bun
// Lola Brain — Seed Neo4j with initial knowledge graph
import { runQuery, close } from "./neo4j-client.ts";

async function seed() {
  console.log("🧠 Lola Brain — Seeding Neo4j Knowledge Graph\n");

  // Create constraints (unique IDs)
  const constraints = [
    "CREATE CONSTRAINT IF NOT EXISTS FOR (p:Pessoa) REQUIRE p.id IS UNIQUE",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (pr:Projeto) REQUIRE pr.id IS UNIQUE",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (f:Ferramenta) REQUIRE f.id IS UNIQUE",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (w:Workflow) REQUIRE w.id IS UNIQUE",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (c:Conceito) REQUIRE c.id IS UNIQUE",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (r:Papel) REQUIRE r.id IS UNIQUE",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (d:Decisao) REQUIRE d.id IS UNIQUE",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (ct:Conteudo) REQUIRE ct.id IS UNIQUE",
  ];
  
  for (const q of constraints) {
    await runQuery(q);
  }
  console.log("✅ Constraints criadas\n");

  // === PESSOAS ===
  console.log("👥 Criando Pessoas...");
  const pessoas = [
    { id: "robson", nome: "Robson Andrade Chamon do Carmo", tipo: "owner", profissao: "Médico Cardiologista e Nutrólogo", instagram: "@dr.robsonchamon", github: "robaosagaiz" },
    { id: "clara", nome: "Clara Maria Nunes", tipo: "partner", profissao: "Nutricionista", relacao: "esposa" },
    { id: "clarice", nome: "Clarice", tipo: "team", profissao: "Secretária/Téc. Enfermagem" },
    { id: "clarissa", nome: "Clarissa", tipo: "family", relacao: "filha", nascimento: "2024-07" },
    { id: "lola-dog", nome: "Lola", tipo: "pet", raca: "Whippet", pelagem: "grey-blue/branca" },
    { id: "lola-ai", nome: "Lola (AI)", tipo: "ai", email: "lolawhippet2021@gmail.com" },
    { id: "vitor-jassie", nome: "Vitor Jassié", tipo: "mentor", grupo: "Médico Celebridade" },
    // Pacientes
    { id: "raysa", nome: "Raysa", tipo: "paciente", protocolo: "1100kcal", peso: "98kg" },
    { id: "simone", nome: "Simone Chamoun", tipo: "paciente", peso_inicial: "76.4kg", peso_atual: "70.7kg" },
    { id: "lucas-bolleli", nome: "Lucas Bolleli", tipo: "paciente" },
    { id: "romulo", nome: "Rômulo Oliveira", tipo: "paciente" },
    { id: "suelen", nome: "Suelen", tipo: "paciente" },
    { id: "thiago", nome: "Thiago", tipo: "paciente" },
    { id: "tiago-cardoso", nome: "Tiago Cardoso", tipo: "paciente" },
  ];
  
  for (const p of pessoas) {
    await runQuery(
      `MERGE (p:Pessoa {id: $id}) SET p += $props`,
      { id: p.id, props: p }
    );
  }
  console.log(`  ✅ ${pessoas.length} pessoas`);

  // === PROJETOS ===
  console.log("📦 Criando Projetos...");
  const projetos = [
    { id: "hawthorne", nome: "Hawthorne App", tipo: "app", stack: "React+TS+Vite+Express+Sheets", status: "active", repo: "robaosagaiz/hawthorne-app" },
    { id: "crm-chamon", nome: "CRM Chamon", tipo: "app", dominio: "crm.chamon.cloud", status: "active" },
    { id: "ads-dashboard", nome: "Chamon Ads Dashboard", tipo: "app", status: "blocked", motivo: "Google Ads Basic Access pendente" },
    { id: "gestao-clinica", nome: "Gestão da Clínica", tipo: "sistema", modulos: "Estoque, Financeiro, CRM", status: "active" },
    { id: "newsletter-ia", nome: "Newsletter de IA", tipo: "negocio", fase: "4-execucao", status: "paused" },
    { id: "crm-black", nome: "Mentoria CRM Black", tipo: "mentoria", mentor: "Vitor Jassié", duracao: "6 meses", status: "active" },
    { id: "instagram-conteudo", nome: "Instagram @dr.robsonchamon", tipo: "conteudo", status: "active" },
    { id: "prontuario", nome: "Prontuário Digital Chamon", tipo: "app", status: "mvp", porta: "3003" },
    { id: "lola-brain", nome: "Lola Brain", tipo: "infra", stack: "Qdrant+Neo4j+TS", status: "building" },
    { id: "visa-inspecao", nome: "Adequação VISA", tipo: "compliance", prazo: "2026-03-04", status: "active" },
  ];
  
  for (const p of projetos) {
    await runQuery(
      `MERGE (p:Projeto {id: $id}) SET p += $props`,
      { id: p.id, props: p }
    );
  }
  console.log(`  ✅ ${projetos.length} projetos`);

  // === FERRAMENTAS ===
  console.log("🔧 Criando Ferramentas...");
  const ferramentas = [
    { id: "n8n-local", nome: "n8n Local", tipo: "automation", host: "mac-mini", porta: "5678" },
    { id: "n8n-vps", nome: "n8n VPS", tipo: "automation", url: "https://n8n.chamon.cloud" },
    { id: "google-sheets", nome: "Google Sheets", tipo: "database" },
    { id: "notion", nome: "Notion", tipo: "docs" },
    { id: "evolution-api", nome: "Evolution API", tipo: "messaging", url: "https://evolutionapi.chamon.cloud" },
    { id: "qdrant", nome: "Qdrant", tipo: "vectorstore", porta: "6333" },
    { id: "neo4j", nome: "Neo4j", tipo: "graphdb", porta: "7474" },
    { id: "firebase", nome: "Firebase", tipo: "auth" },
    { id: "easypanel", nome: "EasyPanel", tipo: "deploy", url: "https://easypanel.chamon.cloud" },
    { id: "gemini", nome: "Gemini", tipo: "ai", modelos: "Flash, Pro, Embedding" },
    { id: "openclaw", nome: "OpenClaw", tipo: "ai-platform", versao: "2026.2.3-1" },
    { id: "whisper", nome: "Whisper", tipo: "transcription", modelo: "small" },
    { id: "pinecone", nome: "Pinecone", tipo: "vectorstore" },
    { id: "home-assistant", nome: "Home Assistant", tipo: "iot", porta: "8123" },
  ];
  
  for (const f of ferramentas) {
    await runQuery(
      `MERGE (f:Ferramenta {id: $id}) SET f += $props`,
      { id: f.id, props: f }
    );
  }
  console.log(`  ✅ ${ferramentas.length} ferramentas`);

  // === WORKFLOWS ===
  console.log("⚡ Criando Workflows...");
  const workflows = [
    { id: "food-log-v2", nome: "Hawthorne Food Log V2", n8n_id: "IHAVJqDaRwif7q2l", host: "vps", status: "active" },
    { id: "transcritor-consulta", nome: "Transcritor de Consultas", n8n_id: "xX52W236w5A7XL6N", host: "local", status: "active" },
    { id: "estoque-bot", nome: "Bot Estoque", n8n_id: "IEVjuzbKRYwWXte2", host: "local", status: "active" },
    { id: "add-dieta", nome: "/add_dieta", n8n_id: "7xHxbBOIYmv4iYvH", host: "vps", status: "active" },
    { id: "lembretes-v2", nome: "Lembretes Pacientes", n8n_id: "4Qz8PvznaqhLqWL5", host: "vps", status: "active" },
    { id: "prontuario-notion", nome: "Prontuário Simples Notion", n8n_id: "i1gT7uLvkxX9avBg", host: "vps", status: "active" },
    { id: "relatorio-v1.2", nome: "Relatório v1.2", n8n_id: "aFV4IXkqC0mjDdtt", host: "vps", status: "active" },
    { id: "dev-workflow", nome: "Workflow Dev", n8n_id: "c6M82SY9MOqCuxWG", host: "local", status: "active" },
    { id: "social-seller-cron", nome: "Social Seller Cron", tipo: "openclaw-cron", status: "active" },
    { id: "weekly-planner", nome: "Planner Semanal", tipo: "openclaw-cron", n8n_id: "2c5666c4", status: "active" },
  ];
  
  for (const w of workflows) {
    await runQuery(
      `MERGE (w:Workflow {id: $id}) SET w += $props`,
      { id: w.id, props: w }
    );
  }
  console.log(`  ✅ ${workflows.length} workflows`);

  // === CONCEITOS ===
  console.log("💡 Criando Conceitos...");
  const conceitos = [
    { id: "glp1-gip", nome: "GLP-1/GIP (Semaglutida, Tirzepatida)", area: "medicina", posicao: "altamente a favor, como ferramenta num programa maior" },
    { id: "tdee", nome: "TDEE (Total Daily Energy Expenditure)", area: "nutricao", implementacao: "EMA α=0.25, Mifflin-St Jeor, ρ=8500" },
    { id: "longevidade", nome: "Longevidade", area: "medicina", foco: "qualidade de vida + sobrevida" },
    { id: "medicina-estilo-vida", nome: "Medicina do Estilo de Vida", area: "medicina" },
    { id: "emagrecimento-saude", nome: "Emagrecimento com Saúde", area: "medicina", diferencial: "não estética" },
    { id: "taco-db", nome: "Tabela TACO", area: "nutricao", items: "597 alimentos" },
    { id: "covey-7habits", nome: "7 Hábitos (Covey)", area: "produtividade", uso: "planner semanal por papéis" },
    { id: "para-method", nome: "PARA (Tiago Forte)", area: "produtividade", uso: "organização Notion" },
  ];
  
  for (const c of conceitos) {
    await runQuery(
      `MERGE (c:Conceito {id: $id}) SET c += $props`,
      { id: c.id, props: c }
    );
  }
  console.log(`  ✅ ${conceitos.length} conceitos`);

  // === PAPÉIS ===
  console.log("🎭 Criando Papéis...");
  const papeis = [
    { id: "medico-plantonista", nome: "Médico Plantonista", local: "UCo Hospital Santa Rita", ciclo: "quinzenal" },
    { id: "medico-enfermaria", nome: "Médico Enfermaria", local: "Vitória Apart", ciclo: "diário + 1 FDS/mês" },
    { id: "medico-consultorio", nome: "Médico do Consultório", local: "Chamon Clínica" },
    { id: "empresario", nome: "Empresário", foco: "gestão, mentoria, marketing" },
    { id: "pai", nome: "Pai" },
    { id: "marido", nome: "Marido" },
    { id: "atleta", nome: "Saúde/Atleta", atividades: "CrossFit, Surf" },
  ];
  
  for (const p of papeis) {
    await runQuery(
      `MERGE (p:Papel {id: $id}) SET p += $props`,
      { id: p.id, props: p }
    );
  }
  console.log(`  ✅ ${papeis.length} papéis`);

  // === DECISÕES IMPORTANTES ===
  console.log("📌 Criando Decisões...");
  const decisoes = [
    { id: "d-favoritos-planilha", texto: "Favoritos de refeição em PLANILHA, não VectorStore", data: "2026-02-24", projeto: "hawthorne" },
    { id: "d-foodlog-pipeline", texto: "Pipeline food log: TACO (Pinecone) → FatSecret → estimativa própria", data: "2026-02-24", projeto: "hawthorne" },
    { id: "d-protocolo-scoped", texto: "Todos endpoints filtrados por protocolo ativo", data: "2026-02-09", projeto: "hawthorne" },
    { id: "d-notion-para", texto: "Organização Notion em PARA (Projects/Areas/Resources/Archive)", data: "2026-02-12", projeto: "notion" },
    { id: "d-social-seller-email", texto: "Relatório Social Seller SEMPRE por email, nunca só Telegram", data: "2026-02-24", projeto: "social-seller" },
    { id: "d-4-campanhas-meta", texto: "4 campanhas Meta Ads em 2 fases de 90 dias", data: "2026-02-12", projeto: "crm-black" },
    { id: "d-lola-brain-stack", texto: "Lola Brain usa Qdrant + Neo4j no Mac Mini", data: "2026-02-27", projeto: "lola-brain" },
    { id: "d-hawthorne-hybrid", texto: "Hawthorne v2 arquitetura híbrida: n8n + Claude API + Lola", data: "2026-02-03", projeto: "hawthorne" },
    { id: "d-sheets-service-account", texto: "Planilhas SEMPRE via Service Account, nunca lolawhippet2021", data: "2026-02-01", projeto: "gestao-clinica" },
  ];
  
  for (const d of decisoes) {
    await runQuery(
      `MERGE (d:Decisao {id: $id}) SET d += $props`,
      { id: d.id, props: { ...d, projeto: undefined } }
    );
  }
  console.log(`  ✅ ${decisoes.length} decisões`);

  // === RELAÇÕES ===
  console.log("\n🔗 Criando Relações...");
  
  const relacoes: [string, string, string, string, string, Record<string, any>?][] = [
    // Robson → Projetos
    ["Pessoa", "robson", "CRIOU", "Projeto", "hawthorne"],
    ["Pessoa", "robson", "CRIOU", "Projeto", "crm-chamon"],
    ["Pessoa", "robson", "CRIOU", "Projeto", "ads-dashboard"],
    ["Pessoa", "robson", "CRIOU", "Projeto", "gestao-clinica"],
    ["Pessoa", "robson", "CRIOU", "Projeto", "newsletter-ia"],
    ["Pessoa", "robson", "CRIOU", "Projeto", "instagram-conteudo"],
    ["Pessoa", "robson", "CRIOU", "Projeto", "prontuario"],
    ["Pessoa", "robson", "PARTICIPA", "Projeto", "crm-black"],
    
    // Lola → Projetos
    ["Pessoa", "lola-ai", "DESENVOLVE", "Projeto", "hawthorne"],
    ["Pessoa", "lola-ai", "DESENVOLVE", "Projeto", "crm-chamon"],
    ["Pessoa", "lola-ai", "DESENVOLVE", "Projeto", "lola-brain"],
    ["Pessoa", "lola-ai", "DESENVOLVE", "Projeto", "newsletter-ia"],
    ["Pessoa", "lola-ai", "DESENVOLVE", "Projeto", "instagram-conteudo"],
    
    // Clara
    ["Pessoa", "clara", "TRABALHA_EM", "Projeto", "hawthorne"],
    ["Pessoa", "clara", "CASADA_COM", "Pessoa", "robson"],
    
    // Mentor
    ["Pessoa", "vitor-jassie", "MENTORA", "Projeto", "crm-black"],
    
    // Robson → Papéis
    ["Pessoa", "robson", "EXERCE", "Papel", "medico-plantonista"],
    ["Pessoa", "robson", "EXERCE", "Papel", "medico-enfermaria"],
    ["Pessoa", "robson", "EXERCE", "Papel", "medico-consultorio"],
    ["Pessoa", "robson", "EXERCE", "Papel", "empresario"],
    ["Pessoa", "robson", "EXERCE", "Papel", "pai"],
    ["Pessoa", "robson", "EXERCE", "Papel", "marido"],
    ["Pessoa", "robson", "EXERCE", "Papel", "atleta"],
    
    // Pacientes → Hawthorne
    ["Pessoa", "raysa", "PACIENTE_DE", "Projeto", "hawthorne"],
    ["Pessoa", "simone", "PACIENTE_DE", "Projeto", "hawthorne"],
    ["Pessoa", "lucas-bolleli", "PACIENTE_DE", "Projeto", "hawthorne"],
    ["Pessoa", "romulo", "PACIENTE_DE", "Projeto", "hawthorne"],
    ["Pessoa", "suelen", "PACIENTE_DE", "Projeto", "hawthorne"],
    ["Pessoa", "thiago", "PACIENTE_DE", "Projeto", "hawthorne"],
    ["Pessoa", "tiago-cardoso", "PACIENTE_DE", "Projeto", "hawthorne"],
    
    // Projetos → Ferramentas
    ["Projeto", "hawthorne", "USA", "Ferramenta", "google-sheets"],
    ["Projeto", "hawthorne", "USA", "Ferramenta", "evolution-api"],
    ["Projeto", "hawthorne", "USA", "Ferramenta", "firebase"],
    ["Projeto", "hawthorne", "USA", "Ferramenta", "easypanel"],
    ["Projeto", "hawthorne", "USA", "Ferramenta", "qdrant"],
    ["Projeto", "hawthorne", "USA", "Ferramenta", "pinecone"],
    ["Projeto", "hawthorne", "USA", "Ferramenta", "gemini"],
    ["Projeto", "crm-chamon", "USA", "Ferramenta", "easypanel"],
    ["Projeto", "gestao-clinica", "USA", "Ferramenta", "google-sheets"],
    ["Projeto", "gestao-clinica", "USA", "Ferramenta", "gemini"],
    ["Projeto", "instagram-conteudo", "USA", "Ferramenta", "notion"],
    ["Projeto", "prontuario", "USA", "Ferramenta", "firebase"],
    ["Projeto", "prontuario", "USA", "Ferramenta", "gemini"],
    ["Projeto", "prontuario", "USA", "Ferramenta", "notion"],
    ["Projeto", "lola-brain", "USA", "Ferramenta", "qdrant"],
    ["Projeto", "lola-brain", "USA", "Ferramenta", "neo4j"],
    ["Projeto", "lola-brain", "USA", "Ferramenta", "gemini"],
    
    // Workflows → Projetos
    ["Workflow", "food-log-v2", "SERVE", "Projeto", "hawthorne"],
    ["Workflow", "transcritor-consulta", "SERVE", "Projeto", "hawthorne"],
    ["Workflow", "estoque-bot", "SERVE", "Projeto", "gestao-clinica"],
    ["Workflow", "add-dieta", "SERVE", "Projeto", "hawthorne"],
    ["Workflow", "lembretes-v2", "SERVE", "Projeto", "hawthorne"],
    ["Workflow", "prontuario-notion", "SERVE", "Projeto", "prontuario"],
    ["Workflow", "relatorio-v1.2", "SERVE", "Projeto", "hawthorne"],
    ["Workflow", "social-seller-cron", "SERVE", "Projeto", "crm-black"],
    ["Workflow", "weekly-planner", "SERVE", "Pessoa", "robson"],
    
    // Workflows → Ferramentas
    ["Workflow", "food-log-v2", "RODA_EM", "Ferramenta", "n8n-vps"],
    ["Workflow", "transcritor-consulta", "RODA_EM", "Ferramenta", "n8n-local"],
    ["Workflow", "estoque-bot", "RODA_EM", "Ferramenta", "n8n-local"],
    ["Workflow", "add-dieta", "RODA_EM", "Ferramenta", "n8n-vps"],
    ["Workflow", "lembretes-v2", "RODA_EM", "Ferramenta", "n8n-vps"],
    ["Workflow", "prontuario-notion", "RODA_EM", "Ferramenta", "n8n-vps"],
    ["Workflow", "dev-workflow", "RODA_EM", "Ferramenta", "n8n-local"],
    
    // Conceitos → Projetos
    ["Conceito", "glp1-gip", "APLICADO_EM", "Projeto", "instagram-conteudo"],
    ["Conceito", "glp1-gip", "APLICADO_EM", "Projeto", "hawthorne"],
    ["Conceito", "tdee", "APLICADO_EM", "Projeto", "hawthorne"],
    ["Conceito", "longevidade", "APLICADO_EM", "Projeto", "instagram-conteudo"],
    ["Conceito", "emagrecimento-saude", "APLICADO_EM", "Projeto", "hawthorne"],
    ["Conceito", "taco-db", "APLICADO_EM", "Projeto", "hawthorne"],
    ["Conceito", "covey-7habits", "APLICADO_EM", "Workflow", "weekly-planner"],
    ["Conceito", "para-method", "APLICADO_EM", "Ferramenta", "notion"],
    
    // CRM Black módulos → Projetos
    ["Projeto", "crm-black", "GEROU_MODULO", "Projeto", "instagram-conteudo", { modulo: "Social Seller" }],
    ["Projeto", "crm-black", "GEROU_MODULO", "Projeto", "gestao-clinica", { modulo: "Manual do Negócio" }],
    ["Projeto", "crm-black", "GEROU_MODULO", "Projeto", "ads-dashboard", { modulo: "Tráfego Pago" }],
  ];
  
  let relCount = 0;
  for (const [fromLabel, fromId, rel, toLabel, toId, props] of relacoes) {
    const propsStr = props ? ` SET r += $props` : "";
    await runQuery(
      `MATCH (a:${fromLabel} {id: $fromId}), (b:${toLabel} {id: $toId})
       MERGE (a)-[r:${rel}]->(b)${propsStr}`,
      { fromId, toId, ...(props ? { props } : {}) }
    );
    relCount++;
  }
  
  // Decisões → Projetos
  for (const d of decisoes) {
    if (d.projeto) {
      // Try Projeto first, then any label
      await runQuery(
        `MATCH (d:Decisao {id: $dId})
         OPTIONAL MATCH (p:Projeto {id: $pId})
         FOREACH (_ IN CASE WHEN p IS NOT NULL THEN [1] ELSE [] END |
           MERGE (d)-[:SOBRE]->(p)
         )`,
        { dId: d.id, pId: d.projeto }
      );
    }
    // All decisions linked to Robson
    await runQuery(
      `MATCH (d:Decisao {id: $dId}), (r:Pessoa {id: 'robson'})
       MERGE (r)-[:DECIDIU]->(d)`,
      { dId: d.id }
    );
  }
  
  console.log(`  ✅ ${relCount + decisoes.length * 2} relações criadas`);
  
  // Summary
  const result = await runQuery(`
    MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count
    ORDER BY count DESC
  `);
  
  console.log("\n📊 Resumo do Grafo:");
  for (const r of result.records) {
    console.log(`  ${r.get("label")}: ${r.get("count").toNumber()}`);
  }
  
  const relResult = await runQuery(`
    MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS count
    ORDER BY count DESC
  `);
  console.log("\n  Relações:");
  for (const r of relResult.records) {
    console.log(`  ${r.get("type")}: ${r.get("count").toNumber()}`);
  }
  
  await close();
  console.log("\n🎉 Grafo Neo4j seedado com sucesso!");
}

seed().catch(console.error);
