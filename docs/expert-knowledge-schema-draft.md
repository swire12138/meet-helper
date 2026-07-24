# 抽象专家知识画像 Schema 草案

## 1. 文档目标

本文件用于把“抽象专家知识画像系统”的核心数据结构一次定清，作为后续实现时的统一约束。

目标：

- 明确目录结构
- 明确文件级 schema
- 明确 ID 命名规则
- 明确事件状态机
- 明确抽离 / 迁移操作载荷
- 明确问答上下文组装输出结构

说明：

- 这里使用的是“工程实现草案”，不是正式 JSON Schema 标准文件。
- 重点是先把数据结构、字段含义、状态流转和最小约束定住。

## 2. 目录结构

```text
experts/
  {expertSlug}/
    expert.json
    portrait/
      summary.json
      expert.md
    meetings/
      {meetingId}/
        meta.json
        transcript.md
        images.json
        summary.json
        extracted_memories.json
    memory_units/
      units.jsonl
    events/
      ledger.jsonl
    aggregates/
      slots.json
```

## 3. 命名规则

## 3.1 `expertSlug`

规则：

- 小写英文字母、数字、连字符
- 不包含空格和中文
- 长度建议 `3~64`

示例：

- `diabetes-clinical`
- `af-management`
- `ai-product-strategy`

## 3.2 `meetingId`

规则：

- 前缀建议为 `meeting-`
- 包含日期时间和随机短串

示例：

```text
meeting-20260721-153045-a1b2c3
```

## 3.3 `memoryUnitId`

规则：

- 前缀建议为 `mem-`
- 与会议无强绑定，但必须全局唯一

示例：

```text
mem-20260721-153200-7xk29m
```

## 3.4 `eventId`

规则：

- 前缀建议为 `evt-`
- 事件账本内唯一

示例：

```text
evt-20260721-153500-j9q2fa
```

## 4. `expert.json`

用途：

- 定义一个抽象专家画像主实体

建议结构：

```json
{
  "slug": "diabetes-clinical",
  "name": "糖尿病临床专家",
  "domain": "糖尿病诊疗",
  "description": "面向糖尿病筛查、评估、降糖方案和并发症管理的抽象专家知识体。",
  "status": "active",
  "tags": ["内分泌", "糖尿病", "临床决策"],
  "createdAt": "2026-07-21T15:00:00.000Z",
  "updatedAt": "2026-07-21T15:00:00.000Z"
}
```

字段说明：

- `slug`: 专家唯一标识
- `name`: 展示名称
- `domain`: 核心领域
- `description`: 专家画像定位说明
- `status`: `active | archived`
- `tags`: 辅助分类标签
- `createdAt`: 创建时间
- `updatedAt`: 最近更新时间

最小必填：

- `slug`
- `name`
- `status`
- `createdAt`
- `updatedAt`

## 5. `meetings/{meetingId}/meta.json`

用途：

- 保存单次会议的元数据与归属关系

建议结构：

```json
{
  "meetingId": "meeting-20260721-153045-a1b2c3",
  "expertSlug": "diabetes-clinical",
  "title": "糖尿病患者起始降糖方案讨论",
  "sourceType": "screen-capture",
  "status": "active",
  "startedAt": "2026-07-21T15:30:45.000Z",
  "endedAt": "2026-07-21T16:18:12.000Z",
  "durationSec": 2847,
  "transcriptLineCount": 186,
  "imageCount": 12,
  "importanceLevel": "high",
  "ingestEventId": "evt-20260721-161820-j9q2fa",
  "notes": ""
}
```

字段说明：

- `sourceType`: `screen-capture | upload | import`
- `status`: `pending | active | retracted | moved`
- `importanceLevel`: `low | medium | high | critical`
- `ingestEventId`: 首次入账事件

## 6. `meetings/{meetingId}/images.json`

用途：

- 保存与会议关联的截图元信息

建议结构：

```json
{
  "meetingId": "meeting-20260721-153045-a1b2c3",
  "items": [
    {
      "id": "img-001",
      "time": "2026-07-21 15:31:02.321Z",
      "fileName": "screenshot-2026-07-21T15-31-02-321Z.png",
      "relativePath": "images/screenshot-2026-07-21T15-31-02-321Z.png",
      "width": 1920,
      "height": 1080,
      "sizeBytes": 183420
    }
  ]
}
```

