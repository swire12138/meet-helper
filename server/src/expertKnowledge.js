import fs from "node:fs";
import path from "node:path";
import { createQwenClient, getQwenConfig } from "./qwenClient.js";
import { extractLikelyJsonObject, safeJsonParse } from "./json.js";

const EXPERTS_DIR_NAME = "experts";
const MAX_SUMMARY_MEETINGS = 3;

export const EXPERT_SLOT_CONFIG = {
  core_domain: { scope: "long_term", historyCap: 120, tauDays: 180, switchThreshold: 1.2, label: "核心领域" },
  core_principles: { scope: "long_term", historyCap: 120, tauDays: 180, switchThreshold: 1.2, label: "核心原则" },
  reasoning_frameworks: { scope: "mid_term", historyCap: 100, tauDays: 120, switchThreshold: 1.15, label: "判断框架" },
  technical_or_clinical_preferences: { scope: "mid_term", historyCap: 90, tauDays: 120, switchThreshold: 1.15, label: "技术/临床偏好" },
  terminology_system: { scope: "long_term", historyCap: 80, tauDays: 150, switchThreshold: 1.1, label: "术语体系" },
  recent_focus_topics: { scope: "mid_term", historyCap: 30, tauDays: 30, switchThreshold: 1.05, label: "最近关注议题" },
  recent_decision_patterns: { scope: "mid_term", historyCap: 40, tauDays: 45, switchThreshold: 1.08, label: "最近决策路径" },
  recent_solution_patterns: { scope: "mid_term", historyCap: 40, tauDays: 45, switchThreshold: 1.08, label: "最近方案模式" },
  current_hot_questions: { scope: "short_term", historyCap: 20, tauDays: 14, switchThreshold: 1.0, label: "当前高频问题" },
  temporary_hypotheses: { scope: "short_term", historyCap: 15, tauDays: 7, switchThreshold: 1.0, label: "阶段性判断" },
  meeting_specific_context: { scope: "short_term", historyCap: 12, tauDays: 7, switchThreshold: 1.0, label: "会议期上下文" }
};

function getExpertsRoot() {
  return path.resolve(process.cwd(), "..", "screen-catch", "data", EXPERTS_DIR_NAME);
}

function getExpertDir(slug) {
  return path.join(getExpertsRoot(), slug);
}

function getExpertMetaPath(slug) {
  return path.join(getExpertDir(slug), "expert.json");
}

function getPortraitDir(slug) {
  return path.join(getExpertDir(slug), "portrait");
}

function getMeetingsDir(slug) {
  return path.join(getExpertDir(slug), "meetings");
}

function getMeetingDir(slug, meetingId) {
  return path.join(getMeetingsDir(slug), meetingId);
}

function getMemoryUnitsPath(slug) {
  return path.join(getExpertDir(slug), "memory_units", "units.jsonl");
}

function getEventLedgerPath(slug) {
  return path.join(getExpertDir(slug), "events", "ledger.jsonl");
}

function getAggregatesPath(slug) {
  return path.join(getExpertDir(slug), "aggregates", "slots.json");
}

function getPortraitSummaryPath(slug) {
  return path.join(getPortraitDir(slug), "summary.json");
}

function getPortraitMarkdownPath(slug) {
  return path.join(getPortraitDir(slug), "expert.md");
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function removePathRecursiveSync(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  const stat = fs.lstatSync(targetPath);
  if (!stat.isDirectory()) {
    fs.unlinkSync(targetPath);
    return;
  }
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const childPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      removePathRecursiveSync(childPath);
    } else {
      fs.unlinkSync(childPath);
    }
  }
  fs.rmdirSync(targetPath);
}

function copyPathRecursiveSync(sourcePath, targetPath) {
  const stat = fs.lstatSync(sourcePath);
  if (!stat.isDirectory()) {
    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);
    return;
  }
  ensureDir(targetPath);
  for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
    copyPathRecursiveSync(path.join(sourcePath, entry.name), path.join(targetPath, entry.name));
  }
}

function ensureExpertsRoot() {
  ensureDir(getExpertsRoot());
}

function ensureExpertStructure(slug) {
  ensureExpertsRoot();
  const expertDir = getExpertDir(slug);
  ensureDir(expertDir);
  ensureDir(getPortraitDir(slug));
  ensureDir(getMeetingsDir(slug));
  ensureDir(path.join(expertDir, "memory_units"));
  ensureDir(path.join(expertDir, "events"));
  ensureDir(path.join(expertDir, "aggregates"));
}

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function appendJsonl(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function slugifyExpertName(name) {
  const slug = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return slug || `expert-${Date.now()}`;
}

function createUniqueExpertSlug(name) {
  const base = slugifyExpertName(name);
  let slug = base;
  let index = 1;
  while (fs.existsSync(getExpertDir(slug))) {
    slug = `${base}-${index++}`;
  }
  return slug;
}

function nowIso() {
  return new Date().toISOString();
}

function hashText(text) {
  const source = String(text || "");
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clipText(text, maxLength) {
  if (typeof text !== "string") return "";
  const value = text.trim();
  if (!value) return "";
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
}

function normalizeLineArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function uniqueStringArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)));
}

async function completeJsonObject(messages, { temperature = 0.2, maxTokens = 2000 } = {}) {
  const client = createQwenClient();
  const { model, maxTokens: defaultMaxTokens } = getQwenConfig();
  const resp = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: Math.min(defaultMaxTokens, maxTokens),
    response_format: { type: "json_object" },
    extra_body: { enable_thinking: false }
  });
  return resp.choices?.[0]?.message?.content ?? "";
}

async function parseModelJson(messages, schemaHint, options) {
  const raw = await completeJsonObject(messages, options);
  const extracted = extractLikelyJsonObject(raw) ?? raw;
  const parsed = safeJsonParse(extracted);
  if (parsed.ok) return { ok: true, value: parsed.value };

  const repairMessages = [
    {
      role: "system",
      content: "你是 JSON 修复助手。只能输出一个合法 JSON 对象。"
    },
    {
      role: "user",
      content: [
        "请把下面内容修复成合法 JSON。",
        `结构要求：${schemaHint}`,
        "",
        raw || "（空）"
      ].join("\n")
    }
  ];
  const fixedRaw = await completeJsonObject(repairMessages, { temperature: 0, maxTokens: 1200 });
  const fixedExtracted = extractLikelyJsonObject(fixedRaw) ?? fixedRaw;
  const fixedParsed = safeJsonParse(fixedExtracted);
  if (fixedParsed.ok) return { ok: true, value: fixedParsed.value };
  return { ok: false, error: parsed.error || fixedParsed.error || "invalid_json_response" };
}

