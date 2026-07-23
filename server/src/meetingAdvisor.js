import { createQwenClient, getQwenConfig } from "./qwenClient.js";
import { extractLikelyJsonObject, safeJsonParse } from "./json.js";

const SIGNAL_TYPES = ["error", "blocked", "conflict", "decision_pending", "risk"];
const ADVICE_TYPES = ["correction", "proposal", "question", "risk"];

function clipText(text, maxLength) {
  if (typeof text !== "string") return "";
  const value = text.trim();
  if (!value) return "";
  if (value.length <= maxLength) return value;
  return value.slice(value.length - maxLength);
}

function normalizeLineArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function buildJsonRepairMessages(raw, schemaHint) {
  return [
    {
      role: "system",
      content: [
        "你是 JSON 修复助手。",
        "你只能输出一个合法 JSON 对象。",
        "不能输出 Markdown 代码块，不能解释。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "请把下面这段输出修成合法 JSON。",
        "必须保留原意，但字段结构要符合要求。",
        `结构要求：${schemaHint}`,
        "",
        raw || "（空）"
      ].join("\n")
    }
  ];
}

async function completeJsonObject(messages, { temperature = 0, maxTokens = 1200, enableSearch = false } = {}) {
  const client = createQwenClient();
  const { model, maxTokens: defaultMaxTokens } = getQwenConfig();
  const payload = {
    model,
    messages,
    temperature,
    max_tokens: Math.min(defaultMaxTokens, maxTokens),
    response_format: { type: "json_object" },
    extra_body: { enable_thinking: false }
  };
  if (enableSearch) {
    payload.enable_search = true;
  }
  const resp = await client.chat.completions.create(payload);
  return resp.choices?.[0]?.message?.content ?? "";
}

async function parseModelJson(messages, schemaHint, options) {
  const raw = await completeJsonObject(messages, options);
  const extracted = extractLikelyJsonObject(raw) ?? raw;
  const parsed = safeJsonParse(extracted);
  if (parsed.ok) {
    return { ok: true, value: parsed.value };
  }

  const fixedRaw = await completeJsonObject(buildJsonRepairMessages(raw, schemaHint), {
    temperature: 0,
    maxTokens: 1000
  });
  const fixedExtracted = extractLikelyJsonObject(fixedRaw) ?? fixedRaw;
  const fixedParsed = safeJsonParse(fixedExtracted);
  if (fixedParsed.ok) {
    return { ok: true, value: fixedParsed.value };
  }
  return { ok: false, error: parsed.error || fixedParsed.error || "invalid_json_response" };
}

function buildTriggerMessages({ recentLines, contextLines, recentSummary }) {
  const recentText = normalizeLineArray(recentLines).join("\n") || "（空）";
  const contextText = normalizeLineArray(contextLines).join("\n") || "（空）";
  return [
    {
      role: "system",
      content: [
        "你是会议预判 Agent。",
        "你的任务只是快速判断这段会议新增内容，是否值得触发一次独立建议流程。",
        "不要给完整建议，不要展开分析，只做分诊。",
        "你必须只输出 JSON，对象字段只能是：shouldTrigger, signalType, confidence, reason, focusSpan。",
        "shouldTrigger 只能是 true 或 false。",
        `signalType 只能是 ${SIGNAL_TYPES.join(" / ")} / none。`,
        "confidence 只能是 0 到 1 的数字。",
        "reason 用一句简短中文说明判断依据。",
        "focusSpan 用一句简短中文指出最值得关注的片段。",
        "你只能围绕会议中已经出现的困惑点、拿不准的点、争议点、错误点、风险点来触发。",
        "如果这段内容只是正常陈述、知识总结、流程介绍、一般性汇报，即使存在优化空间，也不要触发。",
        "只有当与会者已经表现出明显困惑、犹豫、分歧、判断不清、方案拿不准、错误理解或风险担忧时，才返回 shouldTrigger=true。",
        "focusSpan 必须对应会议里已经说出来的困惑点，而不是你自己额外脑补的新问题。",
        "如果会议里没人困惑、没人卡住、没人拿不准，就返回 shouldTrigger=false。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        recentSummary ? `最近阶段摘要：${recentSummary}` : "",
        "=== 最近上下文 ===",
        contextText,
        "",
        "=== 最新片段 ===",
        recentText,
        "",
        "请只做快速预判。"
      ].filter(Boolean).join("\n")
    }
  ];
}