## 7. `meetings/{meetingId}/summary.json`

用途：

- 保存单次会议的结构化摘要

建议结构：

```json
{
  "meetingId": "meeting-20260721-153045-a1b2c3",
  "expertSlug": "diabetes-clinical",
  "topicTitle": "糖尿病患者起始降糖方案与肾功能约束讨论",
  "currentWindowPriority": true,
  "coreConclusions": [
    "优先基于 HbA1c 与肾功能决定起始方案。",
    "肾结石既往史仅作为背景，不是当前主议题。"
  ],
  "newKnowledgePoints": [
    "在起始降糖方案选择中需同步评估肾功能。",
    "SGLT2 抑制剂适用性应放在当前窗口语境下讨论。"
  ],
  "reasoningFrameworks": [
    "先评估 HbA1c 和肾功能，再选择起始降糖路径。"
  ],
  "riskPoints": [
    "如果只盯 HbA1c 而忽略肾功能，可能导致方案不适配。"
  ],
  "temporaryContext": [
    "本次会议中反复提到的具体病例数据不直接进入长期稳定画像。"
  ],
  "excludedFromLongTerm": [
    "与当前会诊病例强绑定的即时安排",
    "无复用价值的具体时间节点"
  ],
  "evidenceSnippets": [
    "糖化血红蛋白已经 9.2%，现在先讨论降糖方案和胰岛素起始。",
    "还要结合肾功能评估二甲双胍和 SGLT2 抑制剂是否适合。"
  ],
  "createdAt": "2026-07-21T16:18:20.000Z"
}
```

## 8. `meetings/{meetingId}/extracted_memories.json`

用途：

- 保存本次会议抽取出的记忆单元快照，便于回看和重放

建议结构：

```json
{
  "meetingId": "meeting-20260721-153045-a1b2c3",
  "expertSlug": "diabetes-clinical",
  "memoryUnitIds": [
    "mem-20260721-161900-7xk29m",
    "mem-20260721-161901-1n0ytr"
  ],
  "count": 2,
  "createdAt": "2026-07-21T16:19:01.000Z"
}
```

## 9. `memory_units/units.jsonl`

用途：

- 作为专家知识体的底层记忆库

每行一个 JSON 对象。

建议结构：

```json
{
  "id": "mem-20260721-161900-7xk29m",
  "expertSlug": "diabetes-clinical",
  "meetingId": "meeting-20260721-153045-a1b2c3",
  "slot": "reasoning_frameworks",
  "value": "先评估 HbA1c 和肾功能，再确定起始降糖方案",
  "valueType": "framework",
  "scope": "mid_term",
  "weight": 5.2,
  "confidence": 0.88,
  "evidence": [
    "糖化血红蛋白已经 9.2%，现在先讨论降糖方案和胰岛素起始。",
    "还要结合肾功能评估二甲双胍和 SGLT2 抑制剂是否适合。"
  ],
  "sourceType": "explicit_statement",
  "status": "active",
  "createdAt": "2026-07-21T16:19:00.000Z",
  "updatedAt": "2026-07-21T16:19:00.000Z"
}
```

字段说明：

- `slot`: 必须来自预定义槽位字典
- `valueType`: `fact | principle | framework | topic | preference | terminology | risk | temporary_context`
- `scope`: `long_term | mid_term | short_term`
- `sourceType`: `explicit_statement | repeated_pattern | inferred`
- `status`: `active | retracted | superseded`

## 10. 槽位配置字典

可定义为内存常量，或保存为独立 JSON 文件。

建议结构：

```json
{
  "core_domain": {
    "scope": "long_term",
    "historyCap": 120,
    "tauDays": 180,
    "switchThreshold": 1.2
  },
  "core_principles": {
    "scope": "long_term",
    "historyCap": 120,
    "tauDays": 180,
    "switchThreshold": 1.2
  },
  "reasoning_frameworks": {
    "scope": "mid_term",
    "historyCap": 100,
    "tauDays": 120,
    "switchThreshold": 1.15
  },
  "recent_focus_topics": {
    "scope": "mid_term",
    "historyCap": 30,
    "tauDays": 30,
    "switchThreshold": 1.05
  },
  "temporary_hypotheses": {
    "scope": "short_term",
    "historyCap": 15,
    "tauDays": 7,
    "switchThreshold": 1.0
  }
}
```

