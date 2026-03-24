import dotenv from "dotenv";
import { Ollama } from "ollama";

dotenv.config();

const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

export const ollama = new Ollama({ host: baseUrl });

export async function listModels(): Promise<string[]> {
  const tags = await ollama.list();
  return tags.models.map((m) => m.model);
}

export async function createEmbedding(text: string): Promise<number[]> {
  const result = await ollama.embed({
    model: "nomic-embed-text",
    input: text
  });

  return result.embeddings[0] ?? [];
}
