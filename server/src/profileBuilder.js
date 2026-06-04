import fs from "node:fs";
import path from "node:path";
import { createQwenClient, getQwenConfig } from "./qwenClient.js";
import { extractLikelyJsonObject, safeJsonParse } from "./json.js";
import {
  buildProfileAnalysisMessages,
  buildProfileMergeMessages,
  buildPersonaProfileFromAnalysisMessages,
  buildWorkProfileFromAnalysisMessages,
  buildSpeakerGuessMessages,
  PROFILE_SCHEMA
} from "./profilePrompts.js";

const PROFILES_DIR_NAME = "profiles";

function getProfilesRoot() {
  return path.resolve(process.cwd(), "..", "screen-catch", "data", PROFILES_DIR_NAME);
}

function getProfileDir(slug) {
  return path.join(getProfilesRoot(), slug);
}

function getProfilePath(slug) {
  return path.join(getProfileDir(slug), "meta.json");
}

function slugify(name, speakerLabel) {
  if (speakerLabel) {
    return speakerLabel.replace(/[^\w\u4e00-\u9fff]/g, "-").toLowerCase().slice(0, 60);
  }
  const slug = name
    .toLowerCase()
    .replace(/[\s]+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]/g, "")
    .slice(0, 60);
  return slug || `profile-${Date.now()}`;
}

function ensureProfilesDir() {
  const root = getProfilesRoot();
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
}

function extractSpeakerLines(transcriptText, speakerLabel) {
  const lines = transcriptText.split("\n");
  return lines
    .filter(line => {
      const match = line.match(/\[([^\]]+)\]\s*\[([^\]]+)\]/);
      if (match) return match[2] === speakerLabel;
      const simpleMatch = line.match(/\[([^\]]+)\]/);
      if (simpleMatch) return simpleMatch[1] === speakerLabel;
      return false;
    })
    .join("\n");
}

function extractAllSpeakers(transcriptText) {
  const speakers = new Set();
  const lines = transcriptText.split("\n");
  for (const line of lines) {
    const match = line.match(/\[([^\]]+)\]\s*\[([^\]]+)\]/);
    if (match) {
      speakers.add(match[2]);
    } else {
      const simpleMatch = line.match(/\[([^\]]+)\]/);
      if (simpleMatch && (simpleMatch[1].startsWith("发言人") || simpleMatch[1] === "未知发言人")) {
        speakers.add(simpleMatch[1]);
      }
    }
  }
  return [...speakers].sort((a, b) => {
    const numA = parseInt(a.replace("发言人", ""), 10);
    const numB = parseInt(b.replace("发言人", ""), 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });
}

async function completeProfileJson(messages) {
  const client = createQwenClient();
  const { model, enableThinking, maxTokens } = getQwenConfig();

  const resp = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.2,
    max_tokens: Math.max(maxTokens, 8192),
    response_format: { type: "json_object" },
    extra_body: { enable_thinking: enableThinking }
  });

  const content = resp.choices?.[0]?.message?.content ?? "";
  if (!content) {
    console.error("[profile] completeProfileJson: empty response");
  }
  return content;
}

function validateProfileShape(obj) {
  if (!obj || typeof obj !== "object") return { ok: false, error: "not_object" };
  obj.name = typeof obj.name === "string" ? obj.name : "";
  obj.role = typeof obj.role === "string" ? obj.role : "";
  obj.personaMd = typeof obj.personaMd === "string" ? obj.personaMd : "";
  obj.workMd = typeof obj.workMd === "string" ? obj.workMd : "";
  obj.impression = typeof obj.impression === "string" ? obj.impression : "";
  if (!obj.tags) obj.tags = { personality: [], culture: [] };
  if (!Array.isArray(obj.tags.personality)) obj.tags.personality = [];
  if (!Array.isArray(obj.tags.culture)) obj.tags.culture = [];
  return { ok: true };
}