## 11. `aggregates/slots.json`

用途：

- 保存当前各槽位的聚合状态

建议结构：

```json
{
  "expertSlug": "diabetes-clinical",
  "updatedAt": "2026-07-21T16:20:00.000Z",
  "slots": {
    "reasoning_frameworks": {
      "slot": "reasoning_frameworks",
      "dominantValue": "先评估 HbA1c 和肾功能，再确定起始降糖方案",
      "dominantScore": 42.6,
      "runnerUpValue": "优先按并发症风险选择起始路径",
      "runnerUpScore": 17.3,
      "confidence": 0.78,
      "lastUpdatedAt": "2026-07-21T16:20:00.000Z",
      "sourceMeetingIds": [
        "meeting-20260721-153045-a1b2c3",
        "meeting-20260718-101500-f4m8qd"
      ],
      "candidateValues": [
        {
          "value": "先评估 HbA1c 和肾功能，再确定起始降糖方案",
          "score": 42.6,
          "meetingCount": 3,
          "lastSeenAt": "2026-07-21T16:19:00.000Z"
        },
        {
          "value": "优先按并发症风险选择起始路径",
          "score": 17.3,
          "meetingCount": 2,
          "lastSeenAt": "2026-07-18T10:15:00.000Z"
        }
      ]
    }
  }
}
```

## 12. `portrait/summary.json`

用途：

- 保存供 UI 和问答上层使用的结构化专家画像

建议结构：

```json
{
  "expertSlug": "diabetes-clinical",
  "name": "糖尿病临床专家",
  "updatedAt": "2026-07-21T16:21:00.000Z",
  "coreDomain": [
    "糖尿病诊疗"
  ],
  "corePrinciples": [
    "优先依据当前窗口问题组织判断，不被历史背景议题绑住。",
    "起始降糖方案必须结合 HbA1c 与肾功能。"
  ],
  "reasoningFrameworks": [
    "先评估 HbA1c 和肾功能，再确定起始降糖路径。"
  ],
  "recentFocusTopics": [
    "胰岛素起始",
    "SGLT2 抑制剂适用性"
  ],
  "temporaryHypotheses": [
    "当前更偏向把肾功能作为方案选择前置条件。"
  ],
  "terminologySystem": [
    "HbA1c",
    "SGLT2"
  ],
  "sourceMeetingCount": 6
}
```

## 13. `portrait/expert.md`

用途：

- 给用户展示的可读专家画像正文

建议结构由程序生成，不再作为权威数据源。

只要求：

- 内容来源于 `portrait/summary.json`
- 内容可重建
- 不手工作为真实底层数据去编辑

## 14. `events/ledger.jsonl`

用途：

- 保存所有可回放、可撤回、可迁移事件

每行一个 JSON 对象。

### 14.1 入账事件

```json
{
  "eventId": "evt-20260721-161820-j9q2fa",
  "type": "meeting_ingest",
  "status": "active",
  "expertSlug": "diabetes-clinical",
  "meetingId": "meeting-20260721-153045-a1b2c3",
  "memoryUnitIds": [
    "mem-20260721-161900-7xk29m",
    "mem-20260721-161901-1n0ytr"
  ],
  "slotImpacts": [
    {
      "slot": "reasoning_frameworks",
      "value": "先评估 HbA1c 和肾功能，再确定起始降糖方案",
      "weight": 5.2
    }
  ],
  "createdAt": "2026-07-21T16:18:20.000Z"
}
```

### 14.2 整场抽离事件

```json
{
  "eventId": "evt-20260722-101500-kf91az",
  "type": "meeting_retract",
  "status": "active",
  "expertSlug": "diabetes-clinical",
  "meetingId": "meeting-20260721-153045-a1b2c3",
  "targetEventId": "evt-20260721-161820-j9q2fa",
  "reason": "会议误归属到错误专家",
  "createdAt": "2026-07-22T10:15:00.000Z"
}
```

