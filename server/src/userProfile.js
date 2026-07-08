import fs from "node:fs";
import path from "node:path";
import { createQwenClient, getQwenConfig } from "./qwenClient.js";
import { extractLikelyJsonObject, safeJsonParse } from "./json.js";
import { getChatUserDetail } from "./chatStore.js";

function getChatUsersRoot() {
  return path.resolve(process.cwd(), "..", "screen-catch", "data", "chat-users");
}

function getUserDir(userId) {
  return path.join(getChatUsersRoot(), "users", userId);
}

function getUserProfilePath(userId) {
  return path.join(getUserDir(userId), "user-profile.json");
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function getLatestSourceUpdatedAt(detail) {
  const values = (detail?.conversations || [])
    .map((item) => Date.parse(item.updatedAt || item.createdAt || 0))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return "";
  return new Date(Math.max(...values)).toISOString();
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function validateProfileShape(value) {
  if (!value || typeof value !== "object") return null;
  return {
    summary: String(value.summary || "").trim(),
    communicationStyle: normalizeArray(value.communicationStyle),
    technicalFocus: normalizeArray(value.technicalFocus),
    collaborationStyle: normalizeArray(value.collaborationStyle),
    decisionPattern: normalizeArray(value.decisionPattern),
    concerns: normalizeArray(value.concerns),
    goals: normalizeArray(value.goals)
  };
}

function parseProfileJson(raw) {
  const extracted = extractLikelyJsonObject(raw) ?? raw;
  const parsed = safeJsonParse(extracted);
  if (parsed.ok) return validateProfileShape(parsed.value);
  const cleaned = String(raw || "").replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const retried = safeJsonParse(extractLikelyJsonObject(cleaned) ?? cleaned);
  return retried.ok ? validateProfileShape(retried.value) : null;
}

function buildConversationDigest(detail) {
  const conversations = Array.isArray(detail?.conversations) ? detail.conversations : [];
  const conversationSummaries = [];
  let totalMessages = 0;
  let totalUserMessages = 0;
  const allUserMessages = [];

  for (const conversation of conversations) {
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    totalMessages += messages.length;
    const userMessages = messages
      .filter((item) => item?.role === "user" && typeof item.content === "string" && item.content.trim())
      .map((item) => item.content.trim());
    totalUserMessages += userMessages.length;
    if (userMessages.length > 0) {
      allUserMessages.push(
        `会话对象：${conversation.profileName || conversation.slug}`,
        ...userMessages.map((item, idx) => `- 用户第 ${idx + 1} 句：${item}`)
      );
    }
    conversationSummaries.push({
      slug: conversation.slug,
      profileName: conversation.profileName || conversation.slug,
      messageCount: messages.length,
      userMessageCount: userMessages.length,
      updatedAt: conversation.updatedAt || conversation.createdAt || ""
    });
  }

  const messageDigest = allUserMessages.join("\n").slice(0, 18000);
  return {
    conversationCount: conversations.length,
    totalMessages,
    totalUserMessages,
    conversationSummaries,
    messageDigest
  };
}

async function completeJsonObject(messages) {
  const client = createQwenClient();
  const { model, maxTokens } = getQwenConfig();
  const resp = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.2,
    max_tokens: Math.min(Math.max(maxTokens, 1800), 3200),
    response_format: { type: "json_object" },
    extra_body: { enable_thinking: false }
  });
  return resp.choices?.[0]?.message?.content ?? "";
}

function buildUserProfileMessages(userId, digest) {
  const conversationList = digest.conversationSummaries.length > 0
    ? digest.conversationSummaries
        .map((item, idx) => `${idx + 1}. ${item.profileName}（slug=${item.slug}，总消息=${item.messageCount}，用户消息=${item.userMessageCount}，更新时间=${item.updatedAt || "未知"}）`)
        .join("\n")
    : "（暂无会话）";

  return [
    {
      role: "system",
      content: [
        "你是一个用户画像分析助手。",
        "请根据同一编号用户在所有历史会话中的发言，归纳这个用户的画像。",
        "重点分析用户自己的表达、关注点、协作方式、决策倾向、常见担忧与目标。",
        "不要分析模拟同事本身，只分析这个用户。",
        "如果证据不足，要明确保持保守，不要编造。",
        "你必须严格输出 JSON，对象字段只能是：summary, communicationStyle, technicalFocus, collaborationStyle, decisionPattern, concerns, goals。",
        "summary 是 2-4 句中文总结。",
        "其余字段都必须是中文字符串数组，每项尽量简洁具体。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `编号用户：${userId}`,
        `会话数：${digest.conversationCount}`,
        `总消息数：${digest.totalMessages}`,
        `用户消息数：${digest.totalUserMessages}`,
        "",
        "=== 涉及的会话 ===",
        conversationList,
        "",
        "=== 用户历史发言摘录 ===",
        digest.messageDigest || "（暂无可用用户发言）",
        "",
        "请输出该用户画像。"
      ].join("\n")
    }
  ];
}

export async function getOrBuildUserProfile(userId, { force = false } = {}) {
  const detail = getChatUserDetail(userId);
  if (!detail) {
    return { ok: false, error: "user_not_found" };
  }

  const digest = buildConversationDigest(detail);
  const sourceUpdatedAt = getLatestSourceUpdatedAt(detail);
  const filePath = getUserProfilePath(userId);
  const existing = readJson(filePath, null);
  if (!force && existing && existing.sourceUpdatedAt === sourceUpdatedAt && existing.profile) {
    return { ok: true, data: existing };
  }

  const fallbackProfile = {
    summary: digest.totalUserMessages > 0
      ? `该用户当前共有 ${digest.conversationCount} 个会话、${digest.totalUserMessages} 条用户发言，已有一定分析基础。`
      : "该用户当前历史发言较少，暂时无法形成稳定画像。",
    communicationStyle: [],
    technicalFocus: [],
    collaborationStyle: [],
    decisionPattern: [],
    concerns: [],
    goals: []
  };

  let profile = fallbackProfile;
  if (digest.totalUserMessages > 0 && digest.messageDigest) {
    const raw = await completeJsonObject(buildUserProfileMessages(userId, digest));
    const parsed = parseProfileJson(raw);
    if (parsed) {
      profile = parsed;
    }
  }

  const data = {
    userId,
    updatedAt: new Date().toISOString(),
    sourceUpdatedAt,
    stats: {
      conversationCount: digest.conversationCount,
      totalMessages: digest.totalMessages,
      totalUserMessages: digest.totalUserMessages
    },
    profile
  };
  writeJson(filePath, data);
  return { ok: true, data };
}

export function loadStoredUserProfile(userId) {
  if (!userId) return null;
  return readJson(getUserProfilePath(userId), null);
}
