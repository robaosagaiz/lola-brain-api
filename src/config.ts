// Lola Brain — Configuration
// Supports both local (Mac Mini) and VPS (EasyPanel Docker network) via env vars
export const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
export const QDRANT_API_KEY = process.env.QDRANT_API_KEY || "hawthorne-qdrant-2025";
export const NEO4J_URI = process.env.NEO4J_URI || "bolt://localhost:7687";
export const NEO4J_USER = process.env.NEO4J_USER || "neo4j";
export const NEO4J_PASS = process.env.NEO4J_PASS || "lobabrain2026";
export const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

// Gemini embedding model
export const GEMINI_MODEL = "text-embedding-004";

// Collections — Lola Brain (meu)
export const COLLECTIONS = {
  notes: "brain-notes",
  transcripts: "brain-transcripts",
  content: "brain-content",
} as const;

// Collection — Patient Brain (isolada, nunca consultada por /search)
export const PATIENT_COLLECTION = "patient-brains";

// Collection — Medical Knowledge Base (livros, artigos, guidelines)
export const MEDICAL_COLLECTION = "medical-knowledge";
