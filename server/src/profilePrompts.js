export const PROFILE_SCHEMA = {
  name: "string",
  role: "string",
  personaMd: "string",
  workMd: "string",
  tags: {
    personality: ["string"],
    culture: ["string"]
  },
  impression: "string"
};

export function buildProfileAnalysisMessages(speakerLabel, transcriptText, screenshotCount) {
  const transcriptSection = transcriptText.trim()
    ? `以下是该发言人在会议中的全部发言记录：\n${transcriptText}`
    : "（该发言人暂无足够发言记录）";

  const screenshotNote = screenshotCount > 0
    ? `\n\n会议过程中共有 ${screenshotCount} 张截屏，截屏内容可能包含该发言人演示的材料，可作为补充参考。`
    : "";

  const isUnknown = speakerLabel === "未知发言人";

  const taskDesc = isUnknown
    ? "你是一个专业的职场人物分析Agent。你的任务是从会议发言记录中提取参会者的性格特征、行为模式和工作能力。\n\n由于发言记录中所有发言人都标记为「未知发言人」，你无法区分不同发言人。请将所有发言内容作为一个整体来分析，构建一个「参会者综合画像」。如果你能从发言内容的语义差异中识别出不同的发言人，请分别说明。"
    : "你是一个专业的职场人物分析Agent。你的任务是从会议发言记录中提取某位发言人的性格特征、行为模式和工作能力。";

  const system = [
    taskDesc,
    "",
    "你需要完成两项分析任务：Persona分析 和 Work分析。",
    "",
    "## Persona 分析维度",
    "",
    "### 1. 表达风格",
    "- 口头禅（固定搭配，出现2次以上的短语）",
    "- 高频词（出现3次以上的词）",
    "- 行话/黑话（公司内部术语、行业术语）",
    "- 句式特征（短句/长句、是否列点、结论位置）",
    "- 正式程度（1=极度正式 5=非常口语化）",
    "",
    "### 2. 决策模式",
    "- 优先考量排序（效率/流程/数据/人情/资源）",
    "- 什么触发他主动推进",
    "- 什么触发他拖延或推诿",
    "- 如何表达不同意（直接否定/提问质疑/沉默/转移）",
    "- 如何回应质疑",
    "",
    "### 3. 人际行为",
    "- 对上级的汇报风格",
    "- 对下级/后辈的态度",
    "- 对平级的协作方式",
    "- 压力下的行为变化",
    "",
    "### 4. 边界与雷区",
    "- 明显抵触的事情",
    "- 会回避的话题",
    "- 拒绝的方式",
    "",
    "## Work 分析维度",
    "",
    "### 1. 负责范围",
    "- 负责的系统/模块/业务线",
    "- 职责边界",
    "- 频繁提到的项目代号、业务术语",
    "",
    "### 2. 技术规范推断",
    "- 技术栈（从发言中推断）",
    "- 代码/方案偏好",
    "- Code Review 关注点",
    "",
    "### 3. 工作流程",
    "- 接需求时的处理方式",
    "- 方案讨论时的思路结构",
    "- 异常/问题的处理流程",
    "",
    "### 4. 经验知识",
    "- 明确表达的经验判断",
    "- 踩过的坑",
    "- 技术观点（直接引用原话）",
    "",
    "## 输出要求",
    "",
    "- 只输出JSON，不要输出任何额外文字",
    "- JSON必须严格符合以下结构：",
    "  {",
    "    \"name\": \"从发言中推测的姓名或保留原发言人标签\",",
    "    \"role\": \"从发言内容推断的职位/角色\",",
    "    \"personaMd\": \"Persona分析的Markdown文本\",",
    "    \"workMd\": \"Work分析的Markdown文本\",",
    "    \"tags\": {",
    "      \"personality\": [\"个性标签列表\"],",
    "      \"culture\": [\"企业文化标签列表\"]",
    "    },",
    "    \"impression\": \"一句话主观印象\"",
    "  }",
    "- personaMd 使用以下分层结构：",
    "  ## Layer 0：核心性格（具体行为规则，不用形容词）",
    "  ## Layer 1：身份",
    "  ## Layer 2：表达风格",
    "  ## Layer 3：决策与判断",
    "  ## Layer 4：人际行为",
    "  ## Layer 5：边界与雷区",
    "- workMd 使用以下结构：",
    "  ## 职责范围",
    "  ## 技术规范推断",
    "  ## 工作流程",
    "  ## 经验知识库",
    "- 原材料不足的维度标注（原材料不足）",
    "- 有原文依据的结论引用原话（加引号）",
    "- personaMd 中 Layer 0 的每条规则必须包含「在什么情况下会怎么做」的完整表述，不能用纯形容词"
  ].join("\n");

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `请分析发言人「${speakerLabel}」的画像。\n\n${transcriptSection}${screenshotNote}`
    }
  ];
}

