import fs from "node:fs/promises";
import type { ContextSelection, DocumentChunk } from "./types";

function tokenizeQuery(text?: string): string[] {
  if (!text) {
    return [];
  }

  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);

  return [...new Set(tokens)];
}

function keywordMatchScore(text: string, tokens: string[]): number {
  if (!tokens.length) {
    return 0;
  }

  const normalized = text.toLowerCase();
  let score = 0;

  for (const token of tokens) {
    if (normalized.includes(token)) {
      score += 1;
    }
  }

  return score;
}

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
  queryEmbedding: number[],
  queryText?: string
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
    .sort((a, b) => b.score - a.score);

  const semanticTop = scored.slice(0, Math.max(1, selection.topK));
  const queryTokens = tokenizeQuery(queryText);

  if (!queryTokens.length) {
    return semanticTop.map((entry) => entry.chunk.text).join("\n\n").slice(0, selection.maxChars);
  }

  // Hybrid retrieval: keep semantic ranking, then blend in top lexical matches for precision terms.
  const lexicalTop = chunks
    .map((chunk) => ({
      chunk,
      score: keywordMatchScore(chunk.text, queryTokens)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(2, Math.ceil(selection.topK / 2)));

  const merged: DocumentChunk[] = [];
  const seen = new Set<number>();

  for (const entry of semanticTop) {
    if (!seen.has(entry.chunk.index)) {
      seen.add(entry.chunk.index);
      merged.push(entry.chunk);
    }
  }

  const semanticHasLexicalMatch = semanticTop.some(
    (entry) => keywordMatchScore(entry.chunk.text, queryTokens) > 0
  );

  // If semantic ranking missed the query term, inject the best lexical hit.
  if (!semanticHasLexicalMatch && lexicalTop[0] && !seen.has(lexicalTop[0].chunk.index)) {
    seen.add(lexicalTop[0].chunk.index);
    merged.push(lexicalTop[0].chunk);
  }

  for (const entry of lexicalTop) {
    if (!seen.has(entry.chunk.index)) {
      seen.add(entry.chunk.index);
      merged.push(entry.chunk);
    }
  }

  const lexicalBudget = semanticHasLexicalMatch ? 0 : 1;
  const contextChunks = merged.slice(0, Math.max(1, selection.topK) + lexicalBudget);

  return contextChunks.map((chunk) => chunk.text).join("\n\n").slice(0, selection.maxChars);
}
