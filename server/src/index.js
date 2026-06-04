import cors from "cors";
import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { loadEnv } from "./env.js";
import { analyzeTranscript, analyzeTranscriptStream, analyzeCaseContent } from "./analyze.js";
import { createQwenClient, getQwenConfig } from "./qwenClient.js";
import { setupScreenCatchRoutes } from "../../screen-catch/api.js";
import {
  buildProfileForSpeaker,
  mergeProfileForSpeaker,
  upsertWorkProfileFromAnalysis,
  loadProfileBySpeaker,
  loadProfileBySlug,
  listProfiles,
  updateSpeakerName,
  guessSpeakers,
  extractSpeakersFromTranscript,
  deleteProfile
} from "./profileBuilder.js";
import { buildChatSystemPrompt } from "./profilePrompts.js";

// 配置日志同时输出到文件
const logPath = path.resolve(process.cwd(), "../../screen-catch", "data", "server.log");
const logDir = path.dirname(logPath);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = (...args) => {
  const logLine = `[${new Date().toISOString()}] ${args.map(arg => 
    typeof arg === "object" ? JSON.stringify(arg) : String(arg)
  ).join(" ")}\n`;
  fs.appendFileSync(logPath, logLine, "utf8");
  originalConsoleLog.apply(console, args);
};

