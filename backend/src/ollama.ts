import dotenv from "dotenv";
import { Ollama } from "ollama";

dotenv.config();

const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const EMBEDDING_MODEL = "nomic-embed-text";

export const ollama = new Ollama({ host: baseUrl });

export class MissingEmbeddingModelError extends Error {
  constructor() {
    super(
      `Missing Ollama embedding model \"${EMBEDDING_MODEL}\". Run: ollama pull ${EMBEDDING_MODEL}`
    );
    this.name = "MissingEmbeddingModelError";
  }
}

export async function listModels(): Promise<string[]> {
  const tags = await ollama.list();
  return tags.models.map((m) => m.model);
}

export async function assertEmbeddingModelAvailable(): Promise<void> {
  const models = await listModels();
  const hasEmbeddingModel = models.some(
    (model) => model === EMBEDDING_MODEL || model.startsWith(`${EMBEDDING_MODEL}:`)
  );

  if (!hasEmbeddingModel) {
    throw new MissingEmbeddingModelError();
  }
}

export async function createEmbedding(text: string): Promise<number[]> {
  try {
    const result = await ollama.embed({
      model: EMBEDDING_MODEL,
      input: text
    });

    return result.embeddings[0] ?? [];
  } catch (error) {
    const message = String(error).toLowerCase();
    if (message.includes("model") && message.includes("not found")) {
      throw new MissingEmbeddingModelError();
    }

    throw error;
  }
}
