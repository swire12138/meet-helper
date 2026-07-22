const fs = require("fs");
const path = require("path");

const filePath = path.resolve(process.cwd(), "web-static/app.js");
let text = fs.readFileSync(filePath, "utf8");

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`missing anchor: ${label}`);
  }
  return source.replace(search, replacement);
}

text = replaceOnce(
  text,
  `    const currentCaptureProfileSlug = ref(null);
`,
  `    const currentCaptureProfileSlug = ref(null);
    const meetingAdviceItems = ref([]);
    const meetingAdvisorLoading = ref(false);
    const meetingAdvisorStatus = ref("录制中遇到阻塞、错误或明显风险时，这里会主动出现建议。");
    const meetingAdvisorEnabled = ref(true);
    const lastMeetingAdviceFingerprint = ref("");
`,
  "meeting advisor refs"
);

text = replaceOnce(
  text,
  `    function getTranscriptDisplay() {
      const content = transcriptLines.value.slice().map(line => {
        return line.replace(/\\[([^\\]]+)\\]\\s*\\[([^\\]]+)\\]/g, (match, ts, speaker) => {
          const displayName = speakerNameMap.value[speaker] || speaker;
          return \`[\${ts}] [\${displayName}]\`;
        });
      });
      if (transcriptDraft.value) {
        content.push(\`[识别中] \${transcriptDraft.value}\`);
      }
      return content.length ? content.join("\\n") : "暂无";
    }
`,
  `    function getTranscriptDisplay() {
      const content = transcriptLines.value.slice().map(line => {
        return line.replace(/\\[([^\\]]+)\\]\\s*\\[([^\\]]+)\\]/g, (match, ts, speaker) => {
          const displayName = speakerNameMap.value[speaker] || speaker;
          return \`[\${ts}] [\${displayName}]\`;
        });
      });
      if (transcriptDraft.value) {
        content.push(\`[识别中] \${transcriptDraft.value}\`);
      }
      return content.length ? content.join("\\n") : "暂无";
    }

    function getCurrentCaptureProfile() {
      if (!currentCaptureProfileSlug.value) return null;
      return profileList.value.find((item) => item.slug === currentCaptureProfileSlug.value) || null;
    }

    function buildMeetingAdviceFingerprint(item) {
      return [item?.title || "", item?.summary || "", item?.suggestion || ""].join("|").trim();
    }

    function removeMeetingAdvice(id) {
      meetingAdviceItems.value = meetingAdviceItems.value.filter((item) => item.id !== id);
    }

    async function requestMeetingAdvice({ recentLines = [], contextLines = [], isFinal = false } = {}) {
      if (!meetingAdvisorEnabled.value || meetingAdvisorLoading.value) return;
      const recent = Array.isArray(recentLines) ? recentLines.map((item) => String(item || "").trim()).filter(Boolean) : [];
      const context = Array.isArray(contextLines) ? contextLines.map((item) => String(item || "").trim()).filter(Boolean) : [];
      if (recent.length === 0 && !isFinal) return;

      meetingAdvisorLoading.value = true;
      meetingAdvisorStatus.value = "正在快速判断是否需要给会议建议...";
      try {
        const triggerResp = await fetch("/api/meeting-advisor/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recentLines: recent.slice(-8),
            contextLines: context.slice(-12),
            recentSummary: meetingAdviceItems.value.slice(0, 2).map((item) => item.summary || item.title).filter(Boolean).join("；")
          })
        });
        const trigger = await triggerResp.json().catch(() => null);
        if (!triggerResp.ok || !trigger?.ok || !trigger?.data) {
          meetingAdvisorStatus.value = \`会议建议预判失败：\${trigger?.message || trigger?.error || \`http_\${triggerResp.status}\`}\`;
          return;
        }

        if (!trigger.data.shouldTrigger) {
          meetingAdvisorStatus.value = trigger.data.reason || "这一段暂时没有明显阻塞或错误信号。";
          return;
        }

        const profile = getCurrentCaptureProfile();
        const basePayload = {
          signalType: trigger.data.signalType || "",
          focusSpan: trigger.data.focusSpan || "",
          recentLines: recent.slice(-8),
          contextLines: context.slice(-12),
          recentSummary: meetingAdviceItems.value.slice(0, 2).map((item) => item.summary || item.title).filter(Boolean).join("；"),
          profileName: profile?.name || "",
          profileRole: profile?.role || "",
          pendingAdvice: meetingAdviceItems.value.slice(0, 5)
        };

        meetingAdvisorStatus.value = "已命中会议信号，正在生成建议...";
        const adviceResp = await fetch("/api/meeting-advisor/advice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(basePayload)
        });
        let adviceResult = await adviceResp.json().catch(() => null);
        if (!adviceResp.ok || !adviceResult?.ok || !adviceResult?.data) {
          meetingAdvisorStatus.value = \`会议建议生成失败：\${adviceResult?.message || adviceResult?.error || \`http_\${adviceResp.status}\`}\`;
          return;
        }

        let adviceData = adviceResult.data;
        if (adviceData.needWebSearch && adviceData.searchQuery) {
          meetingAdvisorStatus.value = "正在补充外部资料后再给建议...";
          const searchResp = await fetch("/api/meeting-advisor/web-search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: adviceData.searchQuery })
          });
          const searchResult = await searchResp.json().catch(() => null);
          const webContext = Array.isArray(searchResult?.data?.items) ? searchResult.data.items : [];
          if (webContext.length > 0) {
            const enrichedResp = await fetch("/api/meeting-advisor/advice", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...basePayload,
                webContext
              })
            });
            const enriched = await enrichedResp.json().catch(() => null);
            if (enrichedResp.ok && enriched?.ok && enriched?.data) {
              adviceData = enriched.data;
            }
          }
        }

        const fingerprint = buildMeetingAdviceFingerprint(adviceData);
        if (!fingerprint || fingerprint === lastMeetingAdviceFingerprint.value || meetingAdviceItems.value.some((item) => buildMeetingAdviceFingerprint(item) === fingerprint)) {
          meetingAdvisorStatus.value = "这次识别到的建议和最近内容重复，已自动跳过。";
          return;
        }

        lastMeetingAdviceFingerprint.value = fingerprint;
        meetingAdviceItems.value = [
          {
            id: \`meeting-advice-\${Date.now()}-\${Math.random().toString(36).slice(2, 8)}\`,
            signalType: trigger.data.signalType || "",
            title: adviceData.title || "会议建议",
            adviceType: adviceData.adviceType || "proposal",
            summary: adviceData.summary || trigger.data.reason || "",
            suggestion: adviceData.suggestion || "",
            nextQuestion: adviceData.nextQuestion || "",
            sourceNote: adviceData.sourceNote || (adviceData.needWebSearch ? "已尝试补充外部资料。" : "基于当前会议内容生成。")
          },
          ...meetingAdviceItems.value
        ].slice(0, 8);
        meetingAdvisorStatus.value = "已生成一条新的会议建议。";
      } catch (e) {
        console.error("meeting advisor request error:", e);
        meetingAdvisorStatus.value = \`会议建议请求出错：\${e?.message || "network_error"}\`;
      } finally {
        meetingAdvisorLoading.value = false;
      }
    }
`,
  "meeting advisor functions"
);