function listMeetingDirs(slug) {
  const meetingsDir = getMeetingsDir(slug);
  if (!fs.existsSync(meetingsDir)) return [];
  return fs.readdirSync(meetingsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
}

function getMeetingSummaryPath(slug, meetingId) {
  return path.join(getMeetingDir(slug, meetingId), "summary.json");
}

function getMeetingMetaPath(slug, meetingId) {
  return path.join(getMeetingDir(slug, meetingId), "meta.json");
}

function getMeetingTranscriptPath(slug, meetingId) {
  return path.join(getMeetingDir(slug, meetingId), "transcript.md");
}

function getMeetingImagesPath(slug, meetingId) {
  return path.join(getMeetingDir(slug, meetingId), "images.json");
}

function getMeetingExtractedMemoriesPath(slug, meetingId) {
  return path.join(getMeetingDir(slug, meetingId), "extracted_memories.json");
}

function buildExpertPromptMarkdown(summary, expert) {
  const sections = [
    `# ${expert.name}`,
    expert.domain ? `- 领域：${expert.domain}` : "",
    expert.description ? `- 说明：${expert.description}` : "",
    "",
    "## 核心领域",
    ...(summary.coreDomain?.length ? summary.coreDomain.map((item) => `- ${item}`) : ["- 暂无"]),
    "",
    "## 核心原则",
    ...(summary.corePrinciples?.length ? summary.corePrinciples.map((item) => `- ${item}`) : ["- 暂无"]),
    "",
    "## 判断框架",
    ...(summary.reasoningFrameworks?.length ? summary.reasoningFrameworks.map((item) => `- ${item}`) : ["- 暂无"]),
    "",
    "## 最近关注议题",
    ...(summary.recentFocusTopics?.length ? summary.recentFocusTopics.map((item) => `- ${item}`) : ["- 暂无"]),
    "",
    "## 当前高频问题",
    ...(summary.currentHotQuestions?.length ? summary.currentHotQuestions.map((item) => `- ${item}`) : ["- 暂无"]),
    "",
    "## 术语体系",
    ...(summary.terminologySystem?.length ? summary.terminologySystem.map((item) => `- ${item}`) : ["- 暂无"])
  ];
  return sections.filter(Boolean).join("\n");
}

function buildExpertCompatibilityViews(summary) {
  const personaMd = [
    "## 核心原则",
    ...(summary.corePrinciples?.length ? summary.corePrinciples.map((item) => `- ${item}`) : ["- 暂无"]),
    "",
    "## 判断框架",
    ...(summary.reasoningFrameworks?.length ? summary.reasoningFrameworks.map((item) => `- ${item}`) : ["- 暂无"]),
    "",
    "## 当前高频问题",
    ...(summary.currentHotQuestions?.length ? summary.currentHotQuestions.map((item) => `- ${item}`) : ["- 暂无"])
  ].join("\n");

  const workMd = [
    "## 核心领域",
    ...(summary.coreDomain?.length ? summary.coreDomain.map((item) => `- ${item}`) : ["- 暂无"]),
    "",
    "## 最近关注议题",
    ...(summary.recentFocusTopics?.length ? summary.recentFocusTopics.map((item) => `- ${item}`) : ["- 暂无"]),
    "",
    "## 方案模式",
    ...(summary.recentSolutionPatterns?.length ? summary.recentSolutionPatterns.map((item) => `- ${item}`) : ["- 暂无"]),
    "",
    "## 术语体系",
    ...(summary.terminologySystem?.length ? summary.terminologySystem.map((item) => `- ${item}`) : ["- 暂无"])
  ].join("\n");

  return { personaMd, workMd };
}

function buildExpertSummarySnapshot(slotsJson) {
  const slots = slotsJson?.slots || {};
  const pickTop = (slotName, limit = 5) => {
    const slot = slots[slotName];
    if (!slot || !Array.isArray(slot.candidateValues)) return [];
    return slot.candidateValues
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.value)
      .filter(Boolean);
  };

  return {
    updatedAt: slotsJson?.updatedAt || nowIso(),
    coreDomain: pickTop("core_domain", 3),
    corePrinciples: pickTop("core_principles", 5),
    reasoningFrameworks: pickTop("reasoning_frameworks", 5),
    technicalOrClinicalPreferences: pickTop("technical_or_clinical_preferences", 5),
    terminologySystem: pickTop("terminology_system", 8),
    recentFocusTopics: pickTop("recent_focus_topics", 6),
    recentDecisionPatterns: pickTop("recent_decision_patterns", 4),
    recentSolutionPatterns: pickTop("recent_solution_patterns", 4),
    currentHotQuestions: pickTop("current_hot_questions", 5),
    temporaryHypotheses: pickTop("temporary_hypotheses", 5),
    meetingSpecificContext: pickTop("meeting_specific_context", 5)
  };
}

function buildChatPromptUserSection(userProfileData) {
  const profile = userProfileData?.profile;
  if (!profile) return "";
  const sections = [
    "## 当前用户画像",
    "以下内容描述的是你正在对话的这位用户，而不是你自己。你必须把它当作对话偏好来使用。"
  ];
  if (profile.summary) sections.push(`- 用户画像总结：${profile.summary}`);
  const mapping = [
    ["沟通偏好", profile.communicationStyle],
    ["技术关注点", profile.technicalFocus],
    ["协作方式偏好", profile.collaborationStyle],
    ["决策模式", profile.decisionPattern],
    ["常见担忧", profile.concerns],
    ["目标偏好", profile.goals]
  ];
  for (const [label, value] of mapping) {
    if (Array.isArray(value) && value.length > 0) {
      sections.push(`- ${label}：${value.join("；")}`);
    }
  }
  sections.push(
    "",
    "## 用户画像使用规则",
    "1. 优先贴合该用户当前更容易接受的表达方式和推进节奏。",
    "2. 如果当前对话中用户明确表达的偏好与历史画像冲突，以当前表达为准。",
    "3. 用户画像只用于适配表达方式与侧重点，不能编造用户没有说过的事实。"
  );
  return sections.join("\n");
}

export function buildExpertChatSystemPrompt(expert, { userProfileData } = {}) {
  const summary = expert.summary || {};
  const promptMd = expert.expertMd || buildExpertPromptMarkdown(summary, expert);
  const userSection = buildChatPromptUserSection(userProfileData);
  return [
    `你是抽象专家知识画像「${expert.name}」的数字孪生 Agent。`,
    "你不是某个真实参会者，而是基于该专家长期沉淀的知识、方法和判断框架来回答。",
    "如果用户问题与专家历史知识相关，要优先基于该专家的稳定画像与相关会议知识来回答。",
    "如果画像中没有足够信息，可以明确说明当前知识体中没有足够依据，不要编造。",
    "",
    "## 专家画像",
    promptMd,
    "",
    userSection,
    "## 对话要求",
    "1. 回答时优先体现该专家的核心原则、判断框架和近期关注点。",
    "2. 直接给结论、方案和说明，不要无端反问。",
    "3. 若问题与近期会议上下文相关，应优先引用该专家最近知识会中的相关结论。"
  ].filter(Boolean).join("\n");
}