export function buildProfileMergeMessages(speakerLabel, existingProfile, newTranscriptText, screenshotCount) {
  const screenshotNote = screenshotCount > 0
    ? `\n\n本次新增会议截屏 ${screenshotCount} 张。`
    : "";

  const system = [
    "你是一个同事画像增量合并Agent。",
    "",
    "你将收到：",
    "1. 该发言人现有的 persona.md 内容",
    "2. 该发言人现有的 work.md 内容",
    "3. 该发言人新增的会议发言记录",
    "",
    "你的任务是判断新内容应该更新哪个部分，并输出完整的更新后画像。",
    "你必须优先从新增发言中提取新的、具体的、可落到画像条目的信息，而不是只做总结。",
    "",
    "## 合并原则",
    "",
    "1. 只追加增量，不覆盖已有结论",
    "2. 如果新内容补充了现有信息（增加了新细节）→ 直接追加",
    "3. 如果新内容确认了现有信息 → 保留原有描述",
    "4. 如果新内容与现有信息矛盾 → 以新内容为准，并在 impression 字段中注明",
    "5. 如果新增发言里出现了新的技术术语、工作方法、表达习惯、判断依据、示例话术、边界条件，你必须把它们融合到 personaMd/workMd 的对应位置",
    "6. 除非新增发言完全没有有效信息，否则不要返回和现有画像完全相同的内容",
    "7. 不要只写一句总结，personaMd 和 workMd 必须是完整正文",
    "",
    "## 分类规则",
    "",
    "| 信息类型 | 归入 |",
    "| 技术规范、代码风格、接口设计、工作流程 | → workMd |",
    "| 业务知识、系统职责、技术结论 | → workMd |",
    "| 沟通风格、口头禅、表达习惯 | → personaMd |",
    "| 决策行为、人际关系、情绪模式 | → personaMd |",
    "",
    "## 输出要求",
    "",
    "- 只输出JSON，结构同创建时：",
    "  {",
    "    \"name\": \"string\",",
    "    \"role\": \"string\",",
    "    \"personaMd\": \"string\",",
    "    \"workMd\": \"string\",",
    "    \"tags\": { \"personality\": [\"string\"], \"culture\": [\"string\"] },",
    "    \"impression\": \"string\",",
    "    \"hasMaterialUpdate\": true,",
    "    \"updateReasons\": [\"string\"]",
    "  }",
    "- personaMd 和 workMd 必须输出合并后的完整内容（不是增量patch）",
    "- 现有内容中未被新信息影响的部分必须原样保留",
    "- 新增信息自然融入对应章节",
    "- 不要为了简明扼要而删减已有内容",
    "- 如果新增发言没有实质信息，hasMaterialUpdate 设为 false，personaMd/workMd 原样返回",
    "- updateReasons 写清楚本轮新增到底补充了什么，例如：\"新增了表达习惯中的高频词\"、\"新增了工作方法中的技术实现细节\""
  ].join("\n");

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        `发言人：${speakerLabel}`,
        "",
        "=== 现有 persona.md ===",
        existingProfile.personaMd || "（暂无）",
        "",
        "=== 现有 work.md ===",
        existingProfile.workMd || "（暂无）",
        "",
        "=== 新增发言记录 ===",
        newTranscriptText.trim() || "（无新增发言）",
        screenshotNote
      ].join("\n")
    }
  ];
}

