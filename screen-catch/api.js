import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setupAsrSocket } from "./asr.js";

export function setupScreenCatchRoutes(app, server) {
  const dataRootDir = path.resolve(process.cwd(), "..", "screen-catch", "data");
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const finalizeScript = path.join(__dirname, "asr_finalize.py");

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ensureWithinDataRoot = (targetPath) => {
    const resolved = path.resolve(dataRootDir, targetPath);
    return resolved.startsWith(dataRootDir) ? resolved : null;
  };
  const formatSpeakerLabel = (rawSpeakerId, speakerMap) => {
    if (rawSpeakerId === undefined || rawSpeakerId === null || rawSpeakerId === "") {
      return "未知发言人";
    }
    const raw = String(rawSpeakerId);
    if (!speakerMap.has(raw)) {
      speakerMap.set(raw, speakerMap.size + 1);
    }
    return `发言人${speakerMap.get(raw)}`;
  };
  const formatTime = (ms = 0) => {
    const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  };

  app.post("/api/screenshot", (req, res) => {
    try {
      const { image, sessionId } = req.body;
      if (!image) return res.status(400).json({ ok: false, error: "missing_image" });
      
      const sessionDirName = sessionId || "default-session";
      const baseDir = path.resolve(process.cwd(), "..", "screen-catch", "data", sessionDirName);
      const picsDir = path.join(baseDir, "pics");
      
      if (!fs.existsSync(picsDir)) {
        fs.mkdirSync(picsDir, { recursive: true });
      }

      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `screenshot-${timestamp}.png`;
      const filepath = path.join(picsDir, filename);
      
      fs.writeFileSync(filepath, buffer);
      res.json({ ok: true, filename });
    } catch (e) {
      console.error("Screenshot save error:", e);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  app.get("/api/asr/files/*", (req, res) => {
    try {
      const relativePath = req.params[0];
      const filePath = ensureWithinDataRoot(relativePath || "");
      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ ok: false, error: "file_not_found" });
      }
      res.sendFile(filePath);
    } catch (e) {
      console.error("ASR file serve error:", e);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  app.post("/api/asr/finalize", async (req, res) => {
    try {
      const { sessionId, audioUrl } = req.body || {};
      if (!sessionId && !audioUrl) {
        return res.status(400).json({ ok: false, error: "missing_sessionId_or_audioUrl" });
      }

      let audioSource = audioUrl || "";
      let transcriptFile = "";
      if (sessionId) {
        const sessionDir = ensureWithinDataRoot(sessionId);
        if (!sessionDir) {
          return res.status(400).json({ ok: false, error: "invalid_sessionId" });
        }
        const wavAudioFile = path.join(sessionDir, "full-audio.wav");
        transcriptFile = path.join(sessionDir, "transcript.txt");
        for (let i = 0; i < 20 && !fs.existsSync(wavAudioFile); i += 1) {
          await wait(500);
        }
        if (!fs.existsSync(wavAudioFile)) {
          return res.status(404).json({ ok: false, error: "full_audio_not_found" });
        }
        if (!audioSource) {
          const publicBase = (process.env.ASR_AUDIO_PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
          if (!publicBase) {
            return res.status(400).json({
              ok: false,
              error: "missing_ASR_AUDIO_PUBLIC_BASE_URL",
              message: "请配置可公网访问当前服务的 ASR_AUDIO_PUBLIC_BASE_URL，供百炼拉取 full-audio.wav"
            });
          }
          audioSource = `${publicBase}/api/asr/files/${encodeURIComponent(sessionId)}/full-audio.wav`;
        }
      }

      const pythonArgs = [finalizeScript, audioSource];
      const finalizeResult = await new Promise((resolve, reject) => {
        const child = spawn("python", pythonArgs, {
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            PYTHONUTF8: "1",
            PYTHONIOENCODING: "utf-8"
          }
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => {
          try {
            const parsed = stdout.trim() ? JSON.parse(stdout.trim()) : null;
            resolve({ code, parsed, stderr: stderr.trim(), stdout: stdout.trim() });
          } catch (err) {
            reject(new Error(`finalize_json_parse_failed: ${stdout || stderr}`));
          }
        });
      });

      const { code, parsed, stderr } = finalizeResult;
      if (code !== 0 || !parsed?.ok) {
        return res.status(500).json({
          ok: false,
          error: parsed?.error || "finalize_failed",
          message: parsed?.message || stderr || "离线说话人分离失败",
          model: parsed?.model,
          audioUrl: parsed?.audioUrl || audioSource
        });
      }

      const speakerMap = new Map();
      const transcriptEntries = (parsed.sentences || []).map((sentence) => {
        const speaker = formatSpeakerLabel(sentence.speakerId, speakerMap);
        return {
          speaker,
          text: sentence.text || "",
          beginTime: Number(sentence.beginTime || 0),
          endTime: Number(sentence.endTime || 0)
        };
      }).filter((entry) => entry.text);

      if (transcriptFile) {
        const transcriptText = transcriptEntries.map((entry) => `[${entry.speaker}] ${entry.text}`).join("\n");
        fs.writeFileSync(transcriptFile, transcriptText ? `${transcriptText}\n` : "", "utf8");
      }

      res.json({
        ok: true,
        data: {
          model: parsed.model,
          audioUrl: parsed.audioUrl || audioSource,
          transcriptionUrl: parsed.transcriptionUrl || "",
          lines: transcriptEntries.map((entry) => `[${formatTime(entry.beginTime)}] [${entry.speaker}] ${entry.text}`),
          sentences: transcriptEntries
        }
      });
    } catch (e) {
      console.error("ASR finalize error:", e);
      res.status(500).json({ ok: false, error: "server_error", message: e.message || "unknown_error" });
    }
  });

  setupAsrSocket(server);
}
