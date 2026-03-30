import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setupAsrSocket } from "./asr.js";

export function setupScreenCatchRoutes(app, server) {
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

  app.post("/api/asr/finalize", (req, res) => {
    try {
      const { sessionId, audioWavBase64 } = req.body || {};
      if (!sessionId || !audioWavBase64) {
        return res.status(400).json({ ok: false, error: "missing_session_or_audio" });
      }

      const baseDir = path.resolve(process.cwd(), "..", "screen-catch", "data", sessionId);
      if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
      }
      const wavPath = path.join(baseDir, "full-audio.wav");
      const transcriptFile = path.join(baseDir, "transcript.txt");
      fs.writeFileSync(wavPath, Buffer.from(audioWavBase64, "base64"));

      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const finalizeScript = path.join(__dirname, "asr_finalize.py");

      const proc = spawn("python", ["-u", finalizeScript, wavPath], {
        env: {
          ...process.env,
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8"
        },
        stdio: ["ignore", "pipe", "pipe"]
      });

      let out = "";
      let err = "";
      proc.stdout.on("data", (c) => {
        out += c.toString();
      });
      proc.stderr.on("data", (c) => {
        err += c.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          return res.status(500).json({ ok: false, error: "finalize_failed", detail: err.trim() || out.trim() });
        }
        let parsed;
        try {
          parsed = JSON.parse(out);
        } catch {
          return res.status(500).json({ ok: false, error: "invalid_finalize_output" });
        }
        const speakerMap = new Map();
        let nextSpeakerNo = 1;
        const mapSpeakerLabel = (rawSpeakerId) => {
          if (rawSpeakerId === undefined || rawSpeakerId === null || rawSpeakerId === "") {
            return "未知发言人";
          }
          const raw = String(rawSpeakerId);
          if (!speakerMap.has(raw)) {
            speakerMap.set(raw, nextSpeakerNo);
            nextSpeakerNo += 1;
          }
          return `发言人${speakerMap.get(raw)}`;
        };
        const sentences = Array.isArray(parsed?.sentences) ? parsed.sentences : [];
        const lines = sentences
          .map((s) => {
            const text = typeof s?.text === "string" ? s.text.trim() : "";
            if (!text) return "";
            const label = mapSpeakerLabel(s?.speakerId);
            return `[${label}] ${text}`;
          })
          .filter(Boolean);
        fs.writeFileSync(transcriptFile, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
        res.json({ ok: true, lines, speakerCount: speakerMap.size, wavFile: path.basename(wavPath) });
      });
    } catch (e) {
      console.error("ASR finalize error:", e);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  setupAsrSocket(server);
}
