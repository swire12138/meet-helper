import { extractLikelyJsonObject, safeJsonParse } from "./json.js";
import {
  buildAnalyzeMessages,
  buildCorrectTranscriptMessages,
  buildFixJsonMessages,
  buildFollowUpQuestionsMessages,
  buildParticipantsMessages,
  buildTopicsReportMessages,
  OUTPUT_SCHEMA
} from "./prompts.js";
import { createQwenClient, getQwenConfig } from "./qwenClient.js";
import { nowIso, writeNdjson } from "./ndjson.js";

function validateShape(obj) {
  if (!obj || typeof obj !== "object") return { ok: false, error: "not_object" };
  for (const k of Object.keys(OUTPUT_SCHEMA)) {
    if (typeof obj[k] !== "string") return { ok: false, error: `missing_or_not_string:${k}` };
  }
  return { ok: true };
}

async function completeJson(messages) {
  const client = createQwenClient();
  const { model, enableThinking, maxTokens } = getQwenConfig();

  const resp = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.2,
    max_tokens: maxTokens,
    extra_body: { enable_thinking: enableThinking }
  });

  return resp.choices?.[0]?.message?.content ?? "";
}

export async function analyzeTranscript(transcriptText) {
  const raw = await completeJson(buildAnalyzeMessages(transcriptText));
  const extracted = extractLikelyJsonObject(raw) ?? raw;
  const parsed1 = safeJsonParse(extracted);
  if (parsed1.ok) {
    const shape = validateShape(parsed1.value);
    if (shape.ok) return { ok: true, value: parsed1.value, raw };
  }

  const fixedRaw = await completeJson(buildFixJsonMessages(raw));
  const fixedExtracted = extractLikelyJsonObject(fixedRaw) ?? fixedRaw;
  const parsed2 = safeJsonParse(fixedExtracted);
  if (!parsed2.ok) return { ok: false, error: "json_parse_failed", raw, fixedRaw };
  const shape2 = validateShape(parsed2.value);
  if (!shape2.ok) return { ok: false, error: shape2.error, raw, fixedRaw };

  return { ok: true, value: parsed2.value, raw };
}

async function streamMarkdownSection({ section, messages, res }) {
  const client = createQwenClient();
  const { model, maxTokens } = getQwenConfig();

  const startedAt = Date.now();
  let firstTokenAt = null;

  writeNdjson(res, { type: "log", ts: nowIso(), message: `开始生成：${section}` });

  const stream = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.2,
    max_tokens: maxTokens,
    stream: true,
    extra_body: { enable_thinking: false }
  });

  let content = "";
  for await (const part of stream) {
    const delta = part.choices?.[0]?.delta?.content ?? "";
    if (!delta) continue;
    if (firstTokenAt === null) {
      firstTokenAt = Date.now();
      writeNdjson(res, {
        type: "log",
        ts: nowIso(),
        message: `${section} 首token耗时：${firstTokenAt - startedAt}ms`
      });
    }
    content += delta;
    writeNdjson(res, { type: "delta", ts: nowIso(), section, delta });
  }

  const endedAt = Date.now();
  writeNdjson(res, { type: "section_done", ts: nowIso(), section });
  writeNdjson(res, {
    type: "log",
    ts: nowIso(),
    message: `${section} 生成耗时：${endedAt - startedAt}ms`
  });
  return {
    content: content.trim(),
    startedAt,
    firstTokenAt,
    endedAt
  };
}

