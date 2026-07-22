import fs from "node:fs";
import path from "node:path";
import { normalizeTemporaryPreferenceData } from "./sessionPreferences.js";

function getChatUsersRoot() {
  return path.resolve(process.cwd(), "..", "screen-catch", "data", "chat-users");
}

function getChatUsersDir() {
  return path.join(getChatUsersRoot(), "users");
}

function getUserDir(userId) {
  return path.join(getChatUsersDir(), userId);
}

function getUserMetaPath(userId) {
  return path.join(getUserDir(userId), "meta.json");
}

function getConversationDir(userId) {
  return path.join(getUserDir(userId), "conversations");
}

function getConversationPath(userId, slug) {
  return path.join(getConversationDir(userId), `${slug}.json`);
}

function getSeqPath() {
  return path.join(getChatUsersRoot(), "user-id-seq.json");
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureChatStoreDirs() {
  ensureDir(getChatUsersRoot());
  ensureDir(getChatUsersDir());
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
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function formatYYMMDD(date = new Date()) {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function randomSuffix() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

function sanitizeStoredMessages(messages = []) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((item) => item && typeof item.content === "string")
    .map((item) => {
      const role = item.role === "user" || item.role === "spectator" ? item.role : "assistant";
      return {
        id: typeof item.id === "string" ? item.id : "",
        role,
        content: item.content,
        label: typeof item.label === "string" ? item.label : ""
      };
    });
}

function summarizeConversation(conversation) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const lastMessage = messages[messages.length - 1];
  return {
    slug: conversation.slug || "",
    profileName: conversation.profileName || "",
    messageCount: messages.length,
    updatedAt: conversation.updatedAt || conversation.createdAt || "",
    lastMessagePreview: lastMessage?.content ? lastMessage.content.slice(0, 120) : ""
  };
}

export function isValidChatUserId(userId) {
  return /^\d{10}$/.test(String(userId || "").trim());
}

export function allocateChatUserId() {
  ensureChatStoreDirs();
  const seqPath = getSeqPath();
  const seqState = readJson(seqPath, {});
  const prefix = formatYYMMDD();
  const usedSuffixes = new Set(Array.isArray(seqState[prefix]?.used_suffixes) ? seqState[prefix].used_suffixes : []);

  let suffix = "";
  for (let i = 0; i < 200; i += 1) {
    const candidate = randomSuffix();
    if (!usedSuffixes.has(candidate)) {
      suffix = candidate;
      break;
    }
  }
  if (!suffix) {
    for (let i = 0; i < 10000; i += 1) {
      const candidate = String(i).padStart(4, "0");
      if (!usedSuffixes.has(candidate)) {
        suffix = candidate;
        break;
      }
    }
  }
  if (!suffix) {
    throw new Error("user_id_exhausted");
  }

  usedSuffixes.add(suffix);
  seqState[prefix] = { used_suffixes: Array.from(usedSuffixes).sort() };
  writeJson(seqPath, seqState);

  const userId = `${prefix}${suffix}`;
  return ensureChatUser(userId).data;
}

export function ensureChatUser(userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!isValidChatUserId(normalizedUserId)) {
    return { ok: false, error: "invalid_user_id" };
  }

  ensureChatStoreDirs();
  const userDir = getUserDir(normalizedUserId);
  const conversationsDir = getConversationDir(normalizedUserId);
  ensureDir(userDir);
  ensureDir(conversationsDir);

  const metaPath = getUserMetaPath(normalizedUserId);
  const existing = readJson(metaPath, null);
  const now = new Date().toISOString();
  const meta = existing || {
    userId: normalizedUserId,
    createdAt: now,
    updatedAt: now
  };
  meta.updatedAt = now;
  writeJson(metaPath, meta);
  return { ok: true, data: meta };
}

export function getChatUser(userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!isValidChatUserId(normalizedUserId)) {
    return null;
  }
  return readJson(getUserMetaPath(normalizedUserId), null);
}

