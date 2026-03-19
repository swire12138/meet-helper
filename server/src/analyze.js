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
