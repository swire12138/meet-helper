import { WebSocketServer } from "ws";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

export function setupAsrSocket(server) {
  const wss = new WebSocketServer({ server, path: "/ws/asr" });
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const bridgeScript = path.join(__dirname, "asr_bridge.py");

  wss.on("connection", (ws, req) => {
    console.log("Client connected to ASR WebSocket");

    let sessionId = "default-session";
    if (req && req.url) {
      try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        sessionId = url.searchParams.get("sessionId") || "default-session";
      } catch(e) {}
    }

    const apiKey = process.env.QWEN_API_KEY;

    if (!apiKey) {
      ws.send(JSON.stringify({ type: "error", message: "Missing QWEN_API_KEY in .env" }));
      ws.close();
      return;
    }

    const baseDir = path.resolve(process.cwd(), "..", "screen-catch", "data", sessionId);
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    const transcriptFile = path.join(baseDir, "transcript.txt");
    fs.writeFileSync(transcriptFile, "", "utf8");
    console.log("ASR transcript target:", transcriptFile);

    let asrProcess = null;
    let sentenceWritten = false;
    let latestPartialText = "";
    let fallbackFlushed = false;
    const speakerMap = new Map();
    let nextSpeakerNumber = 1;

    const mapSpeakerLabel = (rawSpeakerId) => {
      if (rawSpeakerId === undefined || rawSpeakerId === null || rawSpeakerId === "") {
        return "未知发言人";
      }
      const raw = String(rawSpeakerId);
      if (!speakerMap.has(raw)) {
        speakerMap.set(raw, nextSpeakerNumber);
        nextSpeakerNumber += 1;
      }
      return `发言人${speakerMap.get(raw)}`;
    };
    const sanitizeText = (text) => {
      if (typeof text !== "string") return "";
      const cleaned = text
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .replace(/[^A-Za-z0-9\u4e00-\u9fff\s.,!?;:'"()\-，。！？；：、（）]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!/[A-Za-z0-9\u4e00-\u9fff]/.test(cleaned)) return "";
      return cleaned.length > 2000 ? cleaned.slice(0, 2000) : cleaned;
    };

    const flushFallbackText = () => {
      if (fallbackFlushed) return;
      if (sentenceWritten) return;
      const text = sanitizeText(latestPartialText || "");
      if (!text) return;
      fallbackFlushed = true;
      const speakerLabel = "未知发言人";
      const lineText = `[${speakerLabel}] ${text}\n`;
      try {
        fs.appendFileSync(transcriptFile, lineText, "utf8");
        console.log("ASR fallback transcript bytes:", Buffer.byteLength(lineText, "utf8"));
        ws.send(JSON.stringify({ type: "sentence", text, speakerId: speakerLabel }));
      } catch (err) {
        console.error("Error writing fallback transcript file:", err);
      }
    };

    try {
      asrProcess = spawn("python", ["-u", bridgeScript], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          QWEN_API_KEY: apiKey,
          ASR_MODEL: "paraformer-realtime-v2",
          ASR_FORMAT: "pcm",
          ASR_SAMPLE_RATE: "16000",
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8"
        }
      });

      asrProcess.stdin.on("error", (err) => {
        if (err.code === "EPIPE" || err.code === "EOF") {
          // Ignore EPIPE/EOF errors when python process closes its stdin
        } else {
          console.error("ASR process stdin error:", err);
        }
      });

      const outputReader = readline.createInterface({ input: asrProcess.stdout });
      outputReader.on("line", (line) => {
        if (!line) return;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        const type = msg?.type;
        if (type === "ready") {
          ws.send(JSON.stringify({ type: "ready" }));
          console.log("Python ASR ready");
          return;
        }
        if (type === "partial") {
          const text = sanitizeText(msg.text || "");
          if (text) {
            latestPartialText = text;
          }
          ws.send(JSON.stringify({
            type: "partial",
            text,
            time: msg.time || 0
          }));
          return;
        }
        if (type === "sentence") {
          sentenceWritten = true;
          const text = sanitizeText(msg.text || "");
          const speakerLabel = mapSpeakerLabel(msg.speakerId);
          const lineText = `[${speakerLabel}] ${text}\n`;
          try {
            fs.appendFileSync(transcriptFile, lineText, "utf8");
            console.log("ASR sentence transcript bytes:", Buffer.byteLength(lineText, "utf8"));
          } catch (err) {
            console.error("Error writing transcript file:", err);
          }
          ws.send(JSON.stringify({
            type: "sentence",
            text,
            speakerId: speakerLabel
          }));
          return;
        }
        if (type === "completed") {
          flushFallbackText();
          ws.send(JSON.stringify({ type: "completed", file: transcriptFile }));
          return;
        }
        if (type === "error") {
          const message = msg.message || "ASR bridge error";
          console.error("Python ASR error:", message);
          ws.send(JSON.stringify({ type: "error", message }));
        };
      });

      asrProcess.stderr.on("data", (chunk) => {
        const message = chunk.toString().trim();
        if (message) {
          console.error("Python ASR stderr:", message);
        }
      });

      asrProcess.on("close", (code) => {
        flushFallbackText();
        console.log("Python ASR process closed:", code);
        if (code !== 0 && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "error", message: "ASR bridge process exited unexpectedly" }));
        }
      });

    } catch (e) {
      console.error("ASR Init Error:", e);
      ws.send(JSON.stringify({ type: "error", message: "ASR Init Error" }));
    }

    let audioPacketCount = 0;
    ws.on("message", (message, isBinary) => {
      if (asrProcess && asrProcess.stdin && !asrProcess.stdin.destroyed) {
        try {
          if (!isBinary) {
            return;
          }
          const audioBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message);
          audioPacketCount += 1;
          if (audioPacketCount <= 5) {
            let sum = 0;
            for (let i = 0; i + 1 < audioBuffer.length; i += 2) {
              const sample = audioBuffer.readInt16LE(i);
              sum += Math.abs(sample);
            }
            const avgAbs = audioBuffer.length > 1 ? Math.round(sum / (audioBuffer.length / 2)) : 0;
            console.log(`ASR audio packet #${audioPacketCount}, bytes=${audioBuffer.length}, avgAbs=${avgAbs}`);
          }
          asrProcess.stdin.write(audioBuffer);
        } catch (e) {
          console.error("Failed to write to ASR process stdin:", e);
        }
      }
    });

    ws.on("close", () => {
      console.log("Client disconnected from ASR WebSocket");
      if (asrProcess && asrProcess.stdin && !asrProcess.stdin.destroyed) {
        asrProcess.stdin.end();
      }
      flushFallbackText();
      if (asrProcess && !asrProcess.killed) {
        setTimeout(() => {
          if (!asrProcess.killed) {
            asrProcess.kill("SIGTERM");
          }
        }, 1500);
      }
    });
  });
}