export function saveConversationState(
  userId,
  slug,
  { profileName = "", messages = [], autopilotReport = "", temporaryPreferences = null } = {}
) {
  const ensured = ensureChatUser(userId);
  if (!ensured.ok) return ensured;

  const normalizedSlug = String(slug || "").trim();
  if (!normalizedSlug) {
    return { ok: false, error: "missing_slug" };
  }

  const filePath = getConversationPath(ensured.data.userId, normalizedSlug);
  const existing = readJson(filePath, null);
  const now = new Date().toISOString();
  const conversation = {
    userId: ensured.data.userId,
    slug: normalizedSlug,
    profileName: String(profileName || existing?.profileName || "").trim(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    messages: sanitizeStoredMessages(messages),
    autopilotReport: typeof autopilotReport === "string" ? autopilotReport : "",
    temporaryPreferences: normalizeTemporaryPreferenceData(
      temporaryPreferences ?? existing?.temporaryPreferences
    )
  };
  writeJson(filePath, conversation);

  const meta = {
    ...ensured.data,
    updatedAt: now
  };
  writeJson(getUserMetaPath(ensured.data.userId), meta);

  return { ok: true, data: conversation };
}

export function loadConversationState(userId, slug) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedSlug = String(slug || "").trim();
  if (!isValidChatUserId(normalizedUserId) || !normalizedSlug) {
    return { ok: false, error: "invalid_user_id_or_slug" };
  }

  const conversation = readJson(getConversationPath(normalizedUserId, normalizedSlug), null);
  if (!conversation) {
    return {
      ok: true,
      data: {
        userId: normalizedUserId,
        slug: normalizedSlug,
        profileName: "",
        createdAt: "",
        updatedAt: "",
        messages: [],
        autopilotReport: "",
        temporaryPreferences: normalizeTemporaryPreferenceData(null)
      }
    };
  }
  return {
    ok: true,
    data: {
      ...conversation,
      messages: sanitizeStoredMessages(conversation.messages),
      autopilotReport: typeof conversation.autopilotReport === "string" ? conversation.autopilotReport : "",
      temporaryPreferences: normalizeTemporaryPreferenceData(conversation.temporaryPreferences)
    }
  };
}

export function listUserConversations(userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!isValidChatUserId(normalizedUserId)) {
    return [];
  }
  const conversationsDir = getConversationDir(normalizedUserId);
  if (!fs.existsSync(conversationsDir)) return [];

  const items = [];
  for (const entry of fs.readdirSync(conversationsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const conversation = readJson(path.join(conversationsDir, entry.name), null);
    if (conversation) {
      items.push(summarizeConversation(conversation));
    }
  }
  return items.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export function listChatUsers() {
  ensureChatStoreDirs();
  const users = [];
  for (const entry of fs.readdirSync(getChatUsersDir(), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const meta = readJson(getUserMetaPath(entry.name), null);
    if (!meta) continue;
    const conversations = listUserConversations(entry.name);
    users.push({
      userId: meta.userId || entry.name,
      createdAt: meta.createdAt || "",
      updatedAt: meta.updatedAt || "",
      conversationCount: conversations.length,
      conversations
    });
  }
  return users.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export function getChatUserDetail(userId) {
  const meta = getChatUser(userId);
  if (!meta) return null;

  const conversations = [];
  const conversationsDir = getConversationDir(meta.userId);
  if (fs.existsSync(conversationsDir)) {
    for (const entry of fs.readdirSync(conversationsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const conversation = readJson(path.join(conversationsDir, entry.name), null);
      if (!conversation) continue;
      conversations.push({
        ...conversation,
        messages: sanitizeStoredMessages(conversation.messages)
      });
    }
  }

  conversations.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return {
    userId: meta.userId,
    createdAt: meta.createdAt || "",
    updatedAt: meta.updatedAt || "",
    conversationCount: conversations.length,
    conversations
  };
}