export function buildPersonaProfileFromAnalysisMessages({
  speakerLabel,
  existingProfile,
  analysis,
  newTranscriptText
}) {
  const participants = analysis?.participantsAndViewpointsMd || "（无）";
  const topics = analysis?.topicsReportMd || "（无）";
  const followUps = analysis?.followUpQuestionsMd || "（无）";
  const glossary = analysis?.glossaryMd || "（无）";
  const existingPersona = existingProfile?.personaMd || "";
  const existingWork = existingProfile?.workMd || "";

  const system = [
    "你是一个同事 Persona 画像构建 Agent。",
    "",
    "你的任务是根据会议增量分析结果，只更新该发言人的 Persona（性格与行为模式）。",
    "不要生成 Work 内容，不要分析技术能力，不要改写已有 Work。",
    "",
    "你要重点从以下信息中提取内容：",
    "1. participantsAndViewpointsMd 中与该发言人角色、观点、行为模式相关的信息",
    "2. topicsReportMd 中反映其表达方式、判断方式、推进方式的信息",
    "3. followUpQuestionsMd 中暴露出的关注点、风险偏好、沟通风格",
    "4. glossaryMd 中能体现其表达习惯、身份定位的术语",
    "5. 本轮新增发言中的直接线索",
    "",
    "Persona 结构（内容用分点列表）：",
    "## Layer 0：核心性格",
    "## Layer 1：身份",
    "## Layer 2：表达风格",
    "## Layer 3：决策与判断",
    "## Layer 4：人际行为",
    "## Layer 5：边界与雷区",
    "",
    "编写规则（极其重要，违反会出错）：",
    "1. 只写 Persona，不要写工作能力、职责、技术、经验",
    "2. 【最重要】必须 100% 原样保留已有 personaMd 中的所有内容，绝对不能删除任何已有的东西",
    "3. 【最重要】新增内容必须合并到对应的层里，不是在末尾独立追加",
    "4. 【最重要】比如已有 Layer 0，新信息要合并到已有 Layer 0 里，不要在最后写 Layer 0（新增）",
    "5. 【最重要】只能新增内容，不能修改或删除已有内容，更不能用“数据不足”之类的覆盖已有内容",
    "6. 【最重要】如果本轮没有新信息，就直接原样返回已有的 personaMd",
    "7. 【格式】所有内容都要用分点列表（- 开头），清晰易读",
    "8. 尽量引用分析中的原话或术语，不要泛泛而谈",
    "",
    "只输出 JSON，不要输出任何额外文字。JSON 结构必须为：",
    "{",
    "  \"name\": \"string\",",
    "  \"role\": \"string\",",
    "  \"personaMd\": \"string\",",
    "  \"workMd\": \"string\",",
    "  \"tags\": { \"personality\": [\"string\"], \"culture\": [\"string\"] },",
    "  \"impression\": \"string\",",
    "  \"hasMaterialUpdate\": true,",
    "  \"updateReasons\": [\"string\"]",
    "}",
    "",
    "额外约束：",
    "- personaMd 必须包含所有已有内容，只追加不删除",
    "- workMd 必须直接原样返回当前已有 workMd，不要改写",
    "- tags 如果无法判断就返回已有 tags",
    "- hasMaterialUpdate 表示本轮 Persona 是否真的带来了新增信息"
  ].join("\n");

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        `发言人：${speakerLabel}`,
        "",
        "=== 当前已有 personaMd（必须原样保留，不要改）===",
        existingPersona || "（空）",
        "",
        "=== 当前已有 workMd（仅原样带回，不允许改写）===",
        existingWork || "（空）",
        "",
        "=== 本轮新增发言 ===",
        newTranscriptText?.trim() || "（无）",
        "",
        "=== 本轮增量分析：参与者与观点 ===",
        participants,
        "",
        "=== 本轮增量分析：议题报告 ===",
        topics,
        "",
        "=== 本轮增量分析：追问清单 ===",
        followUps,
        "",
        "=== 本轮增量分析：术语表 ===",
        glossary
      ].join("\n")
    }
  ];
}