function buildAdvisorMessages({
  signalType,
  focusSpan,
  recentLines,
  contextLines,
  recentSummary,
  profileName,
  profileRole,
  pendingAdviceDigest,
  webContext,
  manualInstruction = "",
  enableSearch = false,
  forceWebSearch = false
}) {
  const recentText = normalizeLineArray(recentLines).join("\n") || "（空）";
  const contextText = normalizeLineArray(contextLines).join("\n") || "（空）";
  const webText = Array.isArray(webContext) && webContext.length > 0
    ? webContext
        .map((item, idx) => `${idx + 1}. ${item.title}\n${item.snippet}\n${item.url}`)
        .join("\n\n")
    : "（无外部资料）";

  return [
    {
      role: "system",
      content: [
        "你是会议纠偏建议 Agent。",
        "你要在会议遇到阻塞、错误、冲突、困惑或风险时，直接给出答案、方案和纠正建议。",
        "你的角色是解答者和补充者，不是质疑者，不是追问者。",
        "即使当前视窗较小、上下文不完整，也要基于已有内容主动补全合理语境，直接给出最可能有帮助的解决方案。",
        "你无权反问用户、无权要求会议参与者补充信息、无权把回答主体推回给现场的人。",
        "你也无权替会议现场发号施令、分派职责、规定截止时间、强行安排执行顺序。",
        "如果信息不足，就明确写出你的合理判断和默认假设，然后继续给出可执行答案。",
        "不要写长报告，不要输出冗余铺垫。",
        "不要把重点放在提出问题上，重点是直接回答会议里卡住的点。",
        "你的回答必须紧贴会议里已经出现的那个困惑点，先解答那个困惑，再补充最有帮助的解决方案。",
        "如果用户额外给了本次手动要求，要优先吸收这些要求来调整答案表达、侧重点和回答边界，但仍然要围绕当前会议内容作答。",
        "不要因为你觉得还能优化，就凭空制造一个会议里并不存在的问题来回答。",
        "你必须只输出 JSON，对象字段只能是：title, adviceType, summary, suggestion, nextQuestion, needWebSearch, searchQuery, sourceNote。",
        "title 是一句短标题。",
        `adviceType 只能是 ${ADVICE_TYPES.join(" / ")}。`,
        "summary 用一句话概括会议里已经出现的那个困惑或问题。",
        "suggestion 必须先直接解答这个困惑，再给出解决方案、判断结论、推荐做法或纠正答案，长度控制在 2 到 4 句。",
        "solution 要用平实、克制、辅助决策的语气，像会议里的补充说明，不要用命令口吻。",
        "避免出现“立即、必须、请于今日18:00前、由某某负责、确保在48小时内”这类发号施令式表达。",
        "如果需要提落地路径，也要写成“更稳妥的做法是…… / 可以先……再……”这类建议式表达，而不是直接布置任务。",
        "nextQuestion 默认留空。除非绝对必要，否则不要填写。",
        "needWebSearch 只能是 true 或 false。",
        "searchQuery 只有在 needWebSearch=true 时填写，否则留空。",
        "sourceNote 说明是否参考了外部资料。",
        "如果已经提供外部资料，就基于这些资料直接回答，不要再要求搜索。",
        forceWebSearch
          ? "这一次要求你强制使用 Qwen 的 web_search。请直接联网补充后给出最终答案，不要跳过搜索，也不要再次要求搜索。"
          : enableSearch
            ? "这一次已经为你启用 Qwen 的 web_search。请直接联网补充后给出最终答案，不要再次要求搜索。"
          : "默认不要联网。只有当这个困惑明显依赖外部最新资料、实时指南或在线信息时，才把 needWebSearch 设为 true。",
        "如果会议里明确出现“今天、当前、最新、刚刚、最近发布、最新指南、最新公告、最新政策、最新利率、最新价格、官网最新口径”等时效性表述，不允许凭记忆直接作答，必须把 needWebSearch 设为 true。",
        "如果问题本质上需要核对官方最新文档、实时数据或近期更新内容，也必须先触发联网，而不是用旧知识硬答。",
        "输出风格要像在会议里直接补一句有用的话，帮大家推进，而不是把球踢回去。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        profileName ? `当前更新画像：${profileName}${profileRole ? `（${profileRole}）` : ""}` : "当前未绑定画像",
        recentSummary ? `最近阶段摘要：${recentSummary}` : "",
        pendingAdviceDigest ? `最近已展示建议：${pendingAdviceDigest}` : "最近没有已展示建议",
        `触发信号：${signalType || "none"}`,
        `关注片段：${focusSpan || "未提供"}`,
        manualInstruction ? `本次手动要求：${manualInstruction}` : "",
        "",
        "=== 最近上下文 ===",
        contextText,
        "",
        "=== 最新片段 ===",
        recentText,
        "",
        "=== 可参考的外部资料 ===",
        webText,
        "",
        "请输出一条适合在会议中直接展示的答案型建议，重点是直接解答困惑并给出方案。"
      ].join("\n")
    }
  ];
}

function validateTriggerResult(value) {
  if (!value || typeof value !== "object") return null;
  const signalType = typeof value.signalType === "string" ? value.signalType.trim() : "none";
  const confidenceRaw = Number(value.confidence);
  return {
    shouldTrigger: value.shouldTrigger === true,
    signalType: SIGNAL_TYPES.includes(signalType) ? signalType : "none",
    confidence: Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0,
    reason: typeof value.reason === "string" ? value.reason.trim() : "",
    focusSpan: typeof value.focusSpan === "string" ? value.focusSpan.trim() : ""
  };
}

