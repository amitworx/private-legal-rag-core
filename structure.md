# Project Structure and Routing Map

This file documents the current components, service modules, and routes used in the app.

## Quick Navigation

- Use this file when you need implementation-level routing and ownership behavior.
- Use `README.md` for setup, product-level overview, and deployment guidance.
- Route ownership model:
  - `admin`: global access
  - `user`: access limited to owned documents and descendants

## 1) High-level architecture

- Frontend (React + MUI + Vite)
- Backend (Express + TypeScript)
- LLM provider (Ollama)
- Database (PostgreSQL)
- Local file storage for uploads, parsed chunks, and memory markdown

## 2) Root layout

- `backend/`: API server and ingestion/retrieval logic
- `frontend/`: UI application
- `.github/workflows/ci.yml`: lint/test/build CI for backend and frontend
- `docs/media/`: README screenshots and GIF assets
- `docker-compose.yml`: PostgreSQL container setup
- `README.md`: project documentation
- `structure.md`: architecture/components/routes mapping
- `LICENSE`: MIT license
- `.gitignore`: repository ignore rules

## 3) Frontend components and modules

### `frontend/src/main.tsx`

- App bootstrap and MUI theme provider
- Global baseline styles

### `frontend/src/App.tsx`

Primary UI component handling:

- Auth config check and login flow
- System readiness check for upload prerequisites
- Document upload action
- Model/document/session selectors
- Context mode controls:
  - semantic
  - range
  - full
- Chat message rendering
- Ask/send action
- Assistant copy-to-clipboard action
- Export actions:
  - TXT
  - DOCX
  - PDF

Internal module-level helpers in this file:

- `downloadTextFile(filename, content)`
- `downloadDocx(filename, lines)`
- `downloadPdf(filename, lines)`

Data-fetching functions in this file:

- `initializeAuth()`
- `initializeSystemReadiness()`
- `login()`
- `fetchModels()`
- `fetchDocuments()`
- `fetchSessions(documentId)`
- `fetchMessages(sessionId)`
- `uploadFile(file)`
- `sendQuestion()`

Error/readiness helpers in this file:

- `formatError(error)`

### `frontend/src/styles.css`

- App layout styles
- Responsive breakpoints
- Chat message visual styling

## 4) Backend modules and responsibilities

### `backend/src/index.ts`

- Express app setup
- CORS and JSON middleware
- Multer file upload middleware
- API route definitions
- JWT auth middleware for protected endpoints
- Role-aware ownership checks on document/session/message queries
- Context sanitization and chat orchestration

Key internal functions:

- `isPublicApiPath(pathname)`
- `requireAuth(req, res, next)`
- `sanitizeContext(selection)`
- `ensureSession(documentId, incomingSessionId)`
- `bootstrap()`

### `backend/src/db.ts`

- PostgreSQL pool config
- Auto schema initialization (`initDb`)
- Graceful DB shutdown (`closeDb`)
- `app_users` table and document owner linkage

### `backend/src/auth.ts`

- Default user seeding from env on startup
- Password verification
- JWT token issue and verification

### `backend/src/documentParser.ts`

- File-type parsing logic (PDF, DOCX, image OCR, text)
- PDF parser compatibility for both legacy function and class-based `pdf-parse` APIs
- Chunking strategy
- Embedding generation per chunk
- Parsed artifact writing (`.txt`, chunk JSON, memory markdown)

### `backend/src/retrieval.ts`

- Chunk loading from JSON
- Cosine similarity scoring
- Context selection logic for:
  - semantic retrieval
  - explicit range
  - full-context mode

### `backend/src/ollama.ts`

- Ollama client setup
- Model list call
- Embedding generation helper
- Embedding model availability assertion
- Dedicated missing-model error type for actionable upload responses

### `backend/src/memoryStore.ts`

- Read existing memory markdown
- Append compact memory entries per Q/A turn

### `backend/src/types.ts`

- Shared TypeScript interfaces for:
  - uploaded document metadata
  - chunk records
  - context selection
  - chat payload

## 5) Backend API routes

Base URL: `http://localhost:4001`

Notes:

- All routes below `/api/*` are protected when auth is enabled, except `/api/health`, `/api/auth/config`, `/api/auth/login`, and `/api/system/readiness`.
- Ownership enforcement is implemented in SQL joins against `documents.owner_user_id`.

### Health

- `GET /api/health`
  - Purpose: service liveness check

### System readiness

- `GET /api/system/readiness`
  - Purpose: report whether upload prerequisites are satisfied (Ollama reachable + embedding model installed)
  - Used by UI to surface warning and disable upload when prerequisites are missing

### Authentication

- `GET /api/auth/config`
  - Purpose: expose whether server auth is enabled

- `POST /api/auth/login`
  - Purpose: validate credentials and issue JWT
  - Includes role claim (`admin` or `user`)

### Model discovery

- `GET /api/models`
  - Purpose: list available Ollama models for the UI (protected when auth is enabled)

### Document listing

- `GET /api/documents`
  - Purpose: list uploaded documents
  - Authorization behavior:
    - `admin`: all documents
    - `user`: only documents where `owner_user_id` matches token subject

### Session listing

- `GET /api/documents/:documentId/sessions`
  - Purpose: list chat sessions for a document
  - Authorization behavior:
    - `admin`: all sessions for the document
    - `user`: only if the document is owned by the user

### Message listing

- `GET /api/sessions/:sessionId/messages`
  - Purpose: fetch persisted messages for a session
  - Authorization behavior:
    - `admin`: all messages for the session
    - `user`: only if parent document is owned by the user

### Upload + ingestion

- `POST /api/documents/upload`
  - Content type: multipart/form-data
  - Field: `file`
  - Purpose: upload source file and trigger parse/chunk/embed workflow
  - Preflight: verifies embedding model availability before heavy ingestion work
  - Missing model behavior: returns 400 with actionable remediation message
  - Ownership behavior:
    - when auth enabled, uploaded document is linked to the authenticated user

### Chat

- `POST /api/chat/:documentId`
  - Purpose: ask question using selected model and selected context mode
  - Side effects:
    - stores user and assistant messages
    - updates session timestamp
    - appends markdown memory note
  - Authorization behavior:
    - `admin`: can chat with any document
    - `user`: can chat only with owned documents

## 6) Data flow map

### Upload flow

1. Frontend sends file to `POST /api/documents/upload`
2. Backend parses content and creates chunk embeddings
3. Backend stores metadata in PostgreSQL
4. Backend stores artifacts in filesystem
5. Frontend refreshes document/session selectors

### Chat flow

1. Frontend sends prompt + context settings to `POST /api/chat/:documentId`
2. Backend creates query embedding
3. Backend selects context (semantic/range/full)
4. Backend includes document memory markdown
5. Backend sends prompt to Ollama
6. Backend persists messages and updates memory markdown
7. Frontend reloads current session messages

## 7) Storage components

### PostgreSQL tables

- `app_users`
- `documents`
- `chat_sessions`
- `chat_messages`

### Filesystem runtime artifacts

- `backend/data/uploads/*`
- `backend/data/parsed/*-memory.md`
- `backend/data/parsed/*.txt`
- `backend/data/parsed/*-chunks.json`

## 8) Frontend route map

Current implementation uses a single-page view with no client-side route library.

- `/` -> full app experience in `App.tsx`

## 9) Recommended future component split

If you modularize UI next, suggested components are:

- `components/UploadPanel.tsx`
- `components/ContextControls.tsx`
- `components/ChatWindow.tsx`
- `components/ExportActions.tsx`
- `components/ModelSelector.tsx`
