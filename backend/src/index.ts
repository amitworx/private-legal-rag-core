import cors from "cors";
import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import {
  createAuthToken,
  isAuthEnabled,
  seedDefaultUser,
  validateCredentials,
  verifyAuthToken
} from "./auth";
import { closeDb, initDb, pool } from "./db";
import { processDocument } from "./documentParser";
import { readMemory, updateMemoryMarkdown } from "./memoryStore";
import { createEmbedding, listModels, ollama } from "./ollama";
import { selectContext } from "./retrieval";
import type { AuthUser, ChatPayload, ContextSelection, UploadedDocument } from "./types";

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? "4000");
const authEnabled = isAuthEnabled();
const dataDir = path.resolve(process.cwd(), "data");
const uploadsDir = path.join(dataDir, "uploads");
const parsedDir = path.join(dataDir, "parsed");

const upload = multer({ dest: uploadsDir });

app.use(cors());
app.use(express.json({ limit: "4mb" }));

type RequestWithAuth = Request & { authUser?: AuthUser };

function isPublicApiPath(pathname: string): boolean {
  return pathname === "/health" || pathname === "/auth/config" || pathname === "/auth/login";
}

function getRequestUser(req: Request): AuthUser | undefined {
  return (req as RequestWithAuth).authUser;
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!authEnabled || isPublicApiPath(req.path)) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    res.status(401).json({ error: "Missing bearer token." });
    return;
  }

  try {
    (req as RequestWithAuth).authUser = verifyAuthToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
  }
}

function sanitizeContext(selection?: Partial<ContextSelection>): ContextSelection {
  return {
    mode: selection?.mode ?? "semantic",
    topK: Math.min(80, Math.max(1, selection?.topK ?? 8)),
    fromChunk: Math.max(0, selection?.fromChunk ?? 0),
    toChunk: Math.max(0, selection?.toChunk ?? 20),
    maxChars: Math.min(1_000_000, Math.max(2_000, selection?.maxChars ?? 60_000))
  };
}

async function ensureSession(
  documentId: string,
  incomingSessionId: string | undefined,
  user?: AuthUser
): Promise<string> {
  if (incomingSessionId) {
    const checkParams: string[] = [incomingSessionId, documentId];
    let checkSql = `
      SELECT s.id
      FROM chat_sessions s
      JOIN documents d ON d.id = s.document_id
      WHERE s.id = $1 AND s.document_id = $2
    `;

    if (authEnabled && user?.role !== "admin") {
      checkParams.push(user?.id ?? "");
      checkSql += " AND d.owner_user_id = $3";
    }

    const check = await pool.query(checkSql, checkParams);
    if (!check.rows.length) {
      throw new Error("Session not found for this document.");
    }

    return incomingSessionId;
  }

  const sessionId = uuidv4();
  await pool.query(
    "INSERT INTO chat_sessions (id, document_id, title) VALUES ($1, $2, $3)",
    [sessionId, documentId, "Default Session"]
  );

  return sessionId;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/auth/config", (_req, res) => {
  res.json({ enabled: authEnabled });
});

app.post("/api/auth/login", async (req, res) => {
  if (!authEnabled) {
    res.json({ token: "", expiresIn: "", enabled: false });
    return;
  }

  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }

  const user = await validateCredentials(username, password);
  if (!user) {
    res.status(401).json({ error: "Invalid credentials." });
    return;
  }

  const token = createAuthToken(user);

  res.json({ token, enabled: true, role: user.role, username: user.username });
});

app.use("/api", requireAuth);

app.get("/api/models", async (_req, res) => {
  try {
    const models = await listModels();
    res.json({ models });
  } catch (error) {
    res.status(500).json({ error: "Unable to list Ollama models.", details: String(error) });
  }
});

app.get("/api/documents", async (req, res) => {
  const user = getRequestUser(req);
  const params: string[] = [];
  let sql = "SELECT id, name, mime_type as \"mimeType\", created_at as \"createdAt\" FROM documents";

  if (authEnabled && user?.role !== "admin") {
    params.push(user?.id ?? "");
    sql += " WHERE owner_user_id = $1";
  }

  sql += " ORDER BY created_at DESC";

  const result = await pool.query(sql, params);
  res.json({ documents: result.rows });
});

app.get("/api/documents/:documentId/sessions", async (req, res) => {
  const { documentId } = req.params;
  const user = getRequestUser(req);
  const params: string[] = [documentId];
  let sql = `
    SELECT s.id, s.title, s.created_at as "createdAt", s.updated_at as "updatedAt"
    FROM chat_sessions s
    JOIN documents d ON d.id = s.document_id
    WHERE s.document_id = $1
  `;

  if (authEnabled && user?.role !== "admin") {
    params.push(user?.id ?? "");
    sql += " AND d.owner_user_id = $2";
  }

  sql += " ORDER BY s.updated_at DESC";

  const result = await pool.query(sql, params);
  res.json({ sessions: result.rows });
});

