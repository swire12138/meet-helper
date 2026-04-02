import cors from "cors";
import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { loadEnv } from "./env.js";
import { analyzeTranscript, analyzeTranscriptStream, analyzeCaseContent } from "./analyze.js";
import { getQwenConfig } from "./qwenClient.js";
import { setupScreenCatchRoutes } from "../../screen-catch/api.js";

loadEnv();

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: "50mb" }));

setupScreenCatchRoutes(app, server);

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
      res.write(JSON.stringify({ ok: false, error: "missing_file" }) + "\n");
      return res.end();
    }
    const transcriptText = file.buffer.toString("utf-8").trim();
    if (!transcriptText) {
      res.write(JSON.stringify({ ok: false, error: "empty_file" }) + "\n");
      return res.end();
    }
    await analyzeTranscriptStream(transcriptText, res);
  } catch (e) {
    res.write(JSON.stringify({ ok: false, error: "server_error" }) + "\n");
    res.end();
  }
});

app.post('/api/analyze-case', async (req, res) => {
  try {
    const { sessionId, transcriptText, previousAnalysis, lastProcessedFile, isFinal } = req.body;
    if (!sessionId) return res.status(400).json({ ok: false, error: 'missing_sessionId' });

    const baseDir = path.resolve(process.cwd(), "..", "screen-catch", "data", sessionId);
    const picsDir = path.join(baseDir, "pics");

    if (!fs.existsSync(picsDir)) {
      return res.status(400).json({ ok: false, error: 'pics_dir_not_found' });
    }

    const files = fs.readdirSync(picsDir).filter(f => f.endsWith('.png')).sort();
    if (files.length === 0) {
      return res.status(400).json({ ok: false, error: 'not_enough_screenshots' });
    }

    const validImages = [];
    let prevSize = -1;
    let lastFileFound = !lastProcessedFile;
    let latestProcessedFilename = lastProcessedFile;

    for (const f of files) {
      const picPath = path.join(picsDir, f);
      try {
        const stats = fs.statSync(picPath);
        const currSize = stats.size;
        if (currSize < 1024) continue; // Skip invalid or empty images

        if (prevSize !== -1) {
          const diffRatio = Math.abs(currSize - prevSize) / prevSize;
          if (diffRatio < 0.005) {
            continue;
          }
        }
        
        prevSize = currSize;

        if (!lastFileFound) {
          if (f === lastProcessedFile) {
            lastFileFound = true;
          }
          continue;
        }

        let timeStr = "未知时间";
        const match = f.match(/screenshot-(.+)\.png/);
        if (match) {
          timeStr = match[1].replace('T', ' ').replace(/-(\d{2})-(\d{2})-(\d{3}Z)$/, ':$1:$2.$3');
        }
        
        const imageBase64 = fs.readFileSync(picPath).toString('base64');
        const imageUrl = `data:image/png;base64,${imageBase64}`;
        
        validImages.push({ time: timeStr, imageUrl });
        latestProcessedFilename = f;
      } catch (err) {
        console.error("Error processing image:", picPath, err);
      }
    }

    if (validImages.length === 0 && !transcriptText?.trim()) {
      return res.status(400).json({ ok: false, error: 'no_new_content' });
    }

    const analysis = await analyzeCaseContent(validImages, transcriptText || '', previousAnalysis);

    res.json({ 
      ok: true, 
      data: { 
        images: validImages.map(img => img.imageUrl), 
        analysis,
        lastProcessedFile: latestProcessedFilename
      } 
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

const port = Number(process.env.PORT ?? "8787");
server.listen(port, () => {
  process.stdout.write(`server listening on http://localhost:${port}\n`);
});