export function buildWorkProfileFromAnalysisMessages({
  speakerLabel,
  existingProfile,
  analysis,
  newTranscriptText
}) {
  const participants = analysis?.participantsAndViewpointsMd || "（无）";
  const topics = analysis?.topicsReportMd || "（无）";
  const followUps = analysis?.followUpQuestionsMd || "（无）";
  const glossary = analysis?.glossaryMd || "（无）";
  const existingPersona = existingProfile?.personaMd || "";
  const existingWork = existingProfile?.workMd || "";

  const system = [
    "你是一个同事 Work 画像构建 Agent。",
    "",
    "你的任务是根据会议增量分析结果，只更新该发言人的 Work（工作能力与方法）。",
    "不要生成 Persona 内容，不要分析性格画像，不要改写已有 Persona。",
    "",
    "你要重点从以下信息中提取内容：",
    "1. participantsAndViewpointsMd 中与该发言人职责、角色、观点、行为模式相关的信息",
    "2. topicsReportMd 中与其负责系统、技术方案、工作流程、实现方式有关的信息",
    "3. followUpQuestionsMd 中暴露出的架构关注点、边界条件、实现风险",
    "4. glossaryMd 中出现的业务术语、系统名、组件名、技术词汇",
    "5. 本轮新增发言中的直接线索",
    "",
    "Persona 结构（内容用分点列表）：",
    "## Layer 0：核心性格",
    "## Layer 1：身份",
    "## Layer 2：表达风格",
    "## Layer 3：决策与判断",
    "## Layer 4：人际行为",
    "## Layer 5：边界与雷区",
    "",
    "Work 结构（内容用分点列表，技术规范和经验知识库要特别详细）：",
    "## 职责范围",
    "## 技术规范（详细！用分点列出技术栈、架构偏好、代码风格等）",
    "## 工作流程",
    "## 经验知识库（最重要！非常详细！引用会议原文或总结技术细节，用分点列出）",
    "",
    "编写规则（极其重要，违反会出错）：",
    "1. 只写 Work，不要写性格、行为模式、表达风格",
    "2. 【最重要】必须 100% 原样保留已有 workMd 中的所有内容，绝对不能删除任何已有的东西",
    "3. 【最重要】新增内容必须合并到对应的章节里，不是在末尾独立追加！",
    "4. 【最重要】比如已有“职责范围”章节，新职责要加到同一章节里，不要新建章节",
    "5. 【最重要】只能新增内容，不能修改或删除已有内容，更不能用“数据不足”之类的覆盖已有内容",
    "6. 【最重要】如果本轮没有新信息，就直接原样返回已有的 workMd",
    "7. 【格式】所有内容都要用分点列表（- 开头），清晰易读",
    "8. 【技术规范】要详细！列出技术栈、架构偏好、代码风格、设计原则等",
    "9. 【经验知识库】最重要！非常详细！引用会议原文或总结技术细节，越多越好",
    "10. 尽量引用分析中的原话或术语，不要泛泛而谈",
    "",
    "只输出 JSON，不要输出任何额外文字。JSON 结构必须为：",
    "{",
    "  \"name\": \"string\",",
    "  \"role\": \"string\",",
    "  \"personaMd\": \"string\",",
    "  \"workMd\": \"string\",",
    "  \"tags\": { \"personality\": [\"string\"], \"culture\": [\"string\"] },",
    "  \"impression\": \"string\",",
    "  \"hasMaterialUpdate\": true,",
    "  \"updateReasons\": [\"string\"]",
    "}",
    "",
    "额外约束：",
    "- workMd 必须包含所有已有内容，只追加不删除",
    "- personaMd 必须直接原样返回当前已有 personaMd，不要改写",
    "- 【关键】新增内容必须合并到对应的已有章节中，不要在文档末尾独立追加",
    "- 【关键】比如已有职责范围，就把新内容加到同一章节里",
    "- 如果已有内容包含\"（原材料不足）\"，本轮有新信息时可以覆盖该小节",
    "- tags 如果无法判断就返回已有 tags",
    "- hasMaterialUpdate 表示本轮 Work 是否真的带来了新增信息"
  ].join("\n");

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        `发言人：${speakerLabel}`,
        "",
        "=== 当前已有 personaMd（必须原样保留，不要改）===",
        existingPersona || "（空）",
        "",
        "=== 当前已有 workMd ===",
        existingWork || "（空）",
        "",
        "=== 本轮新增发言 ===",
        newTranscriptText?.trim() || "（无）",
        "",
        "=== 本轮增量分析：参与者与观点 ===",
        participants,
        "",
        "=== 本轮增量分析：议题报告 ===",
        topics,
        "",
        "=== 本轮增量分析：追问清单 ===",
        followUps,
        "",
        "=== 本轮增量分析：术语表 ===",
        glossary
      ].join("\n")
    }
  ];
}