export async function analyzeCaseContent(images, transcriptText, contextTranscriptText, previousAnalysis) {
  const client = createQwenClient();
  const schemaStr = JSON.stringify(OUTPUT_SCHEMA, null, 2);
  const contentArray = [];

  let prevStr = previousAnalysis;
  if (typeof previousAnalysis === "object" && previousAnalysis !== null) {
    prevStr = JSON.stringify({
      participantsAndViewpointsMd: previousAnalysis.participantsAndViewpointsMd,
      topicsReportMd: previousAnalysis.topicsReportMd,
      followUpQuestionsMd: previousAnalysis.followUpQuestionsMd,
      glossaryMd: previousAnalysis.glossaryMd
    }, null, 2);
  }

  if (prevStr) {
    contentArray.push({ type: "text", text: `这是前次生成的分析总结结果（不包含历史转写原文）：\n\n${prevStr}\n\n` });
    contentArray.push({ type: "text", text: `这是为了保持连贯性提供的上一段转写上下文：\n${contextTranscriptText || '（无上下文）'}\n\n` });
    contentArray.push({ type: "text", text: `以下是最新增加的会议语音转写记录：\n${transcriptText || '（无新增转写）'}\n\n` });
    contentArray.push({ type: "text", text: `以下是最新增加的会议截屏（附带截屏时间）：` });
  } else {
    contentArray.push({ type: "text", text: `这是一场会议的语音转写记录：\n${transcriptText}\n\n以下是会议过程中的多张截屏，并附带了截屏时间：` });
  }

  if (images.length === 0) {
    contentArray.push({ type: "text", text: `\n（无新增截屏）` });
  } else {
    for (const img of images) {
      contentArray.push({ type: "text", text: `\n[时间: ${img.time}]` });
      contentArray.push({ type: "image_url", image_url: { url: img.imageUrl } });
    }
  }

  const outputReq = [
    `\n\n请结合多张会议截屏（注意时间顺序与内容变化）以及会议语音转写记录，深入分析并输出技术报告。`,
    `输出要求：`,
    `- 只输出JSON，不要输出任何额外文字。`,
    `- JSON必须严格符合以下键结构，值全部为Markdown字符串：`,
    schemaStr,
    `- 五个字段分别对应前端独立板块展示，内容不要互相混杂：`,
    `  correctedTranscriptMd: 仅针对本次新增的转写内容进行修正。务必保持原有的格式（按时间顺序，严格保留并输出时间戳、说话人和段落结构），每句话必须单独一行，绝对不能把它们合并成一长段文字。注意：直接输出纯文本，千万不要使用 \`\`\` 任何代码块标记包裹！不要带入“上下文”或以前的对话，因为前端会自动拼接它。`,
    `  participantsAndViewpointsMd: 参与者与观点（每人单独小节，包含其对各议题的立场/理解与变化）。`,
    `  topicsReportMd: 议题报告（按时间顺序逐议题展开，必须包含：初始现状、讨论过程关键点、最终共识、前后差异、引用原话/片段）。`,
    `  followUpQuestionsMd: 追问清单（按议题组织，标注提问对象、问题、期待回答）。`,
    `  glossaryMd: 术语表（按字母或拼音或出现顺序均可，每项给出解释与在本会议中的语境）。`
  ];

  if (prevStr) {
    outputReq.push(`\n重要约束：
1. 请在“前次生成的分析总结结果”基础上，结合新增内容进行全局更新。
2. 【极端重要】对于 \`correctedTranscriptMd\`，你只需要输出【最新增加的会议语音转写记录】的修正版（且只能针对这部分字数），千万不要把前次分析里的、或者上下文里的内容再重新输出一遍！因为我会在系统外部把你的输出和历史记录直接拼接，如果你重复输出了，会导致页面上出现大量的重复文本。
3. 对于其他 4 个分析字段（参与者、议题、追问、术语表），请综合前次结果与新增内容，输出一份【包含之前所有内容的完整更新版】的报告。如果有新的观点或议题，请合理插入或追加到相应部分。
4. 如果除了转写外，其他分析字段无明显变化，保持前次分析的内容原样输出即可。`);
  }

  contentArray.push({ type: "text", text: outputReq.join("\n") });

  const messages = [
    {
      role: "system",
      content: "你是一个专业的会议分析助手。你需要结合用户提供的屏幕截图和会议语音转写记录，输出指定格式的 JSON 案例分析报告。"
    },
    {
      role: "user",
      content: contentArray
    }
  ];

  const { maxTokens } = getQwenConfig();

  const resp = await client.chat.completions.create({
    model: "qwen-vl-max",
    messages,
    temperature: 0.2,
    max_tokens: maxTokens || 8192
  });

  const raw = resp.choices?.[0]?.message?.content ?? "";
  const extracted = extractLikelyJsonObject(raw) ?? raw;
  const parsed = safeJsonParse(extracted);
  if (parsed.ok) {
    return parsed.value;
  }

  const fixedRaw = await completeJson(buildFixJsonMessages(raw));
  const fixedExtracted = extractLikelyJsonObject(fixedRaw) ?? fixedRaw;
  const parsed2 = safeJsonParse(fixedExtracted);
  if (parsed2.ok) {
    return parsed2.value;
  }

  throw new Error("Failed to generate valid JSON analysis");
}

export async function analyzeTranscriptStream(transcriptText, res) {
  const runStartedAt = Date.now();
  let globalFirstTokenAt = null;

  writeNdjson(res, { type: "log", ts: nowIso(), message: "读取转写文本完成" });

  const corrected = await streamMarkdownSection({
    section: "correctedTranscriptMd",
    messages: buildCorrectTranscriptMessages(transcriptText),
    res
  });
  if (globalFirstTokenAt === null && corrected.firstTokenAt !== null) {
    globalFirstTokenAt = corrected.firstTokenAt;
  }
  const correctedTranscriptMd = corrected.content;

  const participantsAndViewpointsMd = (
    await streamMarkdownSection({
      section: "participantsAndViewpointsMd",
      messages: buildParticipantsMessages(correctedTranscriptMd),
      res
    })
  ).content;

  const topicsReportMd = (
    await streamMarkdownSection({
      section: "topicsReportMd",
      messages: buildTopicsReportMessages(correctedTranscriptMd),
      res
    })
  ).content;

  const followUpQuestionsMd = (
    await streamMarkdownSection({
      section: "followUpQuestionsMd",
      messages: buildFollowUpQuestionsMessages(correctedTranscriptMd),
      res
    })
  ).content;

  const glossaryMd = "";

  const runEndedAt = Date.now();
  writeNdjson(res, { type: "log", ts: nowIso(), message: `总耗时：${runEndedAt - runStartedAt}ms` });

  writeNdjson(res, {
    type: "done",
    ts: nowIso(),
    data: {
      correctedTranscriptMd,
      participantsAndViewpointsMd,
      topicsReportMd,
      followUpQuestionsMd,
      glossaryMd
    }
  });
}