app.get("/api/sessions/:sessionId/messages", async (req, res) => {
  const { sessionId } = req.params;
  const user = getRequestUser(req);
  const params: string[] = [sessionId];
  let sql = `
    SELECT m.id, m.role, m.content, m.model, m.metadata, m.created_at as "createdAt"
    FROM chat_messages m
    JOIN chat_sessions s ON s.id = m.session_id
    JOIN documents d ON d.id = s.document_id
    WHERE m.session_id = $1
  `;

  if (authEnabled && user?.role !== "admin") {
    params.push(user?.id ?? "");
    sql += " AND d.owner_user_id = $2";
  }

  sql += " ORDER BY m.created_at";

  const result = await pool.query(sql, params);
  res.json({ messages: result.rows });
});

app.post("/api/documents/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "File is required." });
    return;
  }

  const documentId = uuidv4();
  const user = getRequestUser(req);

  try {
    const processed = await processDocument(req.file.path, req.file.mimetype, parsedDir);

    const document: UploadedDocument = {
      id: documentId,
      name: req.file.originalname,
      mimeType: req.file.mimetype || "application/octet-stream",
      originalPath: req.file.path,
      textPath: processed.textPath,
      chunksPath: processed.chunksPath,
      memoryPath: processed.memoryPath,
      ownerUserId: authEnabled ? (user?.id ?? null) : null,
      createdAt: new Date().toISOString()
    };

    await pool.query(
      `INSERT INTO documents (id, name, mime_type, original_path, text_path, chunks_path, memory_path, owner_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        document.id,
        document.name,
        document.mimeType,
        document.originalPath,
        document.textPath,
        document.chunksPath,
        document.memoryPath,
        document.ownerUserId
      ]
    );

    const sessionId = uuidv4();
    await pool.query(
      "INSERT INTO chat_sessions (id, document_id, title) VALUES ($1, $2, $3)",
      [sessionId, document.id, "Default Session"]
    );

    res.status(201).json({
      documentId,
      sessionId,
      chunkCount: processed.chunkCount
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to process the uploaded document.", details: String(error) });
  }
});

app.post("/api/chat/:documentId", async (req, res) => {
  const { documentId } = req.params;
  const payload = req.body as ChatPayload;
  const user = getRequestUser(req);

  if (!payload?.message || !payload.model) {
    res.status(400).json({ error: "Both message and model are required." });
    return;
  }

  const docParams: string[] = [documentId];
  let docSql = `SELECT
    id,
    name,
    mime_type as "mimeType",
    original_path as "originalPath",
    text_path as "textPath",
    chunks_path as "chunksPath",
    memory_path as "memoryPath",
    owner_user_id as "ownerUserId",
    created_at as "createdAt"
  FROM documents
  WHERE id = $1`;

  if (authEnabled && user?.role !== "admin") {
    docParams.push(user?.id ?? "");
    docSql += " AND owner_user_id = $2";
  }

  const docResult = await pool.query(docSql, docParams);

  const doc = docResult.rows[0] as UploadedDocument | undefined;
  if (!doc) {
    res.status(404).json({ error: "Document not found." });
    return;
  }

  const contextSelection = sanitizeContext(payload.context);

  try {
    const sessionId = await ensureSession(documentId, payload.sessionId, user);
    const queryEmbedding = await createEmbedding(payload.message);
    const contextText = await selectContext(doc.chunksPath, contextSelection, queryEmbedding);
    const memoryText = await readMemory(doc.memoryPath);

    const systemPrompt = [
      "You are a document-grounded assistant.",
      "Only answer from provided context and memory notes.",
      "If context is insufficient, say what is missing.",
      "Be concise and structured when appropriate."
    ].join("\n");

    const userPrompt = [
      "Document Context:",
      contextText,
      "",
      "Memory Notes:",
      memoryText,
      "",
      `User Question: ${payload.message}`
    ].join("\n");

    const completion = await ollama.chat({
      model: payload.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      stream: false
    });

    const answer = completion.message.content;

    await pool.query(
      "INSERT INTO chat_messages (id, session_id, role, content, model, metadata) VALUES ($1, $2, $3, $4, $5, $6)",
      [uuidv4(), sessionId, "user", payload.message, payload.model, { contextSelection }]
    );

    await pool.query(
      "INSERT INTO chat_messages (id, session_id, role, content, model, metadata) VALUES ($1, $2, $3, $4, $5, $6)",
      [uuidv4(), sessionId, "assistant", answer, payload.model, { contextSelection }]
    );

    await pool.query(
      "UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1",
      [sessionId]
    );

    await updateMemoryMarkdown(doc.memoryPath, payload.message, answer);

    res.json({
      sessionId,
      answer,
      model: payload.model,
      context: contextSelection
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to generate response.", details: String(error) });
  }
});

async function bootstrap(): Promise<void> {
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.mkdir(parsedDir, { recursive: true });
  await initDb();
  await seedDefaultUser();

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend running on port ${port}`);
  });
}

bootstrap().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  await closeDb();
  process.exit(1);
});