console.error = (...args) => {
  const logLine = `[${new Date().toISOString()}] ERROR: ${args.map(arg => 
    typeof arg === "object" ? JSON.stringify(arg) : String(arg)
  ).join(" ")}\n`;
  fs.appendFileSync(logPath, logLine, "utf8");
  originalConsoleError.apply(console, args);
};

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
    const { sessionId, transcriptText, contextTranscriptText, previousAnalysis, lastProcessedFile, isFinal } = req.body;
    if (!sessionId) return res.status(400).json({ ok: false, error: 'missing_sessionId' });

    const baseDir = path.resolve(process.cwd(), "..", "screen-catch", "data", sessionId);
    const picsDir = path.join(baseDir, "pics");

    let files = [];
    if (fs.existsSync(picsDir)) {
      files = await fs.promises.readdir(picsDir);
      files = files.filter(f => f.endsWith('.png')).sort();
    }

    if (lastProcessedFile) {
      const idx = files.indexOf(lastProcessedFile);
      if (idx !== -1) {
        files = files.slice(idx + 1);
      }
    }

    const validImages = [];
    let prevSize = -1;
    let latestProcessedFilename = lastProcessedFile;

    // Optional: Pre-fetch prevSize if we have a lastProcessedFile
    if (lastProcessedFile) {
      try {
        const lastStats = await fs.promises.stat(path.join(picsDir, lastProcessedFile));
        prevSize = lastStats.size;
      } catch (err) {}
    }

    for (const f of files) {
      const picPath = path.join(picsDir, f);
      try {
        const stats = await fs.promises.stat(picPath);
        const currSize = stats.size;
        if (currSize < 1024) continue; // Skip invalid or empty images

        if (prevSize !== -1) {
          const diffRatio = Math.abs(currSize - prevSize) / prevSize;
          if (diffRatio < 0.005) {
            latestProcessedFilename = f; // Even if skipped, update the pointer so we don't scan it again
            continue;
          }
        }
        
        prevSize = currSize;

        let timeStr = "未知时间";
        const match = f.match(/screenshot-(.+)\.png/);
        if (match) {
          timeStr = match[1].replace('T', ' ').replace(/-(\d{2})-(\d{2})-(\d{3}Z)$/, ':$1:$2.$3');
        }
        
        const imageBuffer = await fs.promises.readFile(picPath);
        const imageBase64 = imageBuffer.toString('base64');
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

    const newTranscript = transcriptText || '';
    const fullTranscript = [contextTranscriptText, newTranscript].filter(Boolean).join("\n");
    const analysisPromise = analyzeCaseContent(validImages, newTranscript, contextTranscriptText, previousAnalysis);
    let profileUpdates = [];
    let profiles = listProfiles();
    let profileSync = { attempted: false, updated: false, skippedReason: "" };

    console.log(`[profile] newTranscript length=${newTranscript.length}, contextLength=${(contextTranscriptText||'').length}, fullLength=${fullTranscript.length}`);
    if (newTranscript.length > 0 && newTranscript.length <= 300) {
      console.log(`[profile] newTranscript: ${newTranscript.slice(0, 200)}`);
    } else if (newTranscript.length > 300) {
      console.log(`[profile] newTranscript first 200 chars: ${newTranscript.slice(0, 200)}`);
    }
    const profilePromise = (async () => {
      if (!newTranscript.trim()) {
        profileSync.skippedReason = "empty_new_transcript";
        return;
      }

      const speakers = extractSpeakersFromTranscript(newTranscript);
      console.log(`[profile] Detected ${speakers.length} speakers: ${speakers.join(", ")}`);
      if (speakers.length === 0) {
        profileSync.skippedReason = "no_detected_speakers";
        return;
      }

      const newLineCount = newTranscript.split("\n").filter(Boolean).length;
      const hasNewProfileTarget = speakers.some((speaker) => !loadProfileBySpeaker(speaker));
      const shouldSyncProfiles = hasNewProfileTarget || isFinal || newLineCount >= 2 || newTranscript.length >= 120;
      if (!shouldSyncProfiles) {
        profileSync.skippedReason = "increment_too_small";
        return;
      }

      profileSync.attempted = true;
      const analysis = await analysisPromise;
      const mergeResults = await Promise.allSettled(
        speakers.map(async (speaker) => {
          console.log(`[profile] Updating work profile for ${speaker} from analysis...`);
          const result = await upsertWorkProfileFromAnalysis(speaker, analysis, newTranscript, validImages.length);
          if (result.ok && result.data) {
            console.log(`[profile] ${speaker} -> ${result.data.name} (merged=${result.merged})`);
            return {
              speakerLabel: speaker,
              slug: result.data.slug,
              name: result.data.name,
              role: result.data.role,
              merged: Boolean(result.merged),
              error: ""
            };
          }
          console.log(`[profile] ${speaker} failed: ${result.error}`);
          return {
            speakerLabel: speaker,
            error: result.error || "unknown_profile_error",
            merged: false
          };
        })
      );

      profileUpdates = mergeResults
        .filter((item) => item.status === "fulfilled")
        .map((item) => item.value);
      profileSync.updated = profileUpdates.some((item) => !item.error);
      profiles = listProfiles();
    })();

    const [analysis] = await Promise.all([analysisPromise, profilePromise]);

    res.json({ 
      ok: true, 
      data: { 
        images: validImages.map(img => img.imageUrl), 
        analysis,
        lastProcessedFile: latestProcessedFilename,
        profileUpdates,
        profiles,
        profileSync
      } 
    });
  } catch (e) {
    console.error("====== 案例分析捕获到全局错误 ======");
    console.error(e);
    console.error("====================================");
    res.status(500).json({ ok: false, error: 'server_error', message: e.message || 'unknown_error' });
  }
});

