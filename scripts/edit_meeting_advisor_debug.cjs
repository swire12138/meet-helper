const fs = require("fs");
const path = require("path");

const filePath = path.resolve(process.cwd(), "web-static/app.js");
let text = fs.readFileSync(filePath, "utf8");

function replaceOnce(search, replacement, label) {
  if (!text.includes(search)) {
    throw new Error(`missing anchor: ${label}`);
  }
  text = text.replace(search, replacement);
}

replaceOnce(
  `    const meetingAdvisorEnabled = ref(true);
    const lastMeetingAdviceFingerprint = ref("");
`,
  `    const meetingAdvisorEnabled = ref(true);
    const lastMeetingAdviceFingerprint = ref("");
    const meetingAdvisorDebug = ref({
      updatedAt: "",
      recentLines: [],
      contextLines: [],
      trigger: null,
      advice: null,
      search: null,
      skippedReason: "",
      error: ""
    });
`,
  "debug refs"
);

replaceOnce(
  `    function renderMd(md) {
      const source = md ?? "";
      if (!source) return "";
      let html = "";
      try {
        if (markedLib && typeof markedLib.parse === "function") {
          html = markedLib.parse(source);
        } else if (typeof markedLib === "function") {
          html = markedLib(source);
        } else {
          html = source;
        }
      } catch(e) {
        console.error("Marked parse error:", e);
        html = source;
      }
      
      const purifyConfig = {
        ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'p', 'a', 'ul', 'ol',
          'nl', 'li', 'b', 'i', 'strong', 'em', 'strike', 'code', 'hr', 'br', 'div',
          'table', 'thead', 'caption', 'tbody', 'tr', 'th', 'td', 'pre', 'span'],
        ALLOWED_ATTR: ['href', 'name', 'target', 'class']
      };
      
      return globalThis.DOMPurify?.sanitize ? globalThis.DOMPurify.sanitize(html, purifyConfig) : html;
    }
`,
  `    function renderMd(md) {
      const source = md ?? "";
      if (!source) return "";
      let html = "";
      try {
        if (markedLib && typeof markedLib.parse === "function") {
          html = markedLib.parse(source);
        } else if (typeof markedLib === "function") {
          html = markedLib(source);
        } else {
          html = source;
        }
      } catch(e) {
        console.error("Marked parse error:", e);
        html = source;
      }
      
      const purifyConfig = {
        ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'p', 'a', 'ul', 'ol',
          'nl', 'li', 'b', 'i', 'strong', 'em', 'strike', 'code', 'hr', 'br', 'div',
          'table', 'thead', 'caption', 'tbody', 'tr', 'th', 'td', 'pre', 'span'],
        ALLOWED_ATTR: ['href', 'name', 'target', 'class']
      };
      
      return globalThis.DOMPurify?.sanitize ? globalThis.DOMPurify.sanitize(html, purifyConfig) : html;
    }

    function formatDebugJson(value) {
      if (value == null) return "暂无";
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
`,
  "format debug json"
);

replaceOnce(
  `    function buildMeetingAdviceFingerprint(item) {
      return [item?.title || "", item?.summary || "", item?.suggestion || ""].join("|").trim();
    }

    function removeMeetingAdvice(id) {
`,
  `    function buildMeetingAdviceFingerprint(item) {
      return [item?.title || "", item?.summary || "", item?.suggestion || ""].join("|").trim();
    }

    function updateMeetingAdvisorDebug(patch = {}) {
      meetingAdvisorDebug.value = {
        ...meetingAdvisorDebug.value,
        ...patch,
        updatedAt: new Date().toLocaleTimeString()
      };
    }

    function removeMeetingAdvice(id) {
`,
  "debug updater"
);

