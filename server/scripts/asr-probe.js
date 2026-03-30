import dotenv from "dotenv";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";

dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });

function makeSinePcm({ seconds = 3, sampleRate = 16000, freq = 440, amplitude = 0.25 }) {
  const totalSamples = Math.floor(seconds * sampleRate);
  const pcm = new Int16Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const v = Math.sin((2 * Math.PI * freq * i) / sampleRate) * amplitude;
    pcm[i] = Math.max(-1, Math.min(1, v)) * 0x7fff;
  }
  return Buffer.from(pcm.buffer);
}

function splitBuffer(buf, chunkBytes = 3200) {
  const chunks = [];
  for (let i = 0; i < buf.length; i += chunkBytes) {
    chunks.push(buf.subarray(i, Math.min(i + chunkBytes, buf.length)));
  }
  return chunks;
}

function pcmToWavBuffer(pcmBuffer, sampleRate = 16000, channels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

async function loadSampleWav() {
  const url = "https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/paraformer/hello_world_female2.wav";
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`下载示例音频失败: ${res.status}`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

async function runDirectDashScopeProbe({
  endpoint,
  model,
  format = "pcm",
  sampleRate = 16000,
  audioBuffer
}) {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 QWEN_API_KEY");
  }

  const ws = new WebSocket(endpoint, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  const taskId = uuidv4().replace(/-/g, "");
  const chunks = splitBuffer(audioBuffer, 3200);

  return await new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {}
      resolve(result);
    };

    ws.on("open", () => {
      const startMessage = {
        header: {
          message_id: uuidv4().replace(/-/g, ""),
          task_id: taskId,
          namespace: "SpeechTranscription",
          name: "StartTranscription",
          action: "run-task",
          appkey: ""
        },
        payload: {
          task_group: "audio",
          task: "asr",
          function: "recognition",
          model,
          format,
          sample_rate: sampleRate,
          input: {}
        }
      };
      ws.send(JSON.stringify(startMessage));
    });

    ws.on("message", async (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      const eventName = msg?.header?.event || msg?.header?.name || "unknown";
      console.log("[direct]", eventName, JSON.stringify(msg));

      if (eventName === "task-started") {
        for (const c of chunks) {
          ws.send(c, { binary: true });
          await sleep(100);
        }
        await sleep(300);
        const stopMessage = {
          header: {
            message_id: uuidv4().replace(/-/g, ""),
            task_id: taskId,
            namespace: "SpeechTranscription",
            name: "StopTranscription"
          }
        };
        ws.send(JSON.stringify(stopMessage));
      } else if (eventName === "task-failed" || eventName === "TaskFailed") {
        finish({ ok: false, event: eventName, detail: msg });
      } else if (eventName === "task-finished" || eventName === "TranscriptionCompleted") {
        finish({ ok: true, event: eventName, detail: msg });
      }
    });

    ws.on("close", (code, reason) => {
      if (!done) finish({ ok: false, event: "closed", code, reason: reason?.toString?.() });
    });

    ws.on("error", (err) => {
      if (!done) finish({ ok: false, event: "error", error: String(err?.message || err) });
    });
  });
}

const pcm16 = makeSinePcm({ seconds: 3, sampleRate: 16000, freq: 520, amplitude: 0.35 });
const wav16 = pcmToWavBuffer(pcm16, 16000, 1, 16);
const pcm8 = makeSinePcm({ seconds: 3, sampleRate: 8000, freq: 520, amplitude: 0.35 });
const wav8 = pcmToWavBuffer(pcm8, 8000, 1, 16);
const sampleWav = await loadSampleWav();

const endpoints = [
  "wss://dashscope.aliyuncs.com/api-ws/v1/inference/",
  "wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference/"
];

const cases = [
  { model: "paraformer-realtime-v2", format: "pcm", sampleRate: 16000, audioBuffer: pcm16 },
  { model: "paraformer-realtime-v2", format: "wav", sampleRate: 16000, audioBuffer: wav16 },
  { model: "paraformer-realtime-v2", format: "wav", sampleRate: 16000, audioBuffer: sampleWav, tag: "official-sample-wav" },
  { model: "paraformer-realtime-v1", format: "pcm", sampleRate: 16000, audioBuffer: pcm16 },
  { model: "paraformer-realtime-8k-v2", format: "pcm", sampleRate: 8000, audioBuffer: pcm8 },
  { model: "paraformer-realtime-8k-v2", format: "wav", sampleRate: 8000, audioBuffer: wav8 }
];

const results = [];
for (const endpoint of endpoints) {
  for (const c of cases) {
    console.log(`\n=== PROBE endpoint=${endpoint} model=${c.model} format=${c.format} sampleRate=${c.sampleRate} ===`);
    const r = await runDirectDashScopeProbe({
      endpoint,
      model: c.model,
      format: c.format,
      sampleRate: c.sampleRate,
      audioBuffer: c.audioBuffer
    });
    const out = {
      endpoint,
      model: c.model,
      format: c.format,
      sampleRate: c.sampleRate,
      tag: c.tag || "generated",
      bytes: c.audioBuffer.length,
      ok: r.ok,
      event: r.event,
      detail: r.detail?.header || r
    };
    results.push(out);
    console.log("ASR_PROBE_RESULT", JSON.stringify(out));
  }
}

const hasSuccess = results.some((r) => r.ok);
console.log("\nASR_PROBE_SUMMARY", JSON.stringify(results, null, 2));
if (!hasSuccess) process.exit(1);
