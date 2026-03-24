export type Role = "user" | "assistant";
export type AuthRole = "admin" | "user";

export interface AuthUser {
  id: string;
  username: string;
  role: AuthRole;
}

export interface UploadedDocument {
  id: string;
  name: string;
  mimeType: string;
  originalPath: string;
  textPath: string;
  chunksPath: string;
  memoryPath: string;
  ownerUserId: string | null;
  createdAt: string;
}

export interface DocumentChunk {
  id: string;
  text: string;
  embedding: number[];
  index: number;
}

export interface ContextSelection {
  mode: "semantic" | "range" | "full";
  topK: number;
  fromChunk: number;
  toChunk: number;
  maxChars: number;
}

export interface ChatPayload {
  message: string;
  model: string;
  sessionId?: string;
  context: ContextSelection;
}