text = replaceOnce(
  text,
  `        let contextTranscriptText = contextLines.join("\\n");

        let prevAnalysisPayload = null;
`,
  `        let contextTranscriptText = contextLines.join("\\n");
        if ((newLines.length >= 2 || (isFinal && newTranscriptText.trim())) && !meetingAdvisorLoading.value) {
          Promise.resolve()
            .then(() => requestMeetingAdvice({
              recentLines: newLines.slice(-8),
              contextLines: contextLines.slice(-12),
              isFinal
            }))
            .catch((advisorErr) => {
              console.error("meeting advisor background error:", advisorErr);
            });
        }

        let prevAnalysisPayload = null;
`,
  "meeting advisor call"
);

text = replaceOnce(
  text,
  `      <div class="card monitor">
        <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;">
          <span>实时转写</span>
          <div class="subtle">当前更新画像：{{ currentCaptureProfileSlug ? getProfileNameBySlug(currentCaptureProfileSlug) : '未选择' }}</div>
        </div>
        <div class="pre">{{ getTranscriptDisplay() }}</div>
      </div>

      <div class="card monitor">
`,
  `      <div class="card monitor">
        <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;">
          <span>实时转写</span>
          <div class="subtle">当前更新画像：{{ currentCaptureProfileSlug ? getProfileNameBySlug(currentCaptureProfileSlug) : '未选择' }}</div>
        </div>
        <div class="pre">{{ getTranscriptDisplay() }}</div>
      </div>

      <div class="card monitor">
        <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
          <span>会议建议</span>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <label class="subtle" style="display:flex;gap:6px;align-items:center;cursor:pointer;">
              <input type="checkbox" v-model="meetingAdvisorEnabled" />
              <span>启用主动建议</span>
            </label>
            <div class="subtle">{{ meetingAdvisorLoading ? '判断中...' : \`\${meetingAdviceItems.length} 条\` }}</div>
          </div>
        </div>
        <div class="hint" style="margin-top:0;">{{ meetingAdvisorStatus }}</div>
        <div v-if="meetingAdviceItems.length === 0" class="hint">还没有触发会议建议。</div>
        <div v-for="item in meetingAdviceItems" :key="item.id" style="margin-top:12px;padding:12px;border:1px solid var(--border-color);border-radius:10px;background:#fff;">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
            <div>
              <div class="subtle">{{ item.signalType || item.adviceType }}</div>
              <div style="font-weight:700;margin-top:4px;">{{ item.title }}</div>
            </div>
            <button class="btn secondary" @click="removeMeetingAdvice(item.id)">删除</button>
          </div>
          <div class="hint" style="margin-top:8px;">{{ item.summary }}</div>
          <div class="md" style="margin-top:8px;" v-html="renderMd(item.suggestion)"></div>
          <div v-if="item.nextQuestion" class="hint" style="margin-top:8px;">建议追问：{{ item.nextQuestion }}</div>
          <div class="subtle" style="margin-top:8px;">{{ item.sourceNote }}</div>
        </div>
      </div>

      <div class="card monitor">
`,
  "meeting advisor template"
);

text = replaceOnce(
  text,
  `      transcriptLines,
      showCaptureProfileModal,
`,
  `      transcriptLines,
      meetingAdviceItems,
      meetingAdvisorLoading,
      meetingAdvisorStatus,
      meetingAdvisorEnabled,
      removeMeetingAdvice,
      showCaptureProfileModal,
`,
  "meeting advisor return"
);

fs.writeFileSync(filePath, text, "utf8");
console.log("updated", filePath);