app.get("/api/profiles", (req, res) => {
  try {
    const profiles = listProfiles();
    res.json({ ok: true, data: profiles });
  } catch (e) {
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.get("/api/profiles/:slug", (req, res) => {
  try {
    const profile = loadProfileBySlug(req.params.slug);
    if (!profile) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, data: profile });
  } catch (e) {
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.delete("/api/profiles/:slug", (req, res) => {
  try {
    const result = deleteProfile(req.params.slug);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.post("/api/profiles/name", async (req, res) => {
  try {
    const { speakerLabel, realName } = req.body;
    if (!speakerLabel || !realName) {
      return res.status(400).json({ ok: false, error: "missing_speakerLabel_or_realName" });
    }
    const result = updateSpeakerName(speakerLabel, realName);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.post("/api/profiles/guess-speakers", async (req, res) => {
  try {
    const { transcriptText, knownNames } = req.body;
    if (!transcriptText) {
      return res.status(400).json({ ok: false, error: "missing_transcriptText" });
    }
    const result = await guessSpeakers(transcriptText, knownNames);
    if (!result.ok) return res.status(500).json({ ok: false, error: result.error });
    res.json({ ok: true, data: result.data });
  } catch (e) {
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.post("/api/profiles/build", async (req, res) => {
  try {
    const { speakerLabel, transcriptText, screenshotCount } = req.body;
    if (!speakerLabel) {
      return res.status(400).json({ ok: false, error: "missing_speakerLabel" });
    }
    const result = await buildProfileForSpeaker(speakerLabel, transcriptText || "", screenshotCount || 0);
    if (!result.ok) return res.status(500).json({ ok: false, error: result.error });
    res.json({ ok: true, data: result.data });
  } catch (e) {
    console.error("Profile build error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.post("/api/profiles/merge", async (req, res) => {
  try {
    const { speakerLabel, transcriptText, screenshotCount } = req.body;
    if (!speakerLabel) {
      return res.status(400).json({ ok: false, error: "missing_speakerLabel" });
    }
    const result = await mergeProfileForSpeaker(speakerLabel, transcriptText || "", screenshotCount || 0);
    if (!result.ok) return res.status(500).json({ ok: false, error: result.error });
    res.json({ ok: true, data: result.data, merged: result.merged || false });
  } catch (e) {
    console.error("Profile merge error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.post("/api/profiles/extract-speakers", (req, res) => {
  try {
    const { transcriptText } = req.body;
    if (!transcriptText) {
      return res.status(400).json({ ok: false, error: "missing_transcriptText" });
    }
    const speakers = extractSpeakersFromTranscript(transcriptText);
    res.json({ ok: true, data: speakers });
  } catch (e) {
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.post("/api/chat", async (req, res) => {
  const t0 = Date.now();
  console.log("[Chat] 请求开始");

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    const { slug, messages } = req.body;
    const t1 = Date.now();
    console.log(`[Chat] 解析请求完成: ${t1 - t0}ms`);

    if (!slug) {
      res.write(JSON.stringify({ ok: false, error: "missing_slug" }) + "\n");
      return res.end();
    }
    if (!messages || !Array.isArray(messages)) {
      res.write(JSON.stringify({ ok: false, error: "missing_messages" }) + "\n");
      return res.end();
    }

    const profile = loadProfileBySlug(slug);
    const t2 = Date.now();
    console.log(`[Chat] 加载画像完成: ${t2 - t1}ms`);

    if (!profile) {
      res.write(JSON.stringify({ ok: false, error: "profile_not_found" }) + "\n");
      return res.end();
    }

    // 恢复同事模拟功能，但保持简洁
    const personaContent = profile.personaMd || "";
    const workContent = profile.workMd || "";
    const systemPrompt = [
      `你是 ${profile.name} 的数字孪生 Agent。`,
      profile.role ? `职位/角色: ${profile.role}` : "",
      personaContent ? `性格与行为模式: ${personaContent}` : "",
      workContent ? `工作能力与方法: ${workContent}` : "",
      `请严格按照上述画像进行对话，保持自然。`
    ].filter(Boolean).join("\n");

    const t3 = Date.now();
    console.log(`[Chat] 构建提示词完成: ${t3 - t2}ms`);

    const qwenClient = createQwenClient();
    const { model, maxTokens } = getQwenConfig();

    console.log(`[Chat] 开始调用大模型 (${model})...`);
    const stream = await qwenClient.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ],
      max_tokens: maxTokens,
      stream: true,
      temperature: 0.2,
      extra_body: { enable_thinking: false }
    });

    const t4 = Date.now();
    console.log(`[Chat] 拿到 stream: ${t4 - t3}ms`);

    let firstChunk = true;
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        if (firstChunk) {
          console.log(`[Chat] 首块到达: ${Date.now() - t4}ms`);
          firstChunk = false;
        }
        res.write(JSON.stringify({ ok: true, delta }) + "\n");
      }
    }

    console.log(`[Chat] 全部完成: ${Date.now() - t0}ms`);
    res.end();
  } catch (e) {
    console.error("Chat error:", e);
    res.write(JSON.stringify({ ok: false, error: "server_error", message: e.message }) + "\n");
    res.end();
  }
});

const port = Number(process.env.PORT ?? "8787");
server.listen(port, () => {
  process.stdout.write(`server listening on http://localhost:${port}\n`);
});
