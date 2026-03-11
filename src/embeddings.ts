// Lola Brain — Ollama Embeddings (local or VPS, zero external dependency)
import { OLLAMA_URL as CONFIGURED_OLLAMA_URL } from "./config.ts";
const OLLAMA_URL = CONFIGURED_OLLAMA_URL;
const MODEL = "nomic-embed-text";

export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`Ollama embed error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.embeddings[0];
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`Ollama embed error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.embeddings;
}
