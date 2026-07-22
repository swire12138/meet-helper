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
  const { model, maxTokens } = getQwenConfig();

  const resp = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.2,
    max_tokens: maxTokens,
    extra_body: { enable_thinking: false }
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

  // 提前在这里声明并处理好截断版本，保证 Agent 1 和 Agent 2 都能访问到
  let trimmedPrevStr = prevStr || "";
  if (trimmedPrevStr.length > 20000) {
    trimmedPrevStr = trimmedPrevStr.slice(-20000) + "\n...（因长度限制已截断部分早期历史总结）";
  }

  let trimmedContext = contextTranscriptText || '';
  if (trimmedContext.length > 8000) {
    trimmedContext = "...\n" + trimmedContext.slice(-8000);
  }

  let trimmedTranscript = transcriptText || '';
  if (trimmedTranscript.length > 10000) {
    trimmedTranscript = "...\n" + trimmedTranscript.slice(-10000);
  }

  if (prevStr) {
    contentArray.push({ type: "text", text: `这是前次生成的分析总结结果（不包含历史转写原文）：\n\n${trimmedPrevStr}\n\n` });
    contentArray.push({ type: "text", text: `这是为了保持连贯性提供的上一段转写上下文：\n${trimmedContext || '（无上下文）'}\n\n` });
    contentArray.push({ type: "text", text: `以下是最新增加的会议语音转写记录：\n${trimmedTranscript || '（无新增转写）'}\n\n` });
    contentArray.push({ type: "text", text: `以下是最新增加的会议截屏（附带截屏时间）：` });
  } else {
    contentArray.push({ type: "text", text: `这是一场会议的语音转写记录：\n${trimmedTranscript}\n\n以下是会议过程中的多张截屏，并附带了截屏时间：` });
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
    `  correctedTranscriptMd: (此字段已在前端暂时屏蔽，你可以返回空字符串或简略信息以节省时间，因为不再展示)`,
    `  participantsAndViewpointsMd: 参与者与观点（每人单独小节，包含其对各议题的立场/理解与变化）。【重要】：这部分必须在旧有总结的基础上扩充，绝对不能缩略、删减或丢弃前次分析中已经存在的历史人员和观点！`,
    `  topicsReportMd: 议题报告（按时间顺序逐议题展开，必须包含：初始现状、讨论过程关键点、最终共识、前后差异、引用原话/片段）。【极其重要】：像写流水账一样往下写，这部分必须在旧有总结的基础上扩充，绝对不能缩略、删减或丢弃前次分析中已经存在的历史议题和报告！如果有新议题，追加在后面。`,
    `  followUpQuestionsMd: 追问清单（按议题组织，包含：提问对象、原始问题、提问原因）。【极其重要】：你必须提出怀疑有错误、逻辑有冲突、或与大方向（架构/场景适用性等）有关的高维技术探讨问题！不要去抠字眼（例如不要问"通信量减少85是什么指标/单位是什么"这类细枝末节）。而应该像架构师一样提问（例如："他这个算法对prefill阶段应该有用，但对decode阶段呢？" 或 "改为sharememory base后，开空间能开对吗？"）。【极其重要】：这部分必须在旧有清单的基础上扩充，绝对不能缩略、删减或丢弃前次分析中已经存在的历史追问问题！`,
    `  glossaryMd: 术语表（按字母或拼音或出现顺序均可，每项给出解释与在本会议中的语境）。`
  ];

  if (prevStr) {
    outputReq.push(`\n重要约束：
1. 请在"前次生成的分析总结结果"基础上，结合新增内容进行全局更新。
2. 【极端重要】对于 \`correctedTranscriptMd\`，(前端已屏蔽，直接返回空字符串即可)。
3. 对于其他 4 个分析字段（参与者、议题、追问、术语表），请综合前次结果与新增内容，输出一份【包含之前所有内容的完整更新版】的报告。
   【极其重要警告】：你绝对、绝对不能为了"简明扼要"而删掉前次结果中已经列出的历史人员、历史观点、历史议题或历史追问！所有的历史信息必须原封不动地保留（除非发现了确凿的错误需要修正）。如果有新的观点或议题，请合理插入或追加到相应部分。
4. 如果除了转写外，其他分析字段无明显变化，保持前次分析的内容原样输出即可。`);
  }

  contentArray.push({ type: "text", text: outputReq.join("\n") });

  const { model, maxTokens } = getQwenConfig();
  
  // 如果没有新增截屏，退回到使用配置中的普通文本大模型，以防 qwen-vl 报错无图
  const targetModel = images.length === 0 ? model : "qwen-vl-max";

  const messages = [
    {
      role: "system",
      content: "你是一个专业的会议分析助手。你需要结合用户提供的屏幕截图和会议语音转写记录，输出指定格式的 JSON 案例分析报告。"
    },
    {
      role: "user",
      content: targetModel === "qwen-vl-max" ? contentArray : contentArray.map(c => c.text).join("\n")
    }
  ];

  const resp = await client.chat.completions.create({
    model: targetModel,
    messages,
    temperature: 0.2,
    max_tokens: maxTokens || 8192,
    extra_body: { enable_thinking: false }
  });

    const raw = resp.choices?.[0]?.message?.content ?? "";
    let extracted = extractLikelyJsonObject(raw) ?? raw;
    let parsed = safeJsonParse(extracted);
    
    if (!parsed.ok) {
      // 增加一行正则替换：如果模型在 JSON 中输出了不合法的转义换行符或结尾多余逗号，尝试先用模型自我修复
      const fixedRaw = await completeJson(buildFixJsonMessages(raw));
      extracted = extractLikelyJsonObject(fixedRaw) ?? fixedRaw;
      parsed = safeJsonParse(extracted);
    }
  
    if (parsed.ok) {
      // ===== 跳过 Agent 2 调用，直接返回，以节省时间 =====
      return parsed.value;
    }
  
    // 即使解析失败，我们也不直接报错中断整个会议，而是返回一个部分成功的默认结构，或者打平抛出
    console.error("JSON Parse failed after fix:", parsed.error, "RAW:", raw);
    
    // 如果之前有数据，退回使用之前的数据
    if (typeof previousAnalysis === "object" && previousAnalysis !== null) {
      return previousAnalysis;
    }
    
    // 否则抛出明确的错误，告知前端发生了 JSON 解析失败
    throw new Error(`Failed to generate valid JSON analysis. Parse Error: ${parsed.error?.message || "unknown"}`);
  }

export async function analyzeTranscriptStream(transcriptText, res) {
  const runStartedAt = Date.now();
  let globalFirstTokenAt = null;

  writeNdjson(res, { type: "log", ts: nowIso(), message: "读取转写文本完成" });

  // 暂时屏蔽由大模型生成修正后的转写，直接使用原始的实时转写内容
  // 并且将后续的依赖全部替换为原始的实时转写 (transcriptText)，保证其他功能正常运行
  const correctedTranscriptMd = transcriptText;
  if (globalFirstTokenAt === null) {
    globalFirstTokenAt = Date.now();
  }

  const participantsAndViewpointsMd = (
    await streamMarkdownSection({
      section: "participantsAndViewpointsMd",
      messages: buildParticipantsMessages(transcriptText),
      res
    })
  ).content;

  const topicsReportMd = (
    await streamMarkdownSection({
      section: "topicsReportMd",
      messages: buildTopicsReportMessages(transcriptText),
      res
    })
  ).content;

  const followUpQuestionsMd = (
    await streamMarkdownSection({
      section: "followUpQuestionsMd",
      messages: buildFollowUpQuestionsMessages(transcriptText),
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