replaceOnce(
  `      meetingAdvisorLoading.value = true;
      meetingAdvisorStatus.value = "正在快速判断是否需要给会议建议...";
      try {
`,
  `      meetingAdvisorLoading.value = true;
      meetingAdvisorStatus.value = "正在快速判断是否需要给会议建议...";
      updateMeetingAdvisorDebug({
        recentLines: recent.slice(-8),
        contextLines: context.slice(-12),
        trigger: null,
        advice: null,
        search: null,
        skippedReason: "",
        error: ""
      });
      try {
`,
  "debug init"
);

replaceOnce(
  `        const trigger = await triggerResp.json().catch(() => null);
        if (!triggerResp.ok || !trigger?.ok || !trigger?.data) {
          meetingAdvisorStatus.value = \`会议建议预判失败：\${trigger?.message || trigger?.error || \`http_\${triggerResp.status}\`}\`;
          return;
        }

        if (!trigger.data.shouldTrigger) {
          meetingAdvisorStatus.value = trigger.data.reason || "这一段暂时没有明显阻塞或错误信号。";
          return;
        }
`,
  `        const trigger = await triggerResp.json().catch(() => null);
        updateMeetingAdvisorDebug({ trigger });
        if (!triggerResp.ok || !trigger?.ok || !trigger?.data) {
          meetingAdvisorStatus.value = \`会议建议预判失败：\${trigger?.message || trigger?.error || \`http_\${triggerResp.status}\`}\`;
          updateMeetingAdvisorDebug({ error: meetingAdvisorStatus.value });
          return;
        }

        if (!trigger.data.shouldTrigger) {
          meetingAdvisorStatus.value = trigger.data.reason || "这一段暂时没有明显阻塞或错误信号。";
          updateMeetingAdvisorDebug({ skippedReason: meetingAdvisorStatus.value });
          return;
        }
`,
  "trigger debug"
);

replaceOnce(
  `        let adviceResult = await adviceResp.json().catch(() => null);
        if (!adviceResp.ok || !adviceResult?.ok || !adviceResult?.data) {
          meetingAdvisorStatus.value = \`会议建议生成失败：\${adviceResult?.message || adviceResult?.error || \`http_\${adviceResp.status}\`}\`;
          return;
        }
`,
  `        let adviceResult = await adviceResp.json().catch(() => null);
        updateMeetingAdvisorDebug({ advice: adviceResult });
        if (!adviceResp.ok || !adviceResult?.ok || !adviceResult?.data) {
          meetingAdvisorStatus.value = \`会议建议生成失败：\${adviceResult?.message || adviceResult?.error || \`http_\${adviceResp.status}\`}\`;
          updateMeetingAdvisorDebug({ error: meetingAdvisorStatus.value });
          return;
        }
`,
  "advice debug"
);

replaceOnce(
  `          const searchResult = await searchResp.json().catch(() => null);
          const webContext = Array.isArray(searchResult?.data?.items) ? searchResult.data.items : [];
`,
  `          const searchResult = await searchResp.json().catch(() => null);
          updateMeetingAdvisorDebug({ search: searchResult });
          const webContext = Array.isArray(searchResult?.data?.items) ? searchResult.data.items : [];
`,
  "search debug"
);

replaceOnce(
  `            const enriched = await enrichedResp.json().catch(() => null);
            if (enrichedResp.ok && enriched?.ok && enriched?.data) {
              adviceData = enriched.data;
            }
`,
  `            const enriched = await enrichedResp.json().catch(() => null);
            if (enrichedResp.ok && enriched?.ok && enriched?.data) {
              adviceData = enriched.data;
              updateMeetingAdvisorDebug({ advice: enriched });
            }
`,
  "enriched debug"
);

replaceOnce(
  `        if (!fingerprint || fingerprint === lastMeetingAdviceFingerprint.value || meetingAdviceItems.value.some((item) => buildMeetingAdviceFingerprint(item) === fingerprint)) {
          meetingAdvisorStatus.value = "这次识别到的建议和最近内容重复，已自动跳过。";
          return;
        }
`,
  `        if (!fingerprint || fingerprint === lastMeetingAdviceFingerprint.value || meetingAdviceItems.value.some((item) => buildMeetingAdviceFingerprint(item) === fingerprint)) {
          meetingAdvisorStatus.value = "这次识别到的建议和最近内容重复，已自动跳过。";
          updateMeetingAdvisorDebug({ skippedReason: meetingAdvisorStatus.value });
          return;
        }
`,
  "duplicate debug"
);