### 14.3 迁移事件

```json
{
  "eventId": "evt-20260722-103000-r2m8nb",
  "type": "meeting_move",
  "status": "active",
  "fromExpertSlug": "af-management",
  "toExpertSlug": "diabetes-clinical",
  "meetingId": "meeting-20260721-153045-a1b2c3",
  "retractEventId": "evt-20260722-102000-qt4gca",
  "replayEventId": "evt-20260722-103001-fc5k1q",
  "reason": "会议实际属于糖尿病专题",
  "createdAt": "2026-07-22T10:30:00.000Z"
}
```

## 15. 事件状态机

统一状态建议：

- `pending`
- `active`
- `retracted`
- `moved`
- `failed`

### 15.1 会议状态流转

```text
pending -> active
active -> retracted
active -> moved
pending -> failed
```

### 15.2 记忆单元状态流转

```text
active -> retracted
active -> superseded
```

## 16. 抽离操作载荷

建议后端接口载荷：

```json
{
  "expertSlug": "diabetes-clinical",
  "meetingId": "meeting-20260721-153045-a1b2c3",
  "reason": "选择专家错误，需整体抽离"
}
```

返回建议：

```json
{
  "ok": true,
  "data": {
    "retractEventId": "evt-20260722-101500-kf91az",
    "affectedMemoryUnitCount": 12,
    "affectedSlotCount": 4
  }
}
```

## 17. 迁移操作载荷

建议后端接口载荷：

```json
{
  "meetingId": "meeting-20260721-153045-a1b2c3",
  "fromExpertSlug": "af-management",
  "toExpertSlug": "diabetes-clinical",
  "reason": "原归属错误，应迁移到糖尿病专家"
}
```

返回建议：

```json
{
  "ok": true,
  "data": {
    "moveEventId": "evt-20260722-103000-r2m8nb",
    "retractedFrom": "af-management",
    "replayedTo": "diabetes-clinical"
  }
}
```

## 18. 单条记忆单元抽离载荷

```json
{
  "expertSlug": "diabetes-clinical",
  "memoryUnitId": "mem-20260721-161900-7xk29m",
  "reason": "该条为临时病例信息，不应进入长期专家画像"
}
```

## 19. 问答上下文组装输出 schema

用途：

- 给问答模型使用的结构化上下文包

建议结构：

```json
{
  "expertSlug": "diabetes-clinical",
  "questionType": "topic_solution",
  "portraitContext": {
    "corePrinciples": [
      "优先依据当前窗口问题组织判断，不被历史背景议题绑住。"
    ],
    "reasoningFrameworks": [
      "先评估 HbA1c 和肾功能，再确定起始降糖路径。"
    ]
  },
  "relatedMeetingSummaries": [
    {
      "meetingId": "meeting-20260721-153045-a1b2c3",
      "topicTitle": "糖尿病患者起始降糖方案与肾功能约束讨论",
      "coreConclusions": [
        "起始方案选择必须同步看 HbA1c 与肾功能。"
      ]
    }
  ],
  "evidenceSnippets": [
    "糖化血红蛋白已经 9.2%，现在先讨论降糖方案和胰岛素起始。",
    "还要结合肾功能评估二甲双胍和 SGLT2 抑制剂是否适合。"
  ],
  "assembledAt": "2026-07-22T11:00:00.000Z"
}
```

## 20. 最小校验规则

建议首版先做以下最小校验：

- 所有时间字段必须是 ISO 字符串
- 所有 ID 字段不能为空
- `meetingId` 必须归属于某个存在的专家
- `memory unit` 必须能追溯到会议
- `event` 必须能追溯到会议或目标对象
- `slot` 必须来自槽位字典
- `status` 必须来自枚举

## 21. 最小实现优先级

如果要一次到位但先求可落地，建议最小必做 schema 是：

1. `expert.json`
2. `meetings/{meetingId}/meta.json`
3. `meetings/{meetingId}/summary.json`
4. `memory_units/units.jsonl`
5. `events/ledger.jsonl`
6. `aggregates/slots.json`
7. `portrait/summary.json`

这七项一旦稳定，后面的抽离、迁移、问答组装都会顺很多。
