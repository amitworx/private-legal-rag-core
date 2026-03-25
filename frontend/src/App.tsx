import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DescriptionIcon from "@mui/icons-material/Description";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import axios from "axios";
import { Document, Packer, Paragraph } from "docx";
import { saveAs } from "file-saver";
import { jsPDF } from "jspdf";
import { useEffect, useMemo, useState } from "react";

type Role = "user" | "assistant";

interface ModelResponse {
  models: string[];
}

interface AuthConfigResponse {
  enabled: boolean;
}

interface LoginResponse {
  token: string;
  enabled: boolean;
}

interface SystemReadinessResponse {
  ok: boolean;
  uploadReady: boolean;
  details?: string[];
}

interface DocumentRecord {
  id: string;
  name: string;
  mimeType: string;
  createdAt: string;
}

interface SessionRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface MessageRecord {
  id: string;
  role: Role;
  content: string;
  model: string;
  createdAt: string;
}

const baseURL = import.meta.env.VITE_API_URL ?? "/";

const api = axios.create({
  baseURL
});

const publicApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "/"
});

function formatError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const responseData = error.response?.data as
      | { error?: string; details?: string }
      | string
      | undefined;

    if (typeof responseData === "string") {
      return responseData;
    }

    if (responseData?.error && responseData?.details) {
      return `${responseData.error} ${responseData.details}`;
    }

    if (responseData?.error) {
      return responseData.error;
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  saveAs(blob, filename);
}

async function downloadDocx(filename: string, lines: string[]): Promise<void> {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: lines.map((line) => new Paragraph(line))
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename);
}

function downloadPdf(filename: string, lines: string[]): void {
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  let y = 50;

  for (const line of lines) {
    const wrapped = pdf.splitTextToSize(line, 520);
    for (const part of wrapped) {
      if (y > 780) {
        pdf.addPage();
        y = 50;
      }
      pdf.text(part, 40, y);
      y += 18;
    }
  }

  pdf.save(filename);
}

