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
  createManualProfile,
  mergeProfileForSpeaker,
  upsertWorkProfileFromAnalysis,
  loadProfileBySlug,
  listProfiles,
  updateProfileNameBySlug,
  updateSpeakerName,
  guessSpeakers,
  extractSpeakersFromTranscript,
  deleteProfile
} from "./profileBuilder.js";
import {
  allocateChatUserId,
  ensureChatUser,
  getChatUser,
  saveConversationState,
  loadConversationState,
  listChatUsers,
  getChatUserDetail,
  isValidChatUserId
} from "./chatStore.js";
import { getOrBuildUserProfile, loadStoredUserProfile } from "./userProfile.js";
import { buildChatSystemPrompt } from "./profilePrompts.js";
import { extractLikelyJsonObject, safeJsonParse } from "./json.js";

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

function normalizeChatMessages(messages = []) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .map((item) => ({ role: item.role, content: item.content }));
}

function normalizeConversationMessages(messages = []) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((item) => item && typeof item.content === "string")
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      role: item.role === "user" || item.role === "spectator" ? item.role : "assistant",
      content: item.content,
      label: typeof item.label === "string" ? item.label : ""
    }));
}

function formatChatHistory(messages = []) {
  if (!messages.length) return "（暂无对话历史）";
  return messages
    .map((item) => `${item.role === "user" ? "用户" : "模拟同事"}：${item.content}`)
    .join("\n\n");
}

function formatAutopilotTranscript(items = []) {
  if (!Array.isArray(items) || items.length === 0) return "（暂无自动讨论记录）";
  return items
    .filter((item) => item && typeof item.content === "string")
    .map((item) => `${item.speaker === "spectator" ? "旁观者" : "模拟同事"}：${item.content}`)
    .join("\n\n");
}

function parseJsonContent(raw) {
  if (!raw || typeof raw !== "string") return { ok: false, error: "empty_content" };
  const extracted = extractLikelyJsonObject(raw) ?? raw;
  const parsed = safeJsonParse(extracted);
  if (parsed.ok) return parsed;
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  return safeJsonParse(extractLikelyJsonObject(cleaned) ?? cleaned);
}

async function completeJsonObject(messages, { temperature = 0.2, maxTokens } = {}) {
  const qwenClient = createQwenClient();
  const { model, maxTokens: defaultMaxTokens } = getQwenConfig();
  const resp = await qwenClient.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens || Math.min(defaultMaxTokens, 2048),
    response_format: { type: "json_object" },
    extra_body: { enable_thinking: false }
  });
  return resp.choices?.[0]?.message?.content ?? "";
}

async function streamCompletionAsText(res, messages, { temperature = 0.2, maxTokens } = {}) {
  const qwenClient = createQwenClient();
  const { model, maxTokens: defaultMaxTokens } = getQwenConfig();
  const stream = await qwenClient.chat.completions.create({
    model,
    messages,
    max_tokens: maxTokens || defaultMaxTokens,
    stream: true,
    temperature,
    extra_body: { enable_thinking: false }
  });

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      res.write(delta);
    }
  }
}