function parseProfileJson(raw) {
  let extracted = extractLikelyJsonObject(raw) ?? raw;
  let parsed = safeJsonParse(extracted);

  if (!parsed.ok) {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    extracted = extractLikelyJsonObject(cleaned) ?? cleaned;
    parsed = safeJsonParse(extracted);
  }

  if (parsed.ok) {
    const shape = validateProfileShape(parsed.value);
    if (shape.ok) return { ok: true, value: parsed.value };
    return { ok: false, error: shape.error };
  }

  return { ok: false, error: parsed.error };
}

export async function buildProfileForSpeaker(speakerLabel, transcriptText, screenshotCount = 0) {
  const speakerLines = extractSpeakerLines(transcriptText, speakerLabel);
  if (!speakerLines.trim()) {
    console.log(`[profile] buildProfileForSpeaker: ${speakerLabel} has no speech data`);
    return { ok: false, error: "no_speech_data" };
  }

  console.log(`[profile] buildProfileForSpeaker: ${speakerLabel}, lines=${speakerLines.split("\n").length}`);
  const messages = buildProfileAnalysisMessages(speakerLabel, speakerLines, screenshotCount);
  const raw = await completeProfileJson(messages);
  console.log(`[profile] buildProfileForSpeaker: ${speakerLabel}, response length=${raw?.length || 0}`);
  const result = parseProfileJson(raw);

  if (!result.ok) {
    console.error("[profile] parseProfileJson failed:", result.error?.message || result.error);
    console.error("[profile] raw response (first 500 chars):", raw?.slice(0, 500));
    return { ok: false, error: result.error?.message || String(result.error), raw };
  }

  const profile = result.value;
  const slug = slugify(profile.name || speakerLabel, speakerLabel);

  ensureProfilesDir();
  const profileDir = getProfileDir(slug);
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  const meta = {
    name: profile.name,
    slug,
    speakerLabel,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    version: "v1",
    profile: {
      role: profile.role
    },
    tags: profile.tags,
    impression: profile.impression,
    meeting_count: 1,
    corrections_count: 0
  };

  fs.writeFileSync(path.join(profileDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
    fs.writeFileSync(path.join(profileDir, "persona.txt"), profile.personaMd, "utf8");
    fs.writeFileSync(path.join(profileDir, "work.txt"), profile.workMd, "utf8");

  return {
    ok: true,
    data: {
      slug,
      speakerLabel,
      name: profile.name,
      role: profile.role,
      personaMd: profile.personaMd,
      workMd: profile.workMd,
      tags: profile.tags,
      impression: profile.impression
    }
  };
}

export async function mergeProfileForSpeaker(speakerLabel, transcriptText, screenshotCount = 0) {
  const existingProfile = loadProfileBySpeaker(speakerLabel);
  if (!existingProfile) {
    return buildProfileForSpeaker(speakerLabel, transcriptText, screenshotCount);
  }

  const speakerLines = extractSpeakerLines(transcriptText, speakerLabel);
  if (!speakerLines.trim()) {
    return { ok: true, data: existingProfile, merged: false };
  }

  const messages = buildProfileMergeMessages(
    speakerLabel,
    { personaMd: existingProfile.personaMd, workMd: existingProfile.workMd },
    speakerLines,
    screenshotCount
  );

  const raw = await completeProfileJson(messages);
  const result = parseProfileJson(raw);

  if (!result.ok) {
    console.error("[profile] merge parseProfileJson failed:", result.error?.message || result.error);
    console.error("[profile] merge raw response (first 500 chars):", raw?.slice(0, 500));
    return { ok: false, error: result.error?.message || String(result.error), raw };
  }

  const profile = result.value;
  const slug = existingProfile.slug;
  const profileDir = getProfileDir(slug);
  let mergedPersonaMd = profile.personaMd?.trim() ? profile.personaMd : existingProfile.personaMd;
  let mergedWorkMd = profile.workMd?.trim() ? profile.workMd : existingProfile.workMd;
  const mergedTags = {
    personality: Array.isArray(profile.tags?.personality) && profile.tags.personality.length > 0
      ? profile.tags.personality
      : (existingProfile.tags?.personality || []),
    culture: Array.isArray(profile.tags?.culture) && profile.tags.culture.length > 0
      ? profile.tags.culture
      : (existingProfile.tags?.culture || [])
  };
  const contentChanged =
    mergedPersonaMd.trim() !== (existingProfile.personaMd || "").trim() ||
    mergedWorkMd.trim() !== (existingProfile.workMd || "").trim();
  const metaChanged =
    (profile.name || existingProfile.name) !== existingProfile.name ||
    (profile.role || existingProfile.profile?.role || "") !== (existingProfile.profile?.role || "") ||
    JSON.stringify(mergedTags) !== JSON.stringify(existingProfile.tags || { personality: [], culture: [] }) ||
    (profile.impression || existingProfile.impression || "") !== (existingProfile.impression || "");

  const meta = {
    ...existingProfile,
    name: profile.name || existingProfile.name,
    updated_at: new Date().toISOString(),
    profile: {
      ...existingProfile.profile,
      role: profile.role || existingProfile.profile?.role
    },
    tags: mergedTags,
    impression: profile.impression || existingProfile.impression,
    meeting_count: (existingProfile.meeting_count || 0) + ((contentChanged || metaChanged) ? 1 : 0)
  };

  fs.writeFileSync(path.join(profileDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  fs.writeFileSync(path.join(profileDir, "persona.txt"), mergedPersonaMd, "utf8");
  fs.writeFileSync(path.join(profileDir, "work.txt"), mergedWorkMd, "utf8");
  console.log(`[profile] ${speakerLabel} contentChanged=${contentChanged} metaChanged=${metaChanged} meeting_count=${meta.meeting_count}`);

  return {
    ok: true,
    merged: contentChanged || metaChanged,
    data: {
      slug,
      speakerLabel,
      name: profile.name || existingProfile.name,
      role: profile.role || existingProfile.profile?.role,
      personaMd: mergedPersonaMd,
      workMd: mergedWorkMd,
      tags: mergedTags,
      impression: profile.impression || existingProfile.impression
    }
  };
}

export async function upsertWorkProfileFromAnalysis(
  speakerLabel,
  analysis,
  transcriptText = "",
  screenshotCount = 0
) {
  const existingProfile = loadProfileBySpeaker(speakerLabel);
  const speakerLines = extractSpeakerLines(transcriptText, speakerLabel);
  const personaMessages = buildPersonaProfileFromAnalysisMessages({
    speakerLabel,
    existingProfile,
    analysis,
    newTranscriptText: speakerLines
  });
  const workMessages = buildWorkProfileFromAnalysisMessages({
    speakerLabel,
    existingProfile,
    analysis,
    newTranscriptText: speakerLines
  });

  const [personaRaw, workRaw] = await Promise.all([
    completeProfileJson(personaMessages),
    completeProfileJson(workMessages)
  ]);
  const personaResult = parseProfileJson(personaRaw);
  const workResult = parseProfileJson(workRaw);

  if (!personaResult.ok || !workResult.ok) {
    if (!personaResult.ok) {
      console.error("[profile] persona parseProfileJson failed:", personaResult.error?.message || personaResult.error);
      console.error("[profile] persona raw response (first 500 chars):", personaRaw?.slice(0, 500));
    }
    if (!workResult.ok) {
      console.error("[profile] work parseProfileJson failed:", workResult.error?.message || workResult.error);
      console.error("[profile] work raw response (first 500 chars):", workRaw?.slice(0, 500));
    }
    return {
      ok: false,
      error: personaResult.error?.message || workResult.error?.message || "profile_parse_failed",
      raw: {
        personaRaw,
        workRaw
      }
    };
  }

  const personaProfile = personaResult.value;
  const workProfile = workResult.value;
  const mergedTags = {
    personality: Array.from(new Set([
      ...(existingProfile?.tags?.personality || []),
      ...(personaProfile.tags?.personality || []),
      ...(workProfile.tags?.personality || [])
    ])),
    culture: Array.from(new Set([
      ...(existingProfile?.tags?.culture || []),
      ...(personaProfile.tags?.culture || []),
      ...(workProfile.tags?.culture || [])
    ]))
  };
  const profile = {
    name: personaProfile.name || workProfile.name || existingProfile?.name || speakerLabel,
    role: personaProfile.role || workProfile.role || existingProfile?.profile?.role || "",
    personaMd: personaProfile.personaMd || existingProfile?.personaMd || "",
    workMd: workProfile.workMd || existingProfile?.workMd || "",
    tags: mergedTags,
    impression: personaProfile.impression || workProfile.impression || existingProfile?.impression || ""
  };

  // ==============================
  // 防御性检查：防止内容被意外清空
  // ==============================
  let finalPersonaMd = profile.personaMd || "";
  let finalWorkMd = profile.workMd || "";
  let contentWasProtected = false;

  // ==============================
  // 合并清理：防止重复的 Layer/章节标题
  // ==============================
  function cleanDuplicateSections(content, sectionPatterns, existingContent) {
    if (!content || !existingContent) return content;
    
    let cleaned = content;
    // 检查并移除重复的标题
    for (const pattern of sectionPatterns) {
      const regex = new RegExp(`^${pattern}\\s*$`, 'gm');
      const matches = [...cleaned.matchAll(regex)];
      if (matches.length > 1) {
        // 保留第一个标题，后面的都移除
        // 这里简单处理：如果发现重复，直接用旧内容（更安全）
        console.log(`[profile] 检测到重复的标题: ${pattern}，保留旧内容`);
        return existingContent;
      }
    }
    return cleaned;
  }

  // Persona 的 Layer 标题
  const personaSections = [
    "## Layer 0：核心性格",
    "## Layer 1：身份",
    "## Layer 2：表达风格",
    "## Layer 3：决策与判断",
    "## Layer 4：人际行为",
    "## Layer 5：边界与雷区"
  ];
  // Work 的章节标题
  const workSections = [
    "## 职责范围",
    "## 技术规范",
    "## 工作流程",
    "## 经验知识库"
  ];

  if (existingProfile) {
    // 检查Persona：如果新内容比旧内容少很多，保留旧内容
    if (existingProfile.personaMd?.trim().length > 50 && 
        finalPersonaMd.trim().length < existingProfile.personaMd.trim().length * 0.5) {
      console.log(`[profile] ${speakerLabel} Persona内容减少超过50%，保留旧内容 (旧:${existingProfile.personaMd.length} 新:${finalPersonaMd.length})`);
      finalPersonaMd = existingProfile.personaMd;
      contentWasProtected = true;
    }

    // 检查Work：如果新内容比旧内容少很多，保留旧内容
    if (existingProfile.workMd?.trim().length > 50 && 
        finalWorkMd.trim().length < existingProfile.workMd.trim().length * 0.5) {
      console.log(`[profile] ${speakerLabel} Work内容减少超过50%，保留旧内容 (旧:${existingProfile.workMd.length} 新:${finalWorkMd.length})`);
      finalWorkMd = existingProfile.workMd;
      contentWasProtected = true;
    }

    // 检查是否包含"数据不足"之类的空内容标记
    if (existingProfile.personaMd?.trim().length > 50 && 
        (finalPersonaMd.includes("（原材料不足）") || finalPersonaMd.includes("（数据不足）") || finalPersonaMd.trim().length === 0)) {
      console.log(`[profile] ${speakerLabel} Persona被标记为数据不足，保留旧内容`);
      finalPersonaMd = existingProfile.personaMd;
      contentWasProtected = true;
    }
    if (existingProfile.workMd?.trim().length > 50 && 
        (finalWorkMd.includes("（原材料不足）") || finalWorkMd.includes("（数据不足）") || finalWorkMd.trim().length === 0)) {
      console.log(`[profile] ${speakerLabel} Work被标记为数据不足，保留旧内容`);
      finalWorkMd = existingProfile.workMd;
      contentWasProtected = true;
    }

    // 检查重复标题并清理
    if (!contentWasProtected) {
      const cleanedPersona = cleanDuplicateSections(finalPersonaMd, personaSections, existingProfile.personaMd);
      const cleanedWork = cleanDuplicateSections(finalWorkMd, workSections, existingProfile.workMd);
      
      if (cleanedPersona !== finalPersonaMd) {
        finalPersonaMd = cleanedPersona;
        contentWasProtected = true;
      }
      if (cleanedWork !== finalWorkMd) {
        finalWorkMd = cleanedWork;
        contentWasProtected = true;
      }
    }
  }

  if (!existingProfile) {
    const slug = slugify(profile.name || speakerLabel, speakerLabel);
    ensureProfilesDir();
    const profileDir = getProfileDir(slug);
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }

    const meta = {
      name: profile.name || speakerLabel,
      slug,
      speakerLabel,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: "v1",
      profile: {
        role: profile.role || ""
      },
      tags: profile.tags || { personality: [], culture: [] },
      impression: profile.impression || "",
      meeting_count: (finalPersonaMd.trim() || finalWorkMd.trim()) ? 1 : 0,
      corrections_count: 0
    };

    fs.writeFileSync(path.join(profileDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
    fs.writeFileSync(path.join(profileDir, "persona.txt"), finalPersonaMd, "utf8");
    fs.writeFileSync(path.join(profileDir, "work.txt"), finalWorkMd, "utf8");
    console.log(`[profile] ${speakerLabel} created personaLen=${finalPersonaMd.length} workLen=${finalWorkMd.length}`);

    return {
      ok: true,
      merged: Boolean(finalPersonaMd.trim() || finalWorkMd.trim()),
      data: {
        slug,
        speakerLabel,
        name: profile.name || speakerLabel,
        role: profile.role || "",
        personaMd: finalPersonaMd,
        workMd: finalWorkMd,
        tags: profile.tags || { personality: [], culture: [] },
        impression: profile.impression || ""
      }
    };
  }

  const slug = existingProfile.slug;
  const profileDir = getProfileDir(slug);
  const personaChanged = finalPersonaMd.trim() !== (existingProfile.personaMd || "").trim();
  const workChanged = finalWorkMd.trim() !== (existingProfile.workMd || "").trim();
  const metaChanged =
    (profile.name || existingProfile.name) !== existingProfile.name ||
    (profile.role || existingProfile.profile?.role || "") !== (existingProfile.profile?.role || "") ||
    (profile.impression || existingProfile.impression || "") !== (existingProfile.impression || "");

  const meta = {
    ...existingProfile,
    name: profile.name || existingProfile.name,
    updated_at: new Date().toISOString(),
    profile: {
      ...existingProfile.profile,
      role: profile.role || existingProfile.profile?.role
    },
    tags: profile.tags || existingProfile.tags,
    impression: profile.impression || existingProfile.impression,
    meeting_count: (existingProfile.meeting_count || 0) + ((workChanged || personaChanged || metaChanged) ? 1 : 0)
  };

  fs.writeFileSync(path.join(profileDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  fs.writeFileSync(path.join(profileDir, "persona.txt"), finalPersonaMd, "utf8");
  fs.writeFileSync(path.join(profileDir, "work.txt"), finalWorkMd, "utf8");
  console.log(`[profile] ${speakerLabel} personaChanged=${personaChanged} workChanged=${workChanged} metaChanged=${metaChanged} contentProtected=${contentWasProtected} meeting_count=${meta.meeting_count}`);

  return {
    ok: true,
    merged: workChanged || personaChanged || metaChanged,
    data: {
      slug,
      speakerLabel,
      name: profile.name || existingProfile.name,
      role: profile.role || existingProfile.profile?.role,
      personaMd: finalPersonaMd,
      workMd: finalWorkMd,
      tags: profile.tags || existingProfile.tags,
      impression: profile.impression || existingProfile.impression
    }
  };
}

export function loadProfileBySpeaker(speakerLabel) {
  ensureProfilesDir();
  const root = getProfilesRoot();
  try {
    const dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const d of dirs) {
      const metaPath = path.join(root, d.name, "meta.json");
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
          if (meta.speakerLabel === speakerLabel) {
            // 先尝试读取 .txt，没有的话回退到 .md（兼容旧数据）
            let personaPath = path.join(root, d.name, "persona.txt");
            let workPath = path.join(root, d.name, "work.txt");
            if (!fs.existsSync(personaPath)) personaPath = path.join(root, d.name, "persona.md");
            if (!fs.existsSync(workPath)) workPath = path.join(root, d.name, "work.md");
            
            return {
              ...meta,
              personaMd: fs.existsSync(personaPath) ? fs.readFileSync(personaPath, "utf8") : "",
              workMd: fs.existsSync(workPath) ? fs.readFileSync(workPath, "utf8") : ""
            };
          }
        } catch {}
      }
    }
  } catch {}
  return null;
}

export function loadProfileBySlug(slug) {
  ensureProfilesDir();
  const profileDir = getProfileDir(slug);
  const metaPath = path.join(profileDir, "meta.json");

  if (!fs.existsSync(metaPath)) return null;

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    // 先尝试读取 .txt，没有的话回退到 .md（兼容旧数据）
    let personaPath = path.join(profileDir, "persona.txt");
    let workPath = path.join(profileDir, "work.txt");
    if (!fs.existsSync(personaPath)) personaPath = path.join(profileDir, "persona.md");
    if (!fs.existsSync(workPath)) workPath = path.join(profileDir, "work.md");
    
    return {
      ...meta,
      personaMd: fs.existsSync(personaPath) ? fs.readFileSync(personaPath, "utf8") : "",
      workMd: fs.existsSync(workPath) ? fs.readFileSync(workPath, "utf8") : ""
    };
  } catch {
    return null;
  }
}

export function listProfiles() {
  ensureProfilesDir();
  const root = getProfilesRoot();
  const profiles = [];

  try {
    const dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const d of dirs) {
      const metaPath = path.join(root, d.name, "meta.json");
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
          profiles.push({
            slug: meta.slug || d.name,
            name: meta.name,
            speakerLabel: meta.speakerLabel,
            role: meta.profile?.role,
            tags: meta.tags,
            impression: meta.impression,
            meeting_count: meta.meeting_count,
            updated_at: meta.updated_at
          });
        } catch {}
      }
    }
  } catch {}

  return profiles;
}

