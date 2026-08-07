# [OPEN] 手动要求未生效调试记录

## Session
- sessionId: `manual-advice-override`
- startedAt: 2026-08-06
- symptom: 用户输入“手动要求”后，主动会议建议看起来没有按要求调整

## Hypotheses
1. 前端触发时没有把最新 `manualInstruction` 带进 `/api/meeting-advisor/advice` 请求体。
2. 后端路由收到了字段，但进入 `generateMeetingAdvice(...)` 前被规范化成空字符串。
3. `manualInstruction` 已进入 prompt，但在 prompt 中权重过弱，模型没有把它当成硬约束。
4. 建议结果里没有显式回显“已遵循手动要求”的痕迹，用户感知上像未生效。

## Plan
1. 给前端请求和后端建议生成入口加埋点。
2. 复现一次手动要求生成建议。
3. 对照日志确认字段是否贯通，以及在何处失真。
4. 基于证据做最小修复并再次验证。