export default function App() {
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem("authToken") ?? "");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedDocument, setSelectedDocument] = useState("");
  const [selectedSession, setSelectedSession] = useState("");
  const [question, setQuestion] = useState("");
  const [contextMode, setContextMode] = useState<"semantic" | "range" | "full">("semantic");
  const [topK, setTopK] = useState(12);
  const [fromChunk, setFromChunk] = useState(0);
  const [toChunk, setToChunk] = useState(30);
  const [maxChars, setMaxChars] = useState(80000);
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [uploadReadinessWarning, setUploadReadinessWarning] = useState("");

  function applyToken(nextToken: string): void {
    if (nextToken) {
      localStorage.setItem("authToken", nextToken);
      api.defaults.headers.common.Authorization = `Bearer ${nextToken}`;
    } else {
      localStorage.removeItem("authToken");
      delete api.defaults.headers.common.Authorization;
    }
    setToken(nextToken);
  }

  async function initializeAuth(): Promise<void> {
    try {
      const { data } = await publicApi.get<AuthConfigResponse>("/api/auth/config");
      setAuthEnabled(data.enabled);

      if (data.enabled && token) {
        api.defaults.headers.common.Authorization = `Bearer ${token}`;
      }
    } catch {
      // If auth config endpoint is unavailable, default to open mode for compatibility.
      setAuthEnabled(false);
    } finally {
      setAuthReady(true);
    }
  }

  async function initializeSystemReadiness(): Promise<void> {
    try {
      const { data } = await publicApi.get<SystemReadinessResponse>("/api/system/readiness");
      if (!data.uploadReady) {
        setUploadReadinessWarning(
          data.details?.[0]
            ?? "Upload is not ready. Ensure Ollama is running and nomic-embed-text is installed."
        );
        return;
      }

      setUploadReadinessWarning("");
    } catch (err) {
      setUploadReadinessWarning(formatError(err));
    }
  }

  async function login(): Promise<void> {
    setError("");
    setIsLoggingIn(true);
    try {
      const { data } = await publicApi.post<LoginResponse>("/api/auth/login", {
        username,
        password
      });

      if (data.enabled && data.token) {
        applyToken(data.token);
      } else {
        applyToken("");
      }
      setPassword("");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setIsLoggingIn(false);
    }
  }

  const chatExportLines = useMemo(
    () =>
      messages.map(
        (message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`
      ),
    [messages]
  );

  async function fetchModels(): Promise<void> {
    const { data } = await api.get<ModelResponse>("/api/models");
    setModels(data.models);
    if (!selectedModel && data.models[0]) {
      setSelectedModel(data.models[0]);
    }
  }

  async function fetchDocuments(): Promise<void> {
    const { data } = await api.get<{ documents: DocumentRecord[] }>("/api/documents");
    setDocuments(data.documents);
    if (!selectedDocument && data.documents[0]) {
      setSelectedDocument(data.documents[0].id);
    }
  }

  async function fetchSessions(documentId: string): Promise<void> {
    const { data } = await api.get<{ sessions: SessionRecord[] }>(`/api/documents/${documentId}/sessions`);
    setSessions(data.sessions);
    if (data.sessions[0]) {
      setSelectedSession(data.sessions[0].id);
    } else {
      setSelectedSession("");
      setMessages([]);
    }
  }

  async function fetchMessages(sessionId: string): Promise<void> {
    const { data } = await api.get<{ messages: MessageRecord[] }>(`/api/sessions/${sessionId}/messages`);
    setMessages(data.messages);
  }

  useEffect(() => {
    void initializeAuth();
    void initializeSystemReadiness();
  }, []);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    if (authEnabled && !token) {
      return;
    }

    Promise.all([fetchModels(), fetchDocuments()]).catch((err) => {
      setError(formatError(err));
      if (String(err).includes("401")) {
        applyToken("");
      }
    });
  }, [authReady, authEnabled, token]);

  useEffect(() => {
    if (!selectedDocument) {
      return;
    }
    fetchSessions(selectedDocument).catch((err) => setError(formatError(err)));
  }, [selectedDocument]);

  useEffect(() => {
    if (!selectedSession) {
      return;
    }
    fetchMessages(selectedSession).catch((err) => setError(formatError(err)));
  }, [selectedSession]);

  async function uploadFile(file: File): Promise<void> {
    setError("");
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post<{ documentId: string; sessionId: string }>(
        "/api/documents/upload",
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" }
        }
      );

      await fetchDocuments();
      setSelectedDocument(data.documentId);
      setSelectedSession(data.sessionId);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setIsUploading(false);
    }
  }

  async function sendQuestion(): Promise<void> {
    if (!question.trim() || !selectedDocument || !selectedModel) {
      return;
    }

    setError("");
    setIsSending(true);
    try {
      await api.post(`/api/chat/${selectedDocument}`, {
        message: question,
        model: selectedModel,
        sessionId: selectedSession || undefined,
        context: {
          mode: contextMode,
          topK,
          fromChunk,
          toChunk,
          maxChars
        }
      });

      if (selectedDocument) {
        await fetchSessions(selectedDocument);
      }
      if (selectedSession) {
        await fetchMessages(selectedSession);
      }
      setQuestion("");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Box className="page-shell">
      <Box className="overlay-gradient" />
      <Box className="content-wrap">
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="h3" fontWeight={700}>
            Local RAG Workspace
          </Typography>
          {authEnabled && token && (
            <Button
              variant="outlined"
              onClick={() => {
                applyToken("");
                setMessages([]);
                setSessions([]);
                setDocuments([]);
              }}
            >
              Logout
            </Button>
          )}
        </Stack>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
          Upload PDFs, images, and docs. Select Ollama models, choose retrieval context depth, and keep persistent chat history with memory notes.
        </Typography>

        {error && <Alert severity="error">{error}</Alert>}
        {uploadReadinessWarning && <Alert severity="warning">{uploadReadinessWarning}</Alert>}

        {authReady && authEnabled && !token && (
          <Card sx={{ mb: 2, maxWidth: 520 }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Sign in
              </Typography>
              <Stack spacing={1.25}>
                <TextField
                  label="Username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
                <TextField
                  type="password"
                  label="Password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <Button variant="contained" disabled={isLoggingIn} onClick={() => void login()}>
                  {isLoggingIn ? "Signing in..." : "Login"}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        )}

        {authReady && authEnabled && !token ? null : (

        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Button
                    variant="contained"
                    component="label"
                    startIcon={<UploadFileIcon />}
                    disabled={isUploading || Boolean(uploadReadinessWarning)}
                  >
                    {isUploading ? "Uploading..." : "Upload Document"}
                    <input
                      hidden
                      type="file"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void uploadFile(file);
                        }
                      }}
                    />
                  </Button>

                  <FormControl fullWidth>
                    <InputLabel id="doc-label">Document</InputLabel>
                    <Select
                      labelId="doc-label"
                      label="Document"
                      value={selectedDocument}
                      onChange={(event) => setSelectedDocument(event.target.value)}
                    >
                      {documents.map((doc) => (
                        <MenuItem key={doc.id} value={doc.id}>
                          {doc.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl fullWidth>
                    <InputLabel id="session-label">Session</InputLabel>
                    <Select
                      labelId="session-label"
                      label="Session"
                      value={selectedSession}
                      onChange={(event) => setSelectedSession(event.target.value)}
                    >
                      {sessions.map((session) => (
                        <MenuItem key={session.id} value={session.id}>
                          {session.title}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl fullWidth>
                    <InputLabel id="model-label">Ollama Model</InputLabel>
                    <Select
                      labelId="model-label"
                      label="Ollama Model"
                      value={selectedModel}
                      onChange={(event) => setSelectedModel(event.target.value)}
                    >
                      {models.map((model) => (
                        <MenuItem key={model} value={model}>
                          {model}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <ToggleButtonGroup
                    value={contextMode}
                    exclusive
                    fullWidth
                    onChange={(_event, value) => {
                      if (value) {
                        setContextMode(value);
                      }
                    }}
                  >
                    <ToggleButton value="semantic">Semantic</ToggleButton>
                    <ToggleButton value="range">Range</ToggleButton>
                    <ToggleButton value="full">Full</ToggleButton>
                  </ToggleButtonGroup>

                  {contextMode === "semantic" && (
                    <Box>
                      <Typography gutterBottom>Top Chunks: {topK}</Typography>
                      <Slider value={topK} min={1} max={80} onChange={(_e, v) => setTopK(v as number)} />
                    </Box>
                  )}

                  {contextMode === "range" && (
                    <Stack spacing={1}>
                      <Typography gutterBottom>Chunk Range</Typography>
                      <Slider
                        value={[fromChunk, toChunk]}
                        min={0}
                        max={500}
                        onChange={(_e, value) => {
                          const [start, end] = value as number[];
                          setFromChunk(start);
                          setToChunk(end);
                        }}
                        valueLabelDisplay="auto"
                      />
                    </Stack>
                  )}

                  <Box>
                    <Typography gutterBottom>Max Context Characters: {maxChars.toLocaleString()}</Typography>
                    <Slider
                      value={maxChars}
                      min={2000}
                      max={1000000}
                      step={2000}
                      onChange={(_e, value) => setMaxChars(value as number)}
                      valueLabelDisplay="auto"
                    />
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 8 }}>
            <Card sx={{ minHeight: 640 }}>
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
                  <Typography variant="h6">Conversation</Typography>
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      startIcon={<DescriptionIcon />}
                      onClick={() => downloadTextFile("chat.txt", chatExportLines.join("\n\n"))}
                    >
                      Export TXT
                    </Button>
                    <Button
                      size="small"
                      startIcon={<DescriptionIcon />}
                      onClick={() => void downloadDocx("chat.docx", chatExportLines)}
                    >
                      Export DOCX
                    </Button>
                    <Button
                      size="small"
                      startIcon={<PictureAsPdfIcon />}
                      onClick={() => downloadPdf("chat.pdf", chatExportLines)}
                    >
                      Export PDF
                    </Button>
                  </Stack>
                </Stack>

                <Stack spacing={1.5} className="chat-window">
                  {messages.map((message) => (
                    <Box key={message.id} className={`message ${message.role}`}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Chip size="small" label={message.role === "user" ? "User" : "Assistant"} />
                        {message.role === "assistant" && (
                          <IconButton
                            size="small"
                            onClick={() => navigator.clipboard.writeText(message.content)}
                            title="Copy answer"
                          >
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Stack>
                      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mt: 1 }}>
                        {message.content}
                      </Typography>
                    </Box>
                  ))}
                </Stack>

                <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                  <TextField
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    fullWidth
                    label="Ask your document"
                    multiline
                    minRows={2}
                    maxRows={5}
                    disabled={isSending}
                  />
                  <Button
                    variant="contained"
                    onClick={() => void sendQuestion()}
                    disabled={isSending || !selectedDocument || !selectedModel}
                  >
                    {isSending ? <CircularProgress size={18} color="inherit" /> : "Send"}
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
        )}
      </Box>
    </Box>
  );
}