export function updateSpeakerName(speakerLabel, realName) {
  const profile = loadProfileBySpeaker(speakerLabel);
  const slug = profile ? profile.slug : slugify(realName, speakerLabel);
  const profileDir = getProfileDir(slug);

  if (profile) {
    profile.name = realName;
    profile.updated_at = new Date().toISOString();
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }
    fs.writeFileSync(path.join(profileDir, "meta.json"), JSON.stringify(profile, null, 2), "utf8");
    return { ok: true, slug, name: realName };
  }

  ensureProfilesDir();
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  const meta = {
    name: realName,
    slug,
    speakerLabel,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    version: "v1",
    profile: { role: "" },
    tags: { personality: [], culture: [] },
    impression: "",
    meeting_count: 0,
    corrections_count: 0
  };

  fs.writeFileSync(path.join(profileDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  return { ok: true, slug, name: realName };
}

export async function guessSpeakers(allTranscriptText, knownNames) {
  const messages = buildSpeakerGuessMessages(allTranscriptText, knownNames);
  const raw = await completeProfileJson(messages);

  let extracted = extractLikelyJsonObject(raw) ?? raw;
  let parsed = safeJsonParse(extracted);

  if (!parsed.ok) {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    extracted = extractLikelyJsonObject(cleaned) ?? cleaned;
    parsed = safeJsonParse(extracted);
  }

  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const guesses = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
  return { ok: true, data: guesses };
}

export function extractSpeakersFromTranscript(transcriptText) {
  return extractAllSpeakers(transcriptText);
}

export function deleteProfile(slug) {
  const profileDir = getProfileDir(slug);
  if (!fs.existsSync(profileDir)) return { ok: false, error: "not_found" };

  try {
    fs.rmSync(profileDir, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
