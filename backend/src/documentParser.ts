import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import pdfParseModule from "pdf-parse";
import Tesseract from "tesseract.js";
import { v4 as uuidv4 } from "uuid";
import { createEmbedding } from "./ollama";
import type { DocumentChunk } from "./types";

type LegacyPdfParseFn = (buffer: Buffer) => Promise<{ text: string }>;
type PdfParseClass = new (options: { data: Buffer }) => {
  getText: () => Promise<{ text?: string }>;
  destroy?: () => Promise<void>;
};

const legacyPdfParse = (
  pdfParseModule as unknown as { default?: LegacyPdfParseFn }
).default ?? (pdfParseModule as unknown as LegacyPdfParseFn);

const PdfParseCtor = (pdfParseModule as unknown as { PDFParse?: PdfParseClass }).PDFParse;

async function parsePdf(buffer: Buffer): Promise<string> {
  if (typeof legacyPdfParse === "function") {
    const parsed = await legacyPdfParse(buffer);
    return parsed.text;
  }

  if (typeof PdfParseCtor === "function") {
    const parser = new PdfParseCtor({ data: buffer });
    try {
      const parsed = await parser.getText();
      return parsed.text ?? "";
    } finally {
      if (typeof parser.destroy === "function") {
        await parser.destroy();
      }
    }
  }

  throw new Error("Unsupported pdf-parse module shape.");
}

const CHUNK_SIZE = 1800;
const CHUNK_OVERLAP = 250;

function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const end = Math.min(cursor + CHUNK_SIZE, normalized.length);
    const value = normalized.slice(cursor, end).trim();
    if (value) {
      chunks.push(value);
    }
    cursor = Math.max(end - CHUNK_OVERLAP, cursor + 1);
  }

  return chunks;
}

async function parseByMime(filePath: string, mimeType: string): Promise<string> {
  const lower = mimeType.toLowerCase();
  const ext = path.extname(filePath).toLowerCase();

  if (lower.includes("pdf") || ext === ".pdf") {
    const buffer = await fs.readFile(filePath);
    return parsePdf(buffer);
  }

  if (
    lower.includes("word") ||
    ext === ".docx" ||
    ext === ".doc" ||
    ext === ".odt"
  ) {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (
    lower.startsWith("image/") ||
    [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"].includes(ext)
  ) {
    const ocr = await Tesseract.recognize(filePath, "eng");
    return ocr.data.text;
  }

  return fs.readFile(filePath, "utf8");
}

export async function processDocument(
  filePath: string,
  mimeType: string,
  storageDir: string
): Promise<{ textPath: string; chunksPath: string; memoryPath: string; chunkCount: number }> {
  const text = await parseByMime(filePath, mimeType);
  const chunks = chunkText(text);

  if (!chunks.length) {
    throw new Error("No readable content was found in this file.");
  }

  const chunkRecords: DocumentChunk[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const embedding = await createEmbedding(chunks[i]);
    chunkRecords.push({
      id: uuidv4(),
      text: chunks[i],
      embedding,
      index: i
    });
  }

  const baseName = path.basename(filePath, path.extname(filePath));
  const textPath = path.join(storageDir, `${baseName}-${uuidv4()}.txt`);
  const chunksPath = path.join(storageDir, `${baseName}-${uuidv4()}-chunks.json`);
  const memoryPath = path.join(storageDir, `${baseName}-${uuidv4()}-memory.md`);

  await fs.writeFile(textPath, text, "utf8");
  await fs.writeFile(chunksPath, JSON.stringify(chunkRecords), "utf8");
  await fs.writeFile(memoryPath, "# Session Memory\n", "utf8");

  return {
    textPath,
    chunksPath,
    memoryPath,
    chunkCount: chunkRecords.length
  };
}