function buildSpectatorSuggestionMessages({ profile, messages, draftMessage, pendingSuggestions, manual }) {
  const chatSystem = buildChatSystemPrompt(profile);
  const historyText = formatChatHistory(messages);
  const suggestionText = Array.isArray(pendingSuggestions) && pendingSuggestions.length > 0
    ? pendingSuggestions.map((item, idx) => `- ${idx + 1}. ${item.topic || "未命名建议"}：${item.assistantPrompt || item.userAsk || ""}`).join("\n")
    : "（当前没有待处理建议）";
  const draftText = typeof draftMessage === "string" && draftMessage.trim() ? draftMessage.trim() : "（当前输入框为空）";
  const system = [
    "你是一个旁观者智能体（Spectator）。",
    "你的职责不是直接替用户回答，而是在旁边观察“用户与模拟同事”的对话，并在合适时机提出一个高价值建议。",
    "建议必须简洁、具体、可执行，且尽量帮助用户把问题问得更准，或推动当前对话更深入。",
    "如果当前不需要介入，请返回 shouldIntervene=false。",
    "如果 manual=true，除非完全没有上下文，否则尽量给出一条不重复的新建议。",
    "你必须严格输出 JSON，对象字段只能是：shouldIntervene, reasoning, topic, userAsk, assistantPrompt, suggestionType。",
    "assistantPrompt 必须用“用户下一句可以直接发送的话”来写，保持用户口吻。",
    "topic 用一句简短中文概括建议主题。",
    "suggestionType 只能是 correction / supplement / improvement 之一。",
    "",
    "以下是当前模拟同事画像，供你判断对话缺口和下一步推进方向：",
    chatSystem
  ].join("\n");

  const user = [
    `manual=${manual ? "true" : "false"}`,
    "",
    "=== 当前对话 ===",
    historyText,
    "",
    "=== 当前输入框草稿 ===",
    draftText,
    "",
    "=== 已展示但尚未处理的建议 ===",
    suggestionText,
    "",
    "请判断是否应该介入。如果介入，只给一个建议，避免与已展示建议重复。"
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

function buildAutopilotStepMessages({ profile, messages, transcript, nextSpeaker, endRequested, mode, stepIndex }) {
  const chatSystem = buildChatSystemPrompt(profile);
  const historyText = formatChatHistory(messages);
  const transcriptText = formatAutopilotTranscript(transcript);
  if (nextSpeaker === "main") {
    return [
      {
        role: "system",
        content: [
          `你现在扮演同事 ${profile.name}，正在与一个旁观者智能体协作打磨回复。`,
          "你输出的是“这位同事下一轮会对用户说的话”，不是给旁观者的笔记。",
          "保持人物画像一致，保持自然表达。",
          "不要输出总结报告，不要写旁白，不要提及你在执行系统指令。",
          "如果信息不足，用合理假设继续推进，不要反问用户。",
          "",
          chatSystem
        ].join("\n")
      },
      {
        role: "user",
        content: [
          `当前模式：${mode === "deep" ? "深入讨论" : "普通讨论"}`,
          `当前轮次：${stepIndex}`,
          "",
          "=== 用户与模拟同事的主对话 ===",
          historyText,
          "",
          "=== 自动讨论记录 ===",
          transcriptText,
          "",
          "请继续输出该同事下一轮对用户的回复草稿，重点回应旁观者刚才指出的问题，并继续推进对话。"
        ].join("\n")
      }
    ];
  }

  return [
    {
      role: "system",
      content: [
        "你是一个旁观者智能体（Spectator），负责审阅“模拟同事”刚刚的回复草稿。",
        mode === "deep"
          ? "当前为深入讨论模式。你要更严格地指出假设、遗漏、边界条件、风险点和可验证性，并给出下一步推进建议。"
          : "当前为普通讨论模式。你要指出可以补强、修正或延伸的地方，并给出下一步推进建议。",
        "你的输出必须严格遵守以下协议：",
        "第一行：SHOULD_END=true 或 SHOULD_END=false",
        "第二行：CONTENT:",
        "第三行开始：正文（Markdown 可用）",
        "不要输出 JSON，不要输出代码块，不要输出任何额外前缀。",
        "如果 endRequested=true，尽量收敛，并在正文里明确让模拟同事产出最终面向用户的完整回复。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `endRequested=${endRequested ? "true" : "false"}`,
        `当前模式：${mode === "deep" ? "深入讨论" : "普通讨论"}`,
        `当前轮次：${stepIndex}`,
        "",
        "=== 模拟同事画像 ===",
        chatSystem,
        "",
        "=== 用户与模拟同事的主对话 ===",
        historyText,
        "",
        "=== 自动讨论记录 ===",
        transcriptText,
        "",
        "请给出本轮旁观者意见：",
        "1. 细化：当前回复还缺什么",
        "2. 审查：哪里可能不够稳、可能有遗漏或冲突",
        "3. 延伸：补充一个值得顺手提及的方向",
        "4. 下一步：明确要求模拟同事下一轮如何改进",
        "如果你认为讨论已经足够，可以设置 SHOULD_END=true。"
      ].join("\n")
    }
  ];
}

function buildAutopilotReportMessages({ profile, messages, transcript, mode }) {
  return [
    {
      role: "system",
      content: [
        "你是自动讨论总结器。",
        "请基于用户与模拟同事的主对话，以及自动讨论过程，产出一份最终可直接展示给用户的总结报告。",
        "总结报告需要保留该同事的说话风格，但结构要更完整、更利于用户理解。",
        "使用 Markdown 输出，包含：最终建议、关键依据、风险与边界、下一步。",
        mode === "deep" ? "当前来自深入讨论模式，请体现更严格的边界和风险说明。" : ""
      ].filter(Boolean).join("\n")
    },
    {
      role: "user",
      content: [
        `同事：${profile.name}`,
        "",
        "=== 用户与模拟同事的主对话 ===",
        formatChatHistory(messages),
        "",
        "=== 自动讨论记录 ===",
        formatAutopilotTranscript(transcript),
        "",
        "请输出最终总结报告。"
      ].join("\n")
    }
  ];
}

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
    const { sessionId, transcriptText, contextTranscriptText, previousAnalysis, lastProcessedFile, isFinal, targetProfileSlug } = req.body;
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

      if (!targetProfileSlug) {
        profileSync.skippedReason = "missing_target_profile";
        return;
      }

      const targetProfile = loadProfileBySlug(targetProfileSlug);
      if (!targetProfile) {
        profileSync.skippedReason = "target_profile_not_found";
        return;
      }

      const newLineCount = newTranscript.split("\n").filter(Boolean).length;
      const shouldSyncProfiles = isFinal || newLineCount >= 2 || newTranscript.length >= 120;
      if (!shouldSyncProfiles) {
        profileSync.skippedReason = "increment_too_small";
        return;
      }

      profileSync.attempted = true;
      const analysis = await analysisPromise;
      console.log(`[profile] Updating selected profile ${targetProfile.slug} (${targetProfile.name}) from analysis...`);
      const result = await upsertWorkProfileFromAnalysis(
        { profileSlug: targetProfileSlug, speakerLabel: targetProfile.name || targetProfile.speakerLabel || "当前同事" },
        analysis,
        newTranscript,
        validImages.length
      );

      profileUpdates = [
        result.ok && result.data
          ? {
              speakerLabel: result.data.speakerLabel || targetProfile.name || "",
              slug: result.data.slug,
              name: result.data.name,
              role: result.data.role,
              merged: Boolean(result.merged),
              error: ""
            }
          : {
              speakerLabel: targetProfile.name || "",
              slug: targetProfile.slug,
              error: result.error || "unknown_profile_error",
              merged: false
            }
      ];
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

app.post("/api/profiles/manual", (req, res) => {
  try {
    const { name, role } = req.body;
    const result = createManualProfile(name, role);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (e) {
    console.error("Manual profile create error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.post("/api/profiles/rename", (req, res) => {
  try {
    const { slug, name } = req.body;
    const result = updateProfileNameBySlug(slug, name);
    if (!result.ok) {
      return res.status(result.error === "not_found" ? 404 : 400).json(result);
    }
    res.json(result);
  } catch (e) {
    console.error("Profile rename error:", e);
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

app.post("/api/chat-users/allocate", (req, res) => {
  try {
    const data = allocateChatUserId();
    res.json({ ok: true, data });
  } catch (e) {
    console.error("Allocate chat user id error:", e);
    res.status(500).json({ ok: false, error: "server_error", message: e.message });
  }
});

app.post("/api/chat-users/login", (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!isValidChatUserId(userId)) {
      return res.status(400).json({ ok: false, error: "invalid_user_id" });
    }
    const user = getChatUser(userId);
    if (!user) {
      return res.status(404).json({ ok: false, error: "user_not_found" });
    }
    const ensured = ensureChatUser(userId);
    res.json(ensured);
  } catch (e) {
    console.error("Chat user login error:", e);
    res.status(500).json({ ok: false, error: "server_error", message: e.message });
  }
});

app.get("/api/chat-users/:userId/conversations/:slug", (req, res) => {
  try {
    const result = loadConversationState(req.params.userId, req.params.slug);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (e) {
    console.error("Load conversation state error:", e);
    res.status(500).json({ ok: false, error: "server_error", message: e.message });
  }
});

app.post("/api/chat-users/:userId/conversations/:slug", (req, res) => {
  try {
    const { profileName = "", messages = [], autopilotReport = "" } = req.body || {};
    const result = saveConversationState(req.params.userId, req.params.slug, {
      profileName,
      messages: normalizeConversationMessages(messages),
      autopilotReport
    });
    if (!result.ok) {
      return res.status(result.error === "invalid_user_id" ? 400 : 404).json(result);
    }
    res.json(result);
  } catch (e) {
    console.error("Save conversation state error:", e);
    res.status(500).json({ ok: false, error: "server_error", message: e.message });
  }
});

app.get("/api/chat-admin/users", (req, res) => {
  try {
    res.json({ ok: true, data: listChatUsers() });
  } catch (e) {
    console.error("List chat admin users error:", e);
    res.status(500).json({ ok: false, error: "server_error", message: e.message });
  }
});

app.get("/api/chat-admin/users/:userId", (req, res) => {
  try {
    const data = getChatUserDetail(req.params.userId);
    if (!data) {
      return res.status(404).json({ ok: false, error: "user_not_found" });
    }
    res.json({ ok: true, data });
  } catch (e) {
    console.error("Get chat admin user detail error:", e);
    res.status(500).json({ ok: false, error: "server_error", message: e.message });
  }
});

app.get("/api/chat-admin/users/:userId/profile", async (req, res) => {
  try {
    const force = String(req.query.force || "").trim() === "true";
    const result = await getOrBuildUserProfile(req.params.userId, { force });
    if (!result.ok) {
      return res.status(result.error === "user_not_found" ? 404 : 400).json(result);
    }
    res.json(result);
  } catch (e) {
    console.error("Get chat admin user profile error:", e);
    res.status(500).json({ ok: false, error: "server_error", message: e.message });
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
    const { slug, messages, chatUserId } = req.body;
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

    const normalizedMessages = normalizeChatMessages(messages);
    const userProfileData = chatUserId && isValidChatUserId(chatUserId)
      ? loadStoredUserProfile(chatUserId)
      : null;
    const systemPrompt = buildChatSystemPrompt(profile, { userProfileData });

    const t3 = Date.now();
    console.log(`[Chat] 构建提示词完成: ${t3 - t2}ms`);

    const qwenClient = createQwenClient();
    const { model, maxTokens } = getQwenConfig();

    console.log(`[Chat] 开始调用大模型 (${model})...`);
    const stream = await qwenClient.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...normalizedMessages
      ],
      max_tokens: maxTokens,
      stream: true,
      temperature: 0.2,
      extra_body: { enable_thinking: false }
    });

    const t4 = Date.now();
    console.log(`[Chat] 拿到 stream: ${t4 - t3}ms`);

    let firstChunk = true;
    let assistantContent = "";
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        if (firstChunk) {
          console.log(`[Chat] 首块到达: ${Date.now() - t4}ms`);
          firstChunk = false;
        }
        assistantContent += delta;
        res.write(JSON.stringify({ ok: true, delta }) + "\n");
      }
    }

    if (chatUserId && isValidChatUserId(chatUserId)) {
      const conversationMessages = [
        ...normalizeConversationMessages(messages),
        {
          id: "",
          role: "assistant",
          content: assistantContent,
          label: profile.name || ""
        }
      ];
      saveConversationState(chatUserId, slug, {
        profileName: profile.name || "",
        messages: conversationMessages
      });
      Promise.resolve()
        .then(() => getOrBuildUserProfile(chatUserId))
        .catch((err) => console.error("Refresh user profile after chat error:", err));
    }

    console.log(`[Chat] 全部完成: ${Date.now() - t0}ms`);
    res.end();
  } catch (e) {
    console.error("Chat error:", e);
    res.write(JSON.stringify({ ok: false, error: "server_error", message: e.message }) + "\n");
    res.end();
  }
});

app.post("/api/chat/spectator", async (req, res) => {
  try {
    const { slug, messages, draftMessage = "", pendingSuggestions = [], manual = false } = req.body || {};
    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });

    const profile = loadProfileBySlug(slug);
    if (!profile) return res.status(404).json({ ok: false, error: "profile_not_found" });

    const normalizedMessages = normalizeChatMessages(messages);
    const raw = await completeJsonObject(
      buildSpectatorSuggestionMessages({
        profile,
        messages: normalizedMessages,
        draftMessage,
        pendingSuggestions,
        manual
      }),
      { temperature: 0, maxTokens: 1200 }
    );
    const parsed = parseJsonContent(raw);
    if (!parsed.ok) {
      return res.status(500).json({ ok: false, error: "invalid_json_response", message: String(parsed.error) });
    }

    const value = parsed.value || {};
    const shouldIntervene = value.shouldIntervene === true;
    const topic = typeof value.topic === "string" ? value.topic.trim() : "";
    const userAsk = typeof value.userAsk === "string" ? value.userAsk.trim() : "";
    const assistantPrompt = typeof value.assistantPrompt === "string" ? value.assistantPrompt.trim() : "";
    const suggestionType = typeof value.suggestionType === "string" ? value.suggestionType.trim() : "";
    const reasoning = typeof value.reasoning === "string" ? value.reasoning.trim() : "";

    res.json({
      ok: true,
      data: {
        shouldIntervene,
        topic,
        userAsk,
        assistantPrompt,
        suggestionType,
        reasoning
      }
    });
  } catch (e) {
    console.error("Spectator suggestion error:", e);
    res.status(500).json({ ok: false, error: "server_error", message: e.message });
  }
});