replaceOnce(
  `      } catch (e) {
        console.error("meeting advisor request error:", e);
        meetingAdvisorStatus.value = \`会议建议请求出错：\${e?.message || "network_error"}\`;
      } finally {
`,
  `      } catch (e) {
        console.error("meeting advisor request error:", e);
        meetingAdvisorStatus.value = \`会议建议请求出错：\${e?.message || "network_error"}\`;
        updateMeetingAdvisorDebug({ error: meetingAdvisorStatus.value });
      } finally {
`,
  "catch debug"
);

replaceOnce(
  `      meetingAdviceItems,
      meetingAdvisorLoading,
      meetingAdvisorStatus,
      meetingAdvisorEnabled,
      removeMeetingAdvice,
`,
  `      meetingAdviceItems,
      meetingAdvisorLoading,
      meetingAdvisorStatus,
      meetingAdvisorEnabled,
      meetingAdvisorDebug,
      formatDebugJson,
      removeMeetingAdvice,
`,
  "return debug"
);

replaceOnce(
  `        <div class="hint" style="margin-top:0;">{{ meetingAdvisorStatus }}</div>
        <div v-if="meetingAdviceItems.length === 0" class="hint">还没有触发会议建议。</div>
        <div v-for="item in meetingAdviceItems" :key="item.id" style="margin-top:12px;padding:12px;border:1px solid var(--border-color);border-radius:10px;background:#fff;">
`,
  `        <div class="hint" style="margin-top:0;">{{ meetingAdvisorStatus }}</div>
        <div v-if="meetingAdviceItems.length === 0" class="hint">还没有触发会议建议。</div>
        <div style="margin-top:12px;padding:12px;border:1px dashed var(--border-color);border-radius:10px;background:#f8fafc;">
          <div style="font-weight:700;">最近一次分析结果</div>
          <div class="subtle" style="margin-top:6px;">更新时间：{{ meetingAdvisorDebug.updatedAt || '暂无' }}</div>
          <div v-if="meetingAdvisorDebug.skippedReason" class="hint" style="margin-top:8px;">未出建议原因：{{ meetingAdvisorDebug.skippedReason }}</div>
          <div v-if="meetingAdvisorDebug.error" class="hint" style="margin-top:8px;color:#b91c1c;">错误：{{ meetingAdvisorDebug.error }}</div>
          <div class="subtle" style="margin-top:10px;">最近片段</div>
          <div class="pre" style="margin-top:6px;max-height:120px;">{{ meetingAdvisorDebug.recentLines.join('\\n') || '暂无' }}</div>
          <div class="subtle" style="margin-top:10px;">预判返回</div>
          <div class="pre" style="margin-top:6px;max-height:180px;">{{ formatDebugJson(meetingAdvisorDebug.trigger) }}</div>
          <div class="subtle" style="margin-top:10px;">建议返回</div>
          <div class="pre" style="margin-top:6px;max-height:220px;">{{ formatDebugJson(meetingAdvisorDebug.advice) }}</div>
          <div class="subtle" style="margin-top:10px;">搜索返回</div>
          <div class="pre" style="margin-top:6px;max-height:160px;">{{ formatDebugJson(meetingAdvisorDebug.search) }}</div>
        </div>
        <div v-for="item in meetingAdviceItems" :key="item.id" style="margin-top:12px;padding:12px;border:1px solid var(--border-color);border-radius:10px;background:#fff;">
`,
  "template debug"
);

fs.writeFileSync(filePath, text, "utf8");
console.log("updated", filePath);