function normalizeExpertMeta(meta) {
  return {
    slug: typeof meta?.slug === "string" ? meta.slug : "",
    name: typeof meta?.name === "string" ? meta.name : "",
    domain: typeof meta?.domain === "string" ? meta.domain : "",
    description: typeof meta?.description === "string" ? meta.description : "",
    status: meta?.status === "archived" ? "archived" : "active",
    tags: uniqueStringArray(meta?.tags),
    meetingCount: Number.isFinite(Number(meta?.meetingCount)) ? Number(meta.meetingCount) : 0,
    activeMeetingCount: Number.isFinite(Number(meta?.activeMeetingCount)) ? Number(meta.activeMeetingCount) : 0,
    createdAt: typeof meta?.createdAt === "string" ? meta.createdAt : nowIso(),
    updatedAt: typeof meta?.updatedAt === "string" ? meta.updatedAt : nowIso()
  };
}

function buildExpertListItem(expert) {
  return {
    slug: expert.slug,
    name: expert.name,
    role: expert.domain || "",
    domain: expert.domain || "",
    impression: expert.description || "",
    meeting_count: expert.activeMeetingCount || expert.meetingCount || 0,
    updated_at: expert.updatedAt
  };
}

export function listExperts() {
  ensureExpertsRoot();
  const dirs = fs.readdirSync(getExpertsRoot(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  return dirs
    .map((slug) => loadExpertBySlug(slug))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map(buildExpertListItem);
}

export function createManualExpert(name, domain = "", description = "") {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    return { ok: false, error: "missing_name" };
  }
  const slug = createUniqueExpertSlug(normalizedName);
  const meta = normalizeExpertMeta({
    slug,
    name: normalizedName,
    domain: String(domain || "").trim(),
    description: String(description || "").trim(),
    status: "active",
    tags: [],
    meetingCount: 0,
    activeMeetingCount: 0,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
  ensureExpertStructure(slug);
  writeJson(getExpertMetaPath(slug), meta);
  writeJson(getPortraitSummaryPath(slug), buildExpertSummarySnapshot({ updatedAt: nowIso(), slots: {} }));
  fs.writeFileSync(getPortraitMarkdownPath(slug), buildExpertPromptMarkdown({ coreDomain: [], corePrinciples: [], reasoningFrameworks: [], recentFocusTopics: [], currentHotQuestions: [], terminologySystem: [] }, meta), "utf8");
  return { ok: true, data: buildExpertListItem(meta) };
}

export function loadExpertBySlug(slug) {
  const meta = normalizeExpertMeta(readJsonSafe(getExpertMetaPath(slug), null));
  if (!meta.slug) return null;
  const summary = readJsonSafe(getPortraitSummaryPath(slug), buildExpertSummarySnapshot({ updatedAt: meta.updatedAt, slots: {} }));
  const expertMd = fs.existsSync(getPortraitMarkdownPath(slug))
    ? fs.readFileSync(getPortraitMarkdownPath(slug), "utf8")
    : buildExpertPromptMarkdown(summary, meta);
  const compatibility = buildExpertCompatibilityViews(summary);
  return {
    ...meta,
    summary,
    expertMd,
    role: meta.domain || "",
    impression: meta.description || "",
    personaMd: compatibility.personaMd,
    workMd: compatibility.workMd,
    meeting_count: meta.activeMeetingCount || meta.meetingCount || 0,
    updated_at: meta.updatedAt
  };
}

export function updateExpertNameBySlug(slug, name) {
  const expert = loadExpertBySlug(slug);
  if (!expert) return { ok: false, error: "not_found" };
  const updated = {
    ...normalizeExpertMeta(expert),
    name: String(name || "").trim() || expert.name,
    updatedAt: nowIso()
  };
  writeJson(getExpertMetaPath(slug), updated);
  writeJson(getPortraitSummaryPath(slug), expert.summary || buildExpertSummarySnapshot({ updatedAt: updated.updatedAt, slots: {} }));
  fs.writeFileSync(getPortraitMarkdownPath(slug), buildExpertPromptMarkdown(expert.summary || {}, updated), "utf8");
  return { ok: true, data: { slug, name: updated.name } };
}

export function deleteExpert(slug) {
  const expertDir = getExpertDir(slug);
  if (!fs.existsSync(expertDir)) return { ok: false, error: "not_found" };
  fs.rmSync(expertDir, { recursive: true, force: true });
  return { ok: true };
}

function buildMeetingSummaryMessages({ expert, transcriptText, contextTranscriptText, analysis, isFinal, importanceLevel }) {
  const schemaHint = [
    "{",
    '  "topicTitle": "string",',
    '  "coreDomain": ["string"],',
    '  "recentFocusTopics": ["string"],',
    '  "coreConclusions": ["string"],',
    '  "newKnowledgePoints": ["string"],',
    '  "reasoningFrameworks": ["string"],',
    '  "riskPoints": ["string"],',
    '  "temporaryContext": ["string"],',
    '  "excludedFromLongTerm": ["string"],',
    '  "evidenceSnippets": ["string"]',
    "}"
  ].join("\n");
  return [
    {
      role: "system",
      content: [
        "你是抽象专家知识画像的会议摘要整理 Agent。",
        "当前会议已经手动归属到一个抽象专家知识体。",
        "你不需要区分发言人，只需要把本次会议视为一次专家知识会。",
        "你的任务是输出这次会议的结构化摘要，用于后续记忆抽取和长期画像更新。",
        "必须优先根据当前窗口和本次会议全文来组织摘要。",
        "如果会议里有旧议题背景，只能作为参考，不要让旧议题压过当前会议主主题。",
        "你必须显式给出 coreDomain 和 recentFocusTopics。",
        "coreDomain 用于表达这场会议沉淀出来的核心领域或主题归属，通常 1 到 3 条。",
        "recentFocusTopics 用于表达这场会议当前重点关注的议题，通常 2 到 6 条，应该是短标题，不要整段大句子。",
        "你必须只输出 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `专家名称：${expert.name}`,
        expert.domain ? `专家领域：${expert.domain}` : "",
        `会议重要度：${importanceLevel}`,
        `是否最终批次：${isFinal ? "true" : "false"}`,
        "",
        "=== 会议全文 ===",
        clipText(transcriptText, 16000) || "（空）",
        "",
        "=== 最近上下文 ===",
        clipText(contextTranscriptText, 6000) || "（空）",
        "",
        "=== 当前案例分析结果 ===",
        analysis
          ? JSON.stringify({
              participantsAndViewpointsMd: clipText(analysis.participantsAndViewpointsMd, 2500),
              topicsReportMd: clipText(analysis.topicsReportMd, 3500),
              followUpQuestionsMd: clipText(analysis.followUpQuestionsMd, 2500),
              glossaryMd: clipText(analysis.glossaryMd, 1500)
            }, null, 2)
          : "（无）",
        "",
        "请输出 JSON，结构如下：",
        schemaHint
      ].filter(Boolean).join("\n")
    }
  ];
}

function normalizeMeetingSummary(value, fallbackTranscript = "") {
  if (!value || typeof value !== "object") {
    return {
      topicTitle: clipText(fallbackTranscript, 60) || "未命名会议主题",
      currentWindowPriority: true,
      coreDomain: [],
      recentFocusTopics: [],
      coreConclusions: [],
      newKnowledgePoints: [],
      reasoningFrameworks: [],
      riskPoints: [],
      temporaryContext: [],
      excludedFromLongTerm: [],
      evidenceSnippets: []
    };
  }
  return {
    topicTitle: typeof value.topicTitle === "string" && value.topicTitle.trim() ? value.topicTitle.trim() : clipText(fallbackTranscript, 60) || "未命名会议主题",
    currentWindowPriority: true,
    coreDomain: uniqueStringArray(value.coreDomain).map((item) => normalizeTopicLabel(item, 48)).filter(Boolean).slice(0, 3),
    recentFocusTopics: uniqueStringArray(value.recentFocusTopics).map((item) => normalizeTopicLabel(item, 48)).filter(Boolean).slice(0, 6),
    coreConclusions: uniqueStringArray(value.coreConclusions),
    newKnowledgePoints: uniqueStringArray(value.newKnowledgePoints),
    reasoningFrameworks: uniqueStringArray(value.reasoningFrameworks),
    riskPoints: uniqueStringArray(value.riskPoints),
    temporaryContext: uniqueStringArray(value.temporaryContext),
    excludedFromLongTerm: uniqueStringArray(value.excludedFromLongTerm),
    evidenceSnippets: uniqueStringArray(value.evidenceSnippets).slice(0, 8)
  };
}

async function generateMeetingSummary({ expert, transcriptText, contextTranscriptText, analysis, isFinal, importanceLevel }) {
  const schemaHint = '{"topicTitle":"string","coreDomain":["string"],"recentFocusTopics":["string"],"coreConclusions":["string"],"newKnowledgePoints":["string"],"reasoningFrameworks":["string"],"riskPoints":["string"],"temporaryContext":["string"],"excludedFromLongTerm":["string"],"evidenceSnippets":["string"]}';
  const parsed = await parseModelJson(
    buildMeetingSummaryMessages({ expert, transcriptText, contextTranscriptText, analysis, isFinal, importanceLevel }),
    schemaHint,
    { temperature: 0.2, maxTokens: 2200 }
  );
  if (!parsed.ok) {
    throw new Error(typeof parsed.error === "string" ? parsed.error : "meeting_summary_parse_failed");
  }
  return normalizeMeetingSummary(parsed.value, transcriptText);
}

function buildMemoryExtractionMessages({ expert, meetingSummary, transcriptText }) {
  const slotList = Object.keys(EXPERT_SLOT_CONFIG).join(", ");
  const schemaHint = [
    "{",
    '  "items": [',
    "    {",
    '      "slot": "reasoning_frameworks",',
    '      "value": "string",',
    '      "valueType": "framework",',
    '      "scope": "mid_term",',
    '      "confidence": 0.85,',
    '      "evidence": ["string"],',
    '      "sourceType": "explicit_statement"',
    "    }",
    "  ]",
    "}"
  ].join("\n");
  return [
    {
      role: "system",
      content: [
        "你是抽象专家知识画像的记忆单元抽取 Agent。",
        "你要把会议摘要整理成标准化的记忆单元。",
        "只能抽取对该专家长期或中短期知识体有价值的内容。",
        "不要把纯粹的临时安排、随口确认、无复用价值的病例细节塞进长期知识。",
        "如果某些内容只适合作为短期上下文，也可以放到短期槽位。",
        "注意：core_domain 和 recent_focus_topics 已由摘要结构显式提供，不要重复生成这两个槽位。",
        `slot 只能从以下集合中选：${slotList}。`,
        "scope 只能是 long_term / mid_term / short_term。",
        "valueType 只能是 fact / principle / framework / topic / preference / terminology / risk / temporary_context。",
        "sourceType 只能是 explicit_statement / repeated_pattern / inferred。",
        "confidence 只能是 0 到 1 的数字。",
        "只输出 JSON。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `专家名称：${expert.name}`,
        expert.domain ? `专家领域：${expert.domain}` : "",
        "",
        "=== 会议摘要 ===",
        JSON.stringify(meetingSummary, null, 2),
        "",
        "=== 会议全文摘要片段 ===",
        clipText(transcriptText, 12000) || "（空）",
        "",
        "请输出 JSON，结构如下：",
        schemaHint
      ].join("\n")
    }
  ];
}

function normalizeScope(scope) {
  return ["long_term", "mid_term", "short_term"].includes(scope) ? scope : "mid_term";
}

function normalizeValueType(valueType) {
  return ["fact", "principle", "framework", "topic", "preference", "terminology", "risk", "temporary_context"].includes(valueType)
    ? valueType
    : "fact";
}

function normalizeSourceType(sourceType) {
  return ["explicit_statement", "repeated_pattern", "inferred"].includes(sourceType)
    ? sourceType
    : "explicit_statement";
}

function normalizeTopicLabel(text, maxLength = 42) {
  const value = String(text || "").trim();
  if (!value) return "";
  const firstSegment = value.split(/[：:，,。；;（(]/)[0]?.trim() || value;
  return clipText(firstSegment, maxLength);
}

function buildStructuredMemoryUnitsFromSummary({ expert, meetingId, meetingSummary, transcriptText, importanceLevel }) {
  const items = [];

  for (const domain of uniqueStringArray(meetingSummary?.coreDomain).slice(0, 3)) {
    items.push({
      id: `mem-${meetingId}-${hashText(`core_domain|${domain}`)}`,
      expertSlug: expert.slug,
      meetingId,
      slot: "core_domain",
      value: domain,
      valueType: "topic",
      scope: "long_term",
      weight: computeMemoryWeight({
        importanceLevel,
        transcriptText,
        confidence: 0.9,
        scope: "long_term",
        sourceType: "explicit_statement",
        evidenceCount: 1
      }),
      confidence: 0.9,
      evidence: [meetingSummary?.topicTitle || domain].filter(Boolean),
      sourceType: "explicit_statement",
      status: "active",
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }

  for (const topic of uniqueStringArray(meetingSummary?.recentFocusTopics).slice(0, 6)) {
    items.push({
      id: `mem-${meetingId}-${hashText(`recent_focus_topics|${topic}`)}`,
      expertSlug: expert.slug,
      meetingId,
      slot: "recent_focus_topics",
      value: topic,
      valueType: "topic",
      scope: "mid_term",
      weight: computeMemoryWeight({
        importanceLevel,
        transcriptText,
        confidence: 0.88,
        scope: "mid_term",
        sourceType: "explicit_statement",
        evidenceCount: 1
      }),
      confidence: 0.88,
      evidence: [meetingSummary?.topicTitle || topic].filter(Boolean),
      sourceType: "explicit_statement",
      status: "active",
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }

  return items;
}

function computeMemoryWeight({
  importanceLevel = "medium",
  transcriptText = "",
  confidence = 0.75,
  scope = "mid_term",
  sourceType = "explicit_statement",
  evidenceCount = 1
}) {
  const importanceFactor = { low: 0.8, medium: 1, high: 1.5, critical: 2 }[importanceLevel] || 1;
  const lengthFactor = Math.max(0.8, Math.min(2, Math.log10(Math.max(10, transcriptText.length)) - 1));
  const sourceFactor = { explicit_statement: 1.4, repeated_pattern: 1.2, inferred: 0.7 }[sourceType] || 1;
  const scopeFactor = { long_term: 0.95, mid_term: 1, short_term: 1.05 }[scope] || 1;
  const evidenceFactor = Math.max(0.8, Math.min(1.3, 0.9 + (evidenceCount * 0.08)));
  const confidenceFactor = Math.max(0.5, Math.min(1.2, Number(confidence) || 0.75));
  return Number((importanceFactor * lengthFactor * sourceFactor * scopeFactor * evidenceFactor * confidenceFactor * 3.2).toFixed(2));
}

async function extractMemoryUnits({ expert, meetingId, meetingSummary, transcriptText, importanceLevel }) {
  const schemaHint = '{"items":[{"slot":"reasoning_frameworks","value":"string","valueType":"framework","scope":"mid_term","confidence":0.85,"evidence":["string"],"sourceType":"explicit_statement"}]}';
  const parsed = await parseModelJson(
    buildMemoryExtractionMessages({ expert, meetingSummary, transcriptText }),
    schemaHint,
    { temperature: 0.1, maxTokens: 2600 }
  );
  if (!parsed.ok) {
    throw new Error(typeof parsed.error === "string" ? parsed.error : "memory_units_parse_failed");
  }
  const items = Array.isArray(parsed.value?.items) ? parsed.value.items : [];
  const normalizedItems = items
    .map((item) => {
      const slot = typeof item?.slot === "string" ? item.slot.trim() : "";
      if (slot === "core_domain" || slot === "recent_focus_topics") return null;
      if (!EXPERT_SLOT_CONFIG[slot]) return null;
      const value = typeof item?.value === "string" ? item.value.trim() : "";
      if (!value) return null;
      const scope = normalizeScope(item.scope || EXPERT_SLOT_CONFIG[slot].scope);
      const confidence = Number.isFinite(Number(item.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : 0.75;
      const evidence = uniqueStringArray(item.evidence).slice(0, 4);
      const sourceType = normalizeSourceType(item.sourceType);
      return {
        id: `mem-${meetingId}-${hashText(`${slot}|${value}`)}`,
        expertSlug: expert.slug,
        meetingId,
        slot,
        value,
        valueType: normalizeValueType(item.valueType),
        scope,
        weight: computeMemoryWeight({
          importanceLevel,
          transcriptText,
          confidence,
          scope,
          sourceType,
          evidenceCount: evidence.length
        }),
        confidence,
        evidence,
        sourceType,
        status: "active",
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
    })
    .filter(Boolean);

  return [
    ...buildStructuredMemoryUnitsFromSummary({
      expert,
      meetingId,
      meetingSummary,
      transcriptText,
      importanceLevel
    }),
    ...normalizedItems,
  ];
}

function buildMeetingImagesSnapshot(images = []) {
  return {
    items: (Array.isArray(images) ? images : []).map((item, index) => ({
      id: `img-${index + 1}`,
      time: typeof item?.time === "string" ? item.time : "",
      imageUrl: typeof item?.imageUrl === "string" ? item.imageUrl : ""
    }))
  };
}

function upsertMeetingSnapshotRecord(jsonlPath, records, nextRecords) {
  const kept = records.filter((item) => item.meetingId !== nextRecords.meetingId);
  const payload = [...kept, ...nextRecords.items];
  ensureDir(path.dirname(jsonlPath));
  fs.writeFileSync(jsonlPath, payload.map((item) => JSON.stringify(item)).join("\n") + (payload.length ? "\n" : ""), "utf8");
}

function decayWeight(score, ageDays, tauDays) {
  if (!Number.isFinite(score) || score <= 0) return 0;
  if (!Number.isFinite(ageDays) || ageDays <= 0) return score;
  if (!Number.isFinite(tauDays) || tauDays <= 0) return score;
  return score * Math.exp(-ageDays / tauDays);
}

function computeAgeDays(iso) {
  if (!iso) return 0;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, (Date.now() - time) / (24 * 60 * 60 * 1000));
}

function recomputeAggregatesFromMeetings(expertSlug) {
  const slotMap = {};
  const meetingIds = listMeetingDirs(expertSlug);
  for (const meetingId of meetingIds) {
    const meta = readJsonSafe(getMeetingMetaPath(expertSlug, meetingId), null);
    if (!meta || meta.status === "retracted") continue;
    const extracted = readJsonSafe(getMeetingExtractedMemoriesPath(expertSlug, meetingId), null);
    const items = Array.isArray(extracted?.items) ? extracted.items : [];
    for (const item of items) {
      const config = EXPERT_SLOT_CONFIG[item.slot];
      if (!config || item.status === "retracted") continue;
      const ageDays = computeAgeDays(item.updatedAt || item.createdAt);
      const decayedWeight = decayWeight(Number(item.weight) || 0, ageDays, config.tauDays);
      if (!slotMap[item.slot]) {
        slotMap[item.slot] = {};
      }
      const key = item.value.trim();
      if (!slotMap[item.slot][key]) {
        slotMap[item.slot][key] = {
          value: key,
          score: 0,
          meetingCount: 0,
          lastSeenAt: item.updatedAt || item.createdAt || nowIso(),
          sourceMeetingIds: new Set()
        };
      }
      slotMap[item.slot][key].score += decayedWeight;
      slotMap[item.slot][key].meetingCount += 1;
      slotMap[item.slot][key].sourceMeetingIds.add(item.meetingId);
      if ((item.updatedAt || item.createdAt || "") > slotMap[item.slot][key].lastSeenAt) {
        slotMap[item.slot][key].lastSeenAt = item.updatedAt || item.createdAt || slotMap[item.slot][key].lastSeenAt;
      }
    }
  }

  const slots = {};
  for (const [slotName, candidateMap] of Object.entries(slotMap)) {
    const config = EXPERT_SLOT_CONFIG[slotName];
    const candidateValues = Object.values(candidateMap)
      .map((item) => ({
        value: item.value,
        score: Number(Math.min(item.score, config.historyCap).toFixed(2)),
        meetingCount: item.meetingCount,
        lastSeenAt: item.lastSeenAt,
        sourceMeetingIds: Array.from(item.sourceMeetingIds)
      }))
      .sort((a, b) => b.score - a.score);

    if (!candidateValues.length) continue;
    const total = candidateValues.reduce((sum, item) => sum + item.score, 0);
    const dominant = candidateValues[0];
    const runnerUp = candidateValues[1];
    slots[slotName] = {
      slot: slotName,
      dominantValue: dominant.value,
      dominantScore: dominant.score,
      runnerUpValue: runnerUp?.value || "",
      runnerUpScore: runnerUp?.score || 0,
      confidence: total > 0 ? Number((dominant.score / total).toFixed(2)) : 0,
      lastUpdatedAt: dominant.lastSeenAt,
      sourceMeetingIds: uniqueStringArray(candidateValues.flatMap((item) => item.sourceMeetingIds)),
      candidateValues
    };
  }

  const slotsJson = {
    expertSlug,
    updatedAt: nowIso(),
    slots
  };
  writeJson(getAggregatesPath(expertSlug), slotsJson);
  return slotsJson;
}

function rebuildPortraitFromAggregates(expertSlug) {
  const expert = loadExpertBySlug(expertSlug);
  if (!expert) return null;
  const slotsJson = readJsonSafe(getAggregatesPath(expertSlug), { updatedAt: nowIso(), slots: {} });
  const summary = buildExpertSummarySnapshot(slotsJson);
  summary.sourceMeetingCount = listMeetingDirs(expertSlug)
    .map((meetingId) => readJsonSafe(getMeetingMetaPath(expertSlug, meetingId), null))
    .filter((meta) => meta && meta.status !== "retracted").length;
  writeJson(getPortraitSummaryPath(expertSlug), summary);
  fs.writeFileSync(getPortraitMarkdownPath(expertSlug), buildExpertPromptMarkdown(summary, expert), "utf8");
  const meta = normalizeExpertMeta(readJsonSafe(getExpertMetaPath(expertSlug), expert));
  meta.updatedAt = nowIso();
  meta.activeMeetingCount = summary.sourceMeetingCount;
  meta.meetingCount = listMeetingDirs(expertSlug).length;
  writeJson(getExpertMetaPath(expertSlug), meta);
  return loadExpertBySlug(expertSlug);
}

function appendMemoryHistory(expertSlug, meetingId, items) {
  const historyPath = getMemoryUnitsPath(expertSlug);
  const existing = readJsonl(historyPath).filter((item) => item.meetingId !== meetingId);
  const payload = [...existing, ...items];
  ensureDir(path.dirname(historyPath));
  fs.writeFileSync(historyPath, payload.map((item) => JSON.stringify(item)).join("\n") + (payload.length ? "\n" : ""), "utf8");
}

function rebuildMemoryHistoryFromMeetings(expertSlug) {
  const historyPath = getMemoryUnitsPath(expertSlug);
  const items = listMeetingDirs(expertSlug)
    .map((meetingId) => readJsonSafe(getMeetingExtractedMemoriesPath(expertSlug, meetingId), null))
    .filter(Boolean)
    .flatMap((record) => Array.isArray(record.items) ? record.items : []);
  ensureDir(path.dirname(historyPath));
  fs.writeFileSync(historyPath, items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : ""), "utf8");
}

function appendMeetingEvent(expertSlug, event) {
  appendJsonl(getEventLedgerPath(expertSlug), event);
}

export async function ingestExpertMeetingKnowledge({
  expertSlug,
  meetingId,
  transcriptText,
  contextTranscriptText = "",
  images = [],
  analysis = null,
  importanceLevel = "medium",
  isFinal = false
}) {
  const expert = loadExpertBySlug(expertSlug);
  if (!expert) {
    return { ok: false, error: "expert_not_found" };
  }
  const normalizedMeetingId = String(meetingId || "").trim() || createId("meeting");
  ensureExpertStructure(expertSlug);
  const meetingDir = getMeetingDir(expertSlug, normalizedMeetingId);
  ensureDir(meetingDir);

  const meetingSummary = await generateMeetingSummary({
    expert,
    transcriptText,
    contextTranscriptText,
    analysis,
    isFinal,
    importanceLevel
  });
  const memoryItems = await extractMemoryUnits({
    expert,
    meetingId: normalizedMeetingId,
    meetingSummary,
    transcriptText,
    importanceLevel
  });

  const previousMeta = readJsonSafe(getMeetingMetaPath(expertSlug, normalizedMeetingId), null);
  const meta = {
    meetingId: normalizedMeetingId,
    expertSlug,
    title: meetingSummary.topicTitle,
    sourceType: "screen-capture",
    status: "active",
    startedAt: previousMeta?.startedAt || nowIso(),
    endedAt: nowIso(),
    durationSec: previousMeta?.durationSec || 0,
    transcriptLineCount: transcriptText.split(/\r?\n/).filter(Boolean).length,
    imageCount: Array.isArray(images) ? images.length : 0,
    importanceLevel,
    ingestEventId: createId("evt")
  };

  writeJson(getMeetingMetaPath(expertSlug, normalizedMeetingId), meta);
  fs.writeFileSync(getMeetingTranscriptPath(expertSlug, normalizedMeetingId), transcriptText || "", "utf8");
  writeJson(getMeetingImagesPath(expertSlug, normalizedMeetingId), buildMeetingImagesSnapshot(images));
  writeJson(getMeetingSummaryPath(expertSlug, normalizedMeetingId), {
    meetingId: normalizedMeetingId,
    expertSlug,
    ...meetingSummary,
    createdAt: nowIso()
  });
  writeJson(getMeetingExtractedMemoriesPath(expertSlug, normalizedMeetingId), {
    meetingId: normalizedMeetingId,
    expertSlug,
    items: memoryItems,
    count: memoryItems.length,
    createdAt: nowIso()
  });

  appendMemoryHistory(expertSlug, normalizedMeetingId, memoryItems);
  appendMeetingEvent(expertSlug, {
    eventId: meta.ingestEventId,
    type: previousMeta ? "meeting_refresh" : "meeting_ingest",
    status: "active",
    expertSlug,
    meetingId: normalizedMeetingId,
    memoryUnitIds: memoryItems.map((item) => item.id),
    slotImpacts: memoryItems.map((item) => ({ slot: item.slot, value: item.value, weight: item.weight })),
    createdAt: nowIso()
  });

  const slotsJson = recomputeAggregatesFromMeetings(expertSlug);
  const updatedExpert = rebuildPortraitFromAggregates(expertSlug);
  return {
    ok: true,
    data: {
      expert: updatedExpert,
      meeting: {
        meetingId: normalizedMeetingId,
        title: meetingSummary.topicTitle,
        summary: meetingSummary
      },
      memoryUnitCount: memoryItems.length,
      aggregates: slotsJson
    }
  };
}

export function listExpertMeetings(expertSlug) {
  return listMeetingDirs(expertSlug)
    .map((meetingId) => {
      const meta = readJsonSafe(getMeetingMetaPath(expertSlug, meetingId), null);
      const summary = readJsonSafe(getMeetingSummaryPath(expertSlug, meetingId), null);
      if (!meta) return null;
      return {
        meetingId,
        title: meta.title || summary?.topicTitle || meetingId,
        status: meta.status || "active",
        importanceLevel: meta.importanceLevel || "medium",
        endedAt: meta.endedAt || meta.updatedAt || "",
        transcriptLineCount: meta.transcriptLineCount || 0
      };
    })
    .filter(Boolean);
}

export function loadExpertMeetingDetail(expertSlug, meetingId) {
  const meta = readJsonSafe(getMeetingMetaPath(expertSlug, meetingId), null);
  if (!meta) return null;
  const summary = readJsonSafe(getMeetingSummaryPath(expertSlug, meetingId), null);
  const extracted = readJsonSafe(getMeetingExtractedMemoriesPath(expertSlug, meetingId), null);
  const transcriptText = fs.existsSync(getMeetingTranscriptPath(expertSlug, meetingId))
    ? fs.readFileSync(getMeetingTranscriptPath(expertSlug, meetingId), "utf8")
    : "";

  return {
    meetingId,
    title: meta.title || summary?.topicTitle || meetingId,
    status: meta.status || "active",
    importanceLevel: meta.importanceLevel || "medium",
    startedAt: meta.startedAt || "",
    endedAt: meta.endedAt || meta.updatedAt || "",
    transcriptLineCount: meta.transcriptLineCount || 0,
    imageCount: meta.imageCount || 0,
    summary: summary
      ? {
          topicTitle: summary.topicTitle || "",
          coreConclusions: uniqueStringArray(summary.coreConclusions).slice(0, 5),
          newKnowledgePoints: uniqueStringArray(summary.newKnowledgePoints).slice(0, 5),
          reasoningFrameworks: uniqueStringArray(summary.reasoningFrameworks).slice(0, 4),
          riskPoints: uniqueStringArray(summary.riskPoints).slice(0, 4),
          evidenceSnippets: uniqueStringArray(summary.evidenceSnippets).slice(0, 4)
        }
      : null,
    memoryUnitCount: Array.isArray(extracted?.items) ? extracted.items.length : 0,
    transcriptPreview: transcriptText
      ? transcriptText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(-8)
      : []
  };
}

export function retractExpertMeeting({ expertSlug, meetingId, reason = "" }) {
  const metaPath = getMeetingMetaPath(expertSlug, meetingId);
  const meta = readJsonSafe(metaPath, null);
  if (!meta) return { ok: false, error: "meeting_not_found" };
  meta.status = "retracted";
  meta.updatedAt = nowIso();
  writeJson(metaPath, meta);
  appendMeetingEvent(expertSlug, {
    eventId: createId("evt"),
    type: "meeting_retract",
    status: "active",
    expertSlug,
    meetingId,
    reason: String(reason || "").trim(),
    createdAt: nowIso()
  });
  recomputeAggregatesFromMeetings(expertSlug);
  const updatedExpert = rebuildPortraitFromAggregates(expertSlug);
  return { ok: true, data: { expert: updatedExpert, meetingId } };
}

export function deleteExpertMeeting({ expertSlug, meetingId, reason = "" }) {
  const meetingDir = getMeetingDir(expertSlug, meetingId);
  const meta = readJsonSafe(getMeetingMetaPath(expertSlug, meetingId), null);
  if (!meta || !fs.existsSync(meetingDir)) {
    return { ok: false, error: "meeting_not_found" };
  }
  fs.rmSync(meetingDir, { recursive: true, force: true });
  appendMeetingEvent(expertSlug, {
    eventId: createId("evt"),
    type: "meeting_delete",
    status: "deleted",
    expertSlug,
    meetingId,
    reason: String(reason || "").trim(),
    createdAt: nowIso()
  });
  recomputeAggregatesFromMeetings(expertSlug);
  const updatedExpert = rebuildPortraitFromAggregates(expertSlug);
  return { ok: true, data: { expert: updatedExpert, meetingId } };
}

export function moveMeetingToExpert({ meetingId, fromExpertSlug, toExpertSlug, reason = "" }) {
  const sourceMeta = readJsonSafe(getMeetingMetaPath(fromExpertSlug, meetingId), null);
  const targetExpert = loadExpertBySlug(toExpertSlug);
  if (!sourceMeta) return { ok: false, error: "meeting_not_found" };
  if (!targetExpert) return { ok: false, error: "target_expert_not_found" };

  const fromMeetingDir = getMeetingDir(fromExpertSlug, meetingId);
  const toMeetingDir = getMeetingDir(toExpertSlug, meetingId);
  ensureExpertStructure(toExpertSlug);
  if (fs.existsSync(toMeetingDir)) {
    removePathRecursiveSync(toMeetingDir);
  }
  copyPathRecursiveSync(fromMeetingDir, toMeetingDir);
  const targetMeta = readJsonSafe(getMeetingMetaPath(toExpertSlug, meetingId), sourceMeta);
  targetMeta.expertSlug = toExpertSlug;
  targetMeta.status = "active";
  targetMeta.updatedAt = nowIso();
  writeJson(getMeetingMetaPath(toExpertSlug, meetingId), targetMeta);
  const targetSummary = readJsonSafe(getMeetingSummaryPath(toExpertSlug, meetingId), null);
  if (targetSummary) {
    targetSummary.expertSlug = toExpertSlug;
    writeJson(getMeetingSummaryPath(toExpertSlug, meetingId), targetSummary);
  }
  const extracted = readJsonSafe(getMeetingExtractedMemoriesPath(toExpertSlug, meetingId), null);
  if (extracted && Array.isArray(extracted.items)) {
    extracted.expertSlug = toExpertSlug;
    extracted.items = extracted.items.map((item) => ({
      ...item,
      id: createId("mem"),
      expertSlug: toExpertSlug,
      createdAt: nowIso(),
      updatedAt: nowIso()
    }));
    writeJson(getMeetingExtractedMemoriesPath(toExpertSlug, meetingId), extracted);
    appendMemoryHistory(toExpertSlug, meetingId, extracted.items);
  }

  appendMeetingEvent(fromExpertSlug, {
    eventId: createId("evt"),
    type: "meeting_move",
    status: "moved",
    fromExpertSlug,
    toExpertSlug,
    meetingId,
    reason: String(reason || "").trim(),
    createdAt: nowIso()
  });
  const retractResult = retractExpertMeeting({ expertSlug: fromExpertSlug, meetingId, reason: reason || "meeting_moved" });
  appendMeetingEvent(toExpertSlug, {
    eventId: createId("evt"),
    type: "meeting_ingest",
    status: "active",
    expertSlug: toExpertSlug,
    meetingId,
    reason: `moved_from:${fromExpertSlug}`,
    createdAt: nowIso()
  });
  recomputeAggregatesFromMeetings(toExpertSlug);
  const targetUpdatedExpert = rebuildPortraitFromAggregates(toExpertSlug);
  return {
    ok: true,
    data: {
      fromExpert: retractResult.ok ? retractResult.data.expert : null,
      toExpert: targetUpdatedExpert,
      meetingId
    }
  };
}

async function selectRelevantMeetingsWithModel(question, candidates) {
  if (candidates.length <= MAX_SUMMARY_MEETINGS) {
    return candidates.map((item) => item.meetingId);
  }
  const schemaHint = '{"meetingIds":["meeting-xxx"]}';
  const parsed = await parseModelJson(
    [
      {
        role: "system",
        content: [
          "你是专家知识问答的会议摘要选择器。",
          `请从候选会议中选择最适合回答问题的 ${MAX_SUMMARY_MEETINGS} 场以内会议。`,
          "只输出 JSON。"
        ].join("\n")
      },
      {
        role: "user",
        content: [
          `用户问题：${question}`,
          "",
          "=== 候选会议摘要 ===",
          JSON.stringify(candidates.map((item) => ({
            meetingId: item.meetingId,
            title: item.topicTitle,
            coreConclusions: item.coreConclusions,
            newKnowledgePoints: item.newKnowledgePoints
          })), null, 2),
          "",
          `请返回最相关的 ${MAX_SUMMARY_MEETINGS} 个 meetingId。`
        ].join("\n")
      }
    ],
    schemaHint,
    { temperature: 0, maxTokens: 1000 }
  );
  if (!parsed.ok) {
    return candidates.slice(0, MAX_SUMMARY_MEETINGS).map((item) => item.meetingId);
  }
  const meetingIds = uniqueStringArray(parsed.value?.meetingIds).slice(0, MAX_SUMMARY_MEETINGS);
  return meetingIds.length ? meetingIds : candidates.slice(0, MAX_SUMMARY_MEETINGS).map((item) => item.meetingId);
}

export async function buildExpertQaContext(expertSlug, question) {
  const expert = loadExpertBySlug(expertSlug);
  if (!expert) return { ok: false, error: "expert_not_found" };
  const meetingCandidates = listMeetingDirs(expertSlug)
    .map((meetingId) => ({
      meetingId,
      meta: readJsonSafe(getMeetingMetaPath(expertSlug, meetingId), null),
      summary: readJsonSafe(getMeetingSummaryPath(expertSlug, meetingId), null)
    }))
    .filter((item) => item.meta && item.summary && item.meta.status !== "retracted")
    .sort((a, b) => String(b.meta.endedAt || "").localeCompare(String(a.meta.endedAt || "")))
    .map((item) => ({
      meetingId: item.meetingId,
      topicTitle: item.summary.topicTitle,
      coreConclusions: item.summary.coreConclusions || [],
      newKnowledgePoints: item.summary.newKnowledgePoints || [],
      evidenceSnippets: item.summary.evidenceSnippets || []
    }));

  const selectedMeetingIds = await selectRelevantMeetingsWithModel(question, meetingCandidates);
  const selectedSummaries = meetingCandidates.filter((item) => selectedMeetingIds.includes(item.meetingId));
  const context = {
    expertSlug,
    questionType: "expert_qa",
    portraitContext: {
      coreDomain: expert.summary?.coreDomain || [],
      corePrinciples: expert.summary?.corePrinciples || [],
      reasoningFrameworks: expert.summary?.reasoningFrameworks || [],
      recentFocusTopics: expert.summary?.recentFocusTopics || []
    },
    relatedMeetingSummaries: selectedSummaries.map((item) => ({
      meetingId: item.meetingId,
      topicTitle: item.topicTitle,
      coreConclusions: item.coreConclusions
    })),
    evidenceSnippets: uniqueStringArray(selectedSummaries.flatMap((item) => item.evidenceSnippets || [])).slice(0, 8),
    assembledAt: nowIso()
  };
  return { ok: true, data: context };
}

export function repairExpertStoredKnowledge(expertSlug) {
  const expert = loadExpertBySlug(expertSlug);
  if (!expert) return { ok: false, error: "expert_not_found" };

  let repairedMeetings = 0;
  for (const meetingId of listMeetingDirs(expertSlug)) {
    const summary = readJsonSafe(getMeetingSummaryPath(expertSlug, meetingId), null);
    const extracted = readJsonSafe(getMeetingExtractedMemoriesPath(expertSlug, meetingId), null);
    const transcriptText = fs.existsSync(getMeetingTranscriptPath(expertSlug, meetingId))
      ? fs.readFileSync(getMeetingTranscriptPath(expertSlug, meetingId), "utf8")
      : "";
    const meta = readJsonSafe(getMeetingMetaPath(expertSlug, meetingId), null);
    if (!summary || !extracted || !Array.isArray(extracted.items)) continue;

    const structuredItems = buildStructuredMemoryUnitsFromSummary({
      expert,
      meetingId,
      meetingSummary: summary,
      transcriptText,
      importanceLevel: meta?.importanceLevel || "medium"
    });
    const existingStructuredKeys = new Set(
      extracted.items
        .filter((item) => item?.slot === "core_domain" || item?.slot === "recent_focus_topics")
        .map((item) => `${item.slot}|${item.value}`)
    );
    const nextStructuredItems = structuredItems.filter((item) => !existingStructuredKeys.has(`${item.slot}|${item.value}`));

    if (nextStructuredItems.length === 0) continue;
    extracted.items = [...extracted.items, ...nextStructuredItems];
    extracted.count = extracted.items.length;
    writeJson(getMeetingExtractedMemoriesPath(expertSlug, meetingId), extracted);
    repairedMeetings += 1;
  }

  rebuildMemoryHistoryFromMeetings(expertSlug);
  recomputeAggregatesFromMeetings(expertSlug);
  const updatedExpert = rebuildPortraitFromAggregates(expertSlug);
  return {
    ok: true,
    data: {
      expert: updatedExpert,
      repairedMeetings
    }
  };
}