app.post("/api/chat/autopilot/step", async (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    const {
      slug,
      messages,
      transcript = [],
      nextSpeaker = "main",
      endRequested = false,
      mode = "normal",
      stepIndex = 1
    } = req.body || {};

    if (!slug) {
      res.statusCode = 400;
      res.end("missing_slug");
      return;
    }

    const profile = loadProfileBySlug(slug);
    if (!profile) {
      res.statusCode = 404;
      res.end("profile_not_found");
      return;
    }

    const normalizedMessages = normalizeChatMessages(messages);
    const promptMessages = buildAutopilotStepMessages({
      profile,
      messages: normalizedMessages,
      transcript,
      nextSpeaker,
      endRequested,
      mode,
      stepIndex
    });

    await streamCompletionAsText(res, promptMessages, {
      temperature: nextSpeaker === "spectator" ? 0 : 0.2,
      maxTokens: nextSpeaker === "spectator" ? 1800 : 2400
    });
    res.end();
  } catch (e) {
    console.error("Autopilot step error:", e);
    res.statusCode = 500;
    res.end(`自动讨论出错：${e.message}`);
  }
});

app.post("/api/chat/autopilot/report", async (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    const { slug, messages, transcript = [], mode = "normal" } = req.body || {};
    if (!slug) {
      res.statusCode = 400;
      res.end("missing_slug");
      return;
    }

    const profile = loadProfileBySlug(slug);
    if (!profile) {
      res.statusCode = 404;
      res.end("profile_not_found");
      return;
    }

    await streamCompletionAsText(
      res,
      buildAutopilotReportMessages({
        profile,
        messages: normalizeChatMessages(messages),
        transcript,
        mode
      }),
      { temperature: 0.2, maxTokens: 2400 }
    );
    res.end();
  } catch (e) {
    console.error("Autopilot report error:", e);
    res.statusCode = 500;
    res.end(`自动讨论总结出错：${e.message}`);
  }
});

const port = Number(process.env.PORT ?? "8787");
server.listen(port, () => {
  process.stdout.write(`server listening on http://localhost:${port}\n`);
});
