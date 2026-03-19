import cors from "cors";
import express from "express";
import multer from "multer";
import path from "node:path";
import { loadEnv } from "./env.js";
import { analyzeTranscript, analyzeTranscriptStream } from "./analyze.js";
import { getQwenConfig } from "./qwenClient.js";

loadEnv();

const app = express();
app.use(cors());

const staticDir = path.resolve(process.cwd(), "..", "web-static");
app.use(express.static(staticDir));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.get("/api/health", (req, res) => {
  const { model, enableThinking, maxTokens } = getQwenConfig();
  res.json({ ok: true, model, enableThinking, maxTokens });
});

app.post("/api/analyze", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, error: "missing_file" });

    const transcriptText = file.buffer.toString("utf-8").trim();
    if (!transcriptText) return res.status(400).json({ ok: false, error: "empty_file" });

    const result = await analyzeTranscript(transcriptText);
    if (!result.ok) return res.status(500).json({ ok: false, error: result.error });

    res.json({ ok: true, data: result.value });
  } catch (e) {
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.post("/api/analyze-stream", upload.single("file"), async (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const file = req.file;
    if (!file) {
      res.status(400);
      res.write(`${JSON.stringify({ type: "error", message: "missing_file" })}\n`);
      return res.end();
    }

    const transcriptText = file.buffer.toString("utf-8").trim();
    if (!transcriptText) {
      res.status(400);
      res.write(`${JSON.stringify({ type: "error", message: "empty_file" })}\n`);
      return res.end();
    }

    await analyzeTranscriptStream(transcriptText, res);
    res.end();
  } catch {
    res.status(500);
    res.write(`${JSON.stringify({ type: "error", message: "server_error" })}\n`);
    res.end();
  }
});

const port = Number(process.env.PORT ?? "8787");
app.listen(port, () => {
  process.stdout.write(`server listening on http://localhost:${port}\n`);
});
