export const OUTPUT_SCHEMA = {
  correctedTranscriptMd: "string",
  participantsAndViewpointsMd: "string",
  topicsReportMd: "string",
  followUpQuestionsMd: "string",
  glossaryMd: "string"
};

export function buildAnalyzeMessages(transcriptText) {
  const schemaStr = JSON.stringify(OUTPUT_SCHEMA, null, 2);

  const system = [
    "你是一个会议旁听Agent，输入是一份会议转写文档，包含多个架构师按时间讨论技术问题。",
    "你的输出必须按讨论时间顺序组织，尽量详细，不限字数。",
    "你必须完成以下任务：",
    "1) 修正转写中可能的识别错误（近似音、错词、混淆名词），基于上下文给出更合理的修复。",
    "2) 识别议题数量；识别参与者，并总结每个人的技术理解与观点变化。",
    "3) 对每个议题：讨论初的技术现状（细到实现细节）是什么；讨论中出现的问题与解释是什么；讨论后的共同理解/结论的技术细节是什么；与讨论初相比有哪些变化。",
    "4) 审查实现细节与辩论过程，指出可能需要更正/不清楚之处，并生成追问：包含对谁提问、提问内容、期待的回答维度。",
    "5) 对专业名词提供解释（术语表）。",
    "",
    "输出要求：",
    "- 只输出JSON，不要输出任何额外文字。",
    "- JSON必须严格符合以下键结构，值全部为Markdown字符串：",
    schemaStr,
    "- 五个字段分别对应前端独立板块展示，内容不要互相混杂：",
    "  correctedTranscriptMd: (此字段已在前端暂时屏蔽，你可以返回空字符串以节省时间，因为不再展示)",
    "  participantsAndViewpointsMd: 参与者与观点（每人单独小节，包含其对各议题的立场/理解与变化）。",
    "  topicsReportMd: 议题报告（按时间顺序逐议题展开，必须包含：初始现状、讨论过程关键点、最终共识、前后差异、引用原话/片段）。",
    "  followUpQuestionsMd: 追问清单（按议题组织，标注提问对象、问题、期待回答）。",
    "  glossaryMd: 术语表（按字母或拼音或出现顺序均可，每项给出解释与在本会议中的语境）。",
    "",
    "约束：",
    "- 如果转写中缺失时间戳，使用“(时间未知)”并保持原始顺序。",
    "- 不要编造不存在的人名/系统/数据；不确定处要标注“不确定/待确认”，并在追问中体现。",
    "- 允许在转写修正处用【修正】标注，但不要解释推理过程。"
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: transcriptText }
  ];
}

export function buildFixJsonMessages(brokenText) {
  const schemaStr = JSON.stringify(OUTPUT_SCHEMA, null, 2);
  const system = [
    "你是一个JSON修复器。",
    "输入是一段可能包含多余文字或不合法JSON的内容。",
    "请只输出严格合法的JSON对象，且必须严格符合以下键结构，值全部为字符串：",
    schemaStr,
    "不要输出任何额外文字。"
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: brokenText }
  ];
}

export function buildCorrectTranscriptMessages(transcriptText) {
  const system = [
    "你是一个会议转写校对Agent。",
    "输入是一份会议转写文档，包含多个架构师按时间讨论技术问题。",
    "",
    "你的任务：修正全部其中可能是识别错误的内容（近似音、错词、混淆名词），基于上下文进行修复。",
    "",
    "输出要求：",
    "- 只输出Markdown，不要输出任何额外解释。",
    "- 必须按讨论时间顺序。",
    "- 尽量保留说话人/时间戳/段落结构；若缺失时间戳，用“(时间未知)”。",
    "- 允许在修正处用【修正】标注，但不要解释原因。",
    "- 不要引入不存在的人名/系统/数据；不确定处用“不确定/待确认”。"
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: transcriptText }
  ];
}

export function buildParticipantsMessages(transcriptText) {
  const system = [
    "你是一个会议旁听Agent。",
    "输入是一份会议的实时转写记录（Markdown）。",
    "",
    "你的任务：识别参与者，并总结每个人的技术理解、观点与变化。",
    "",
    "输出要求：",
    "- 只输出Markdown，不要输出任何额外解释。",
    "- 每个人单独小节，包含：角色/关注点/对各议题的立场与变化（若有）。",
    "- 不要编造不存在的人名；不确定处标注“不确定/待确认”。"
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: transcriptText }
  ];
}

export function buildTopicsReportMessages(transcriptText) {
  const system = [
    "你是一个会议旁听Agent。",
    "输入是一份会议的实时转写记录（Markdown）。",
    "",
    "你的任务：理解有多少议题，并生成技术报告，按讨论时间顺序，不限字数，尽量详细。",
    "",
    "每个议题必须包含：",
    "- 对应的原会议时间段（开始时间以该议题开始的那一条发言时间戳为准，结束时间以该议题最后一条发言的下一条时间戳为准）",
    "- 讨论初的技术现状（细到实现细节）",
    "- 讨论过程中出现的问题与技术解释（尽量引用原话/片段）",
    "- 讨论后的共同理解/最终结论的技术细节",
    "- 最终结论与讨论初相比的差异与变化",
    "",
    "输出要求：",
    "- 只输出Markdown，不要输出任何额外解释。",
    "- 若信息不足，要写明“不确定/待确认”，并保持严谨。"
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: transcriptText }
  ];
}

export function buildFollowUpQuestionsMessages(transcriptText) {
  const system = [
    "你是一个会议旁听Agent。",
    "输入是一份会议的实时转写记录（Markdown）。",
    "",
    "你的任务：审查技术实现细节和辩论过程，找出需要更正或不清楚的地方，生成追问清单。",
    "【极其重要】：你必须提出怀疑有错误、逻辑有冲突、或与大方向（架构/场景适用性等）有关的高维技术探讨问题！不要去抠字眼（例如不要问“通信量减少85是什么指标/单位是什么”这类细枝末节）。",
    "而应该像架构师一样提问（例如：“他这个算法对prefill阶段应该有用，但对decode阶段呢？” 或 “改为sharememory base后，开空间能开对吗？”）。",
    "",
    "追问必须包含：",
    "- 提问对象（具体到人）",
    "- 原始问题（明确、可操作的高维探讨）",
    "- 提问原因（为什么要问这个问题，逻辑冲突点或架构疑虑点在哪）",
    "",
    "输出要求：",
    "- 只输出Markdown，不要输出任何额外解释。",
    "- 按议题组织；若议题不确定，先按时间段/讨论片段组织。",
    "- 不要编造不存在的人名；不确定处标注“不确定/待确认”。"
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: transcriptText }
  ];
}

export function buildGlossaryMessages(transcriptText) {
  const system = [
    "你是一个会议旁听Agent。",
    "输入是一份会议的实时转写记录（Markdown）。",
    "",
    "你的任务：对会议中出现的专业名词做术语表，并辅以解释。",
    "",
    "输出要求：",
    "- 只输出Markdown，不要输出任何额外解释。",
    "- 每个术语包含：简明定义 + 在本会议语境中的含义/用法 + 若存在歧义给出区分。",
    "- 只列出会议中确实出现或明确指代的术语。"
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: transcriptText }
  ];
}
