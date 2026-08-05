[OPEN] meeting-move-crash

# Debug Session: meeting-move-crash

## Symptom
- 会议执行迁移操作时，服务崩溃或页面提示无服务。

## Scope
- 关注 `POST /api/profiles/move-meeting` 及其调用链。

## Hypotheses
- H1: 迁移过程中复制或删除会议目录时触发文件系统异常，异常未被正确记录，导致进程退出。
- H2: 迁移后重建画像聚合时读到了不一致的会议数据，触发未捕获异常。
- H3: 前端发送的 `fromExpertSlug`、`toExpertSlug`、`meetingId` 某个字段异常，后端在某个分支里访问空值后崩溃。
- H4: 迁移链路里“先复制再抽离”的顺序导致同一会议的中间态被聚合逻辑读到，触发运行时错误。
- H5: `node --watch` 崩溃信息被吞掉了，实际并非接口逻辑，而是启动后某段同步文件操作阻塞/报错导致进程退出。

## Evidence
- 已确认此前 `8787` 端口被旧 `node --watch src/index.js` 进程占用，浏览器可能命中了旧实例。
- 在干净重启后的受控实例上，`meeting-e2e-002` 可在 `test-expert-a` 与 `test-expert-b` 间成功来回迁移。
- Debug Server 已记录到迁移前半段证据：
  - 路由入参正常
  - `sourceMeta` 与 `targetExpert` 均存在
  - 源/目标会议目录存在状态正常
  - 会议目录复制成功
  - 目标侧 `extracted.items` 数量为 12
- 用户在真实页面上再次点击迁移后，服务确实崩溃，`8787` 端口不可达。
- 在改成同步上报后，真实问题会议 `meeting-20260728-170530` 的崩溃前最后一条埋点停在 `expertKnowledge.js:move:paths`，说明崩溃发生在原始 `fs.cpSync / fs.rmSync` 路径处理阶段。
- 修复后再次复现，同一真实会议已完整经过：
  - `move:target-remove:start/done`
  - `move:copy:start/copied`
  - `appendMemoryHistory:start/loaded/written`
  - `appendMeetingEvent:start/done`
  - `retract:start/done`
  - `move:done`
  - `move-route:result ok=true`
- 修复后浏览器侧 `POST /api/profiles/move-meeting` 成功，源专家下会议变为 `retracted`，目标专家 `test-expert-a` 下会议状态为 `active`。

## Instrumentation
- 已在 `server/src/index.js` 的 `/api/profiles/move-meeting` 路由入口、结果返回、catch 分支增加调试上报。
- 已在 `server/src/expertKnowledge.js` 的 `moveMeetingToExpert()` 中增加以下埋点：
  - 入口参数
  - 预检查结果
  - 源/目标路径状态
  - 目录复制完成
  - extracted item 数量
  - 后续 `retract` / `recompute` 预留埋点

## Fix
- 将 `moveMeetingToExpert()` 中的原生 `fs.cpSync(..., { recursive: true })` 和目标目录重置逻辑替换为手动递归实现：
  - `removePathRecursiveSync()`
  - `copyPathRecursiveSync()`
- 该修复避开了真实会议目录在 Windows/Node 环境下触发的原生级进程崩溃。

## Verification
- 已在浏览器中对真实会议“急性粪便嵌塞伴剧痛的全科临床处理与决策路径”执行迁移到 `test-expert-a`：
  - 页面成功关闭迁移表单
  - 源专家数量由 3 变 2
  - 目标专家数量由 1 变 2
  - 服务未崩溃
  - 接口与调试日志均显示成功完成
