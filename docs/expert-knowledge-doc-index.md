# 抽象专家知识画像文档索引

## 文档列表

### 1. 落地方案

- 文件：[expert-knowledge-implementation-plan.md](file:///c:/Users/Swire_YZ/Desktop/meet-helper/docs/expert-knowledge-implementation-plan.md)
- 作用：
  - 看系统怎么分层
  - 看整体怎么落地
  - 看为什么要从人物画像切到抽象专家知识画像

### 2. 任务清单

- 文件：[expert-knowledge-task-list.md](file:///c:/Users/Swire_YZ/Desktop/meet-helper/docs/expert-knowledge-task-list.md)
- 作用：
  - 按阶段明确做什么
  - 明确依赖关系
  - 明确验收点

### 3. 设计说明与讨论汇总

- 文件：[expert-knowledge-design-notes.md](file:///c:/Users/Swire_YZ/Desktop/meet-helper/docs/expert-knowledge-design-notes.md)
- 作用：
  - 回看我们这轮讨论中的细节
  - 保留设计取舍和原因
  - 防止后续实现时丢掉关键边界

### 4. Schema 草案

- 文件：[expert-knowledge-schema-draft.md](file:///c:/Users/Swire_YZ/Desktop/meet-helper/docs/expert-knowledge-schema-draft.md)
- 作用：
  - 直接定义核心 JSON 结构
  - 定义事件、状态、聚合结构
  - 后续实现时可以直接照着建文件和接口

## 推荐阅读顺序

### 如果要先理解全局

1. [expert-knowledge-design-notes.md](file:///c:/Users/Swire_YZ/Desktop/meet-helper/docs/expert-knowledge-design-notes.md)
2. [expert-knowledge-implementation-plan.md](file:///c:/Users/Swire_YZ/Desktop/meet-helper/docs/expert-knowledge-implementation-plan.md)
3. [expert-knowledge-schema-draft.md](file:///c:/Users/Swire_YZ/Desktop/meet-helper/docs/expert-knowledge-schema-draft.md)
4. [expert-knowledge-task-list.md](file:///c:/Users/Swire_YZ/Desktop/meet-helper/docs/expert-knowledge-task-list.md)

### 如果要直接开始实现

1. [expert-knowledge-task-list.md](file:///c:/Users/Swire_YZ/Desktop/meet-helper/docs/expert-knowledge-task-list.md)
2. [expert-knowledge-schema-draft.md](file:///c:/Users/Swire_YZ/Desktop/meet-helper/docs/expert-knowledge-schema-draft.md)
3. [expert-knowledge-implementation-plan.md](file:///c:/Users/Swire_YZ/Desktop/meet-helper/docs/expert-knowledge-implementation-plan.md)
4. [expert-knowledge-design-notes.md](file:///c:/Users/Swire_YZ/Desktop/meet-helper/docs/expert-knowledge-design-notes.md)

## 对应关系

### 方案层

- `implementation-plan`

### 执行层

- `task-list`

### 解释层

- `design-notes`

### 数据层

- `schema-draft`

## 当前最适合先做的部分

如果下一步直接开始编码，建议先按以下顺序：

1. 读 `task-list` 的 Phase 1 和 Phase 2
2. 同步参考 `schema-draft` 中的：
   - `expert.json`
   - `meta.json`
   - `summary.json`
3. 先把专家目录和会议归档立起来
4. 再往上做记忆单元与聚合