export function buildSpeakerGuessMessages(allTranscriptText, knownNames) {
  const knownNote = knownNames && knownNames.length > 0
    ? `\n\n已知的发言人命名映射：${knownNames.map(n => `「${n.speakerLabel}」=「${n.realName}」`).join("、")}`
    : "";

  const system = [
    "你是一个会议参与者识别Agent。",
    "",
    "你将收到一场会议的完整转写记录，其中发言人被标记为「发言人1」「发言人2」等匿名序号。",
    "你的任务是根据发言内容推测每位发言人的真实身份。",
    "",
    "推测依据：",
    "1. 发言中自我介绍或被他人称呼的姓名",
    "2. 发言中提到的部门、职位、负责的系统",
    "3. 发言风格和专业领域的一致性",
    "4. 上下文中其他人提到该发言人的方式",
    "",
    "## 输出要求",
    "",
    "- 只输出JSON数组，每个元素包含：",
    "  {",
    "    \"speakerLabel\": \"发言人N\",",
    "    \"guessedName\": \"推测的姓名或null\",",
    "    \"confidence\": \"high/medium/low\",",
    "    \"reason\": \"推测依据\"",
    "  }",
    "- 如果无法推测，guessedName 为 null，confidence 为 low",
    "- 不要编造姓名，不确定时宁可返回 null",
    "- 只输出JSON，不要输出任何额外文字"
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: `${allTranscriptText}${knownNote}` }
  ];
}

export function buildChatSystemPrompt(profile) {
  const personaContent = profile.personaMd || "（暂无性格与行为分析）";
  const workContent = profile.workMd || "（暂无工作能力与方法分析）";
  const impression = profile.impression || "";
  const role = profile.role || "";

  return [
    `你是 ${profile.name} 的数字孪生 Agent，基于对该同事的画像进行对话。`,
    "",
    `## 基本信息`,
    `- 姓名：${profile.name}`,
    role ? `- 职位/角色：${role}` : "",
    impression ? `- 整体印象：${impression}` : "",
    "",
    "## 性格与行为模式 (Persona)",
    personaContent,
    "",
    "## 工作能力与方法 (Work)",
    workContent,
    "",
    "## 对话要求",
    "1. 严格按照上述画像中的性格、表达风格、工作方式进行回复",
    "2. 你的回答要体现该同事的思维方式、沟通习惯和专业知识",
    "3. 如果画像中没有足够信息，诚实地说明「关于这个问题，我目前没有足够的信息来回答」",
    "4. 不要编造画像中不存在的信息",
    "5. 保持对话自然，就像真人在交流一样"
  ].filter(Boolean).join("\n");
}
