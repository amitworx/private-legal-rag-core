import fs from "node:fs/promises";
import type { ContextSelection, DocumentChunk } from "./types";

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) {
    return -1;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (!normA || !normB) {
    return -1;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function loadChunks(chunksPath: string): Promise<DocumentChunk[]> {
  const raw = await fs.readFile(chunksPath, "utf8");
  return JSON.parse(raw) as DocumentChunk[];
}

export async function selectContext(
  chunksPath: string,
  selection: ContextSelection,
  queryEmbedding: number[]
): Promise<string> {
  const chunks = await loadChunks(chunksPath);

  if (selection.mode === "full") {
    const joined = chunks.map((chunk) => chunk.text).join("\n\n");
    return joined.slice(0, selection.maxChars);
  }

  if (selection.mode === "range") {
    const boundedStart = Math.max(0, selection.fromChunk);
    const boundedEnd = Math.min(chunks.length - 1, selection.toChunk);
    return chunks
      .filter((chunk) => chunk.index >= boundedStart && chunk.index <= boundedEnd)
      .map((chunk) => chunk.text)
      .join("\n\n")
      .slice(0, selection.maxChars);
  }

  const scored = chunks
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, selection.topK));

  return scored.map((entry) => entry.chunk.text).join("\n\n").slice(0, selection.maxChars);
}