function validateAdvisorResult(value) {
  if (!value || typeof value !== "object") return null;
  const adviceType = typeof value.adviceType === "string" ? value.adviceType.trim() : "proposal";
  return {
    title: typeof value.title === "string" ? value.title.trim() : "",
    adviceType: ADVICE_TYPES.includes(adviceType) ? adviceType : "proposal",
    summary: typeof value.summary === "string" ? value.summary.trim() : "",
    suggestion: typeof value.suggestion === "string" ? value.suggestion.trim() : "",
    nextQuestion: "",
    needWebSearch: value.needWebSearch === true,
    searchQuery: typeof value.searchQuery === "string" ? value.searchQuery.trim() : "",
    sourceNote: typeof value.sourceNote === "string" ? value.sourceNote.trim() : "",
    usedWebSearch: value.usedWebSearch === true
  };
}

export async function detectMeetingAdviceTrigger({
  recentLines = [],
  contextLines = [],
  recentSummary = ""
}) {
  const schemaHint = "{\"shouldTrigger\":true,\"signalType\":\"blocked\",\"confidence\":0.82,\"reason\":\"...\",\"focusSpan\":\"...\"}";
  const parsed = await parseModelJson(
    buildTriggerMessages({
      recentLines,
      contextLines,
      recentSummary: clipText(recentSummary, 800)
    }),
    schemaHint,
    { temperature: 0, maxTokens: 600 }
  );

  if (!parsed.ok) {
    throw new Error(typeof parsed.error === "string" ? parsed.error : "trigger_parse_failed");
  }

  const validated = validateTriggerResult(parsed.value);
  if (!validated) {
    throw new Error("invalid_trigger_payload");
  }
  return validated;
}

export async function generateMeetingAdvice({
  signalType,
  focusSpan,
  recentLines = [],
  contextLines = [],
  recentSummary = "",
  profileName = "",
  profileRole = "",
  pendingAdviceDigest = "",
  webContext = [],
  manualInstruction = "",
  forceWebSearch = false
}) {
  const schemaHint = "{\"title\":\"...\",\"adviceType\":\"proposal\",\"summary\":\"...\",\"suggestion\":\"...\",\"nextQuestion\":\"...\",\"needWebSearch\":false,\"searchQuery\":\"\",\"sourceNote\":\"...\"}";
  const requestPayload = {
    signalType,
    focusSpan,
    recentLines,
    contextLines,
    recentSummary: clipText(recentSummary, 800),
    profileName,
    profileRole,
    pendingAdviceDigest: clipText(pendingAdviceDigest, 800),
    webContext,
    manualInstruction: clipText(manualInstruction, 400),
    forceWebSearch
  };
  let parsed = forceWebSearch
    ? await parseModelJson(
        buildAdvisorMessages({
          ...requestPayload,
          enableSearch: true,
          forceWebSearch: true
        }),
        schemaHint,
        { temperature: 0.1, maxTokens: 1000, enableSearch: true }
      )
    : await parseModelJson(
        buildAdvisorMessages(requestPayload),
        schemaHint,
        { temperature: 0.1, maxTokens: 1000 }
      );

  if (!parsed.ok) {
    throw new Error(typeof parsed.error === "string" ? parsed.error : "advisor_parse_failed");
  }

  let validated = validateAdvisorResult(parsed.value);
  if (!validated) {
    throw new Error("invalid_advisor_payload");
  }
  if (forceWebSearch) {
    return {
      ...validated,
      needWebSearch: false,
      searchQuery: validated.searchQuery || focusSpan || recentLines.slice(-2).join("；"),
      usedWebSearch: true,
      sourceNote: validated.sourceNote || "已按手动强制联网模式通过 Qwen web_search 补充外部资料。"
    };
  }
  const shouldUseWebSearch = validated.needWebSearch && (!Array.isArray(webContext) || webContext.length === 0);
  if (shouldUseWebSearch) {
    const searched = await parseModelJson(
      buildAdvisorMessages({
        ...requestPayload,
        enableSearch: true
      }),
      schemaHint,
      { temperature: 0.1, maxTokens: 1000, enableSearch: true }
    );
    if (searched.ok) {
      const searchedValidated = validateAdvisorResult(searched.value);
      if (searchedValidated) {
        validated = {
          ...searchedValidated,
          needWebSearch: false,
          searchQuery: searchedValidated.searchQuery || validated.searchQuery || focusSpan || recentLines.slice(-2).join("；"),
          usedWebSearch: true,
          sourceNote: searchedValidated.sourceNote || "已通过 Qwen web_search 联网补充外部资料。"
        };
      }
    }
  }
  return validated;
}
