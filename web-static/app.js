const { createApp, ref, computed, onMounted, nextTick, watch } = Vue;

const vm = createApp({
  setup() {
    const markedLib = globalThis.marked;
    if (markedLib?.setOptions) markedLib.setOptions({ gfm: true, breaks: true });

    const file = ref(null);
    const loading = ref(false);
    const error = ref("");
    const data = ref(null);
    const caseImages = ref([]);
    const health = ref(null);
    const logs = ref([]);
    const logEl = ref(null);

    const speakerNameMap = ref({});
    const profileList = ref([]);
    const selectedProfileSlug = ref(null);
    const profileDetail = ref(null);
    const editingSpeaker = ref(null);
    const editingName = ref("");
    const showProfilePanel = ref(false);
    const editingProfileName = ref(false);
    const editingProfileNameValue = ref("");
    const showCaptureProfileModal = ref(false);
    const captureProfileMode = ref("select");
    const captureProfilePurpose = ref("capture");
    const captureProfileSlug = ref("");
    const captureProfileError = ref("");
    const newProfileName = ref("");
    const newProfileRole = ref("");
    const currentCaptureProfileSlug = ref(null);
    const meetingAdviceItems = ref([]);
    const meetingAdvisorLoading = ref(false);
    const meetingAdvisorStatus = ref("");
    const meetingAdvisorEnabled = ref(true);
    const meetingAdvisorForceWebSearch = ref(false);
    const meetingAdviceManualInstruction = ref("");
    const lastMeetingAdviceFingerprint = ref("");
    const meetingAdvisorDebug = ref({
      updatedAt: "",
      recentLines: [],
      contextLines: [],
      trigger: null,
      advice: null,
      search: null,
      manualInstruction: "",
      skippedReason: "",
      error: ""
    });

    function formatBytes(bytes) {
      if (bytes < 1024) return `${bytes} B`;
      const kb = bytes / 1024;
      if (kb < 1024) return `${kb.toFixed(1)} KB`;
      const mb = kb / 1024;
      return `${mb.toFixed(1)} MB`;
    }

    function pushLog(message) {
      logs.value.push(message);
      nextTick(() => {
        const el = logEl.value;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
      });
    }

    function renderMd(md) {
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

    function getMeetingAdvisorNetworkStatus() {
      const search = meetingAdvisorDebug.value?.search;
      if (!search) return "暂无";
      return search.connected ? "已联网" : "未联网";
    }

    function getMeetingAdvisorSearchMode() {
      const search = meetingAdvisorDebug.value?.search;
      if (!search) return "暂无";
      if (search.mode === "forced_qwen_web_search") return "强制 Qwen web_search";
      if (search.mode === "qwen_web_search") return "Qwen web_search";
      if (search.mode === "disabled") return "disabled";
      return search.mode || "暂无";
    }

    function getMeetingAdvisorSearchReason() {
      const search = meetingAdvisorDebug.value?.search;
      if (!search) return "暂无";
      return search.reason || search.sourceNote || "暂无";
    }

    function getMeetingAdvisorTriggerReason() {
      const trigger = meetingAdvisorDebug.value?.trigger?.data;
      if (!trigger) return "暂无";
      return trigger.reason || "暂无";
    }

    function getMeetingAdvisorFocusSpan() {
      const trigger = meetingAdvisorDebug.value?.trigger?.data;
      if (!trigger) return "暂无";
      return trigger.focusSpan || "暂无";
    }

    function getMeetingAdvisorAdviceSummary() {
      const advice = meetingAdvisorDebug.value?.advice?.data;
      if (!advice) return "暂无";
      return advice.summary || advice.title || "暂无";
    }

    function getMeetingAdvisorManualInstruction() {
      return meetingAdvisorDebug.value?.manualInstruction || "暂无";
    }

    function buildMeetingAdviceAnalysisRecord({ triggerData = null, adviceData = null, search = null, manualInstruction = "" } = {}) {
      return {
        triggerReason: triggerData?.reason || "暂无",
        focusSpan: triggerData?.focusSpan || "暂无",
        adviceSummary: adviceData?.summary || adviceData?.title || "暂无",
        manualInstruction: manualInstruction || "",
        networkStatus: search?.connected ? "已联网" : "未联网",
        networkReason: search?.reason || search?.sourceNote || "暂无",
        searchMode: search?.mode === "forced_qwen_web_search"
          ? "强制 Qwen web_search"
          : (search?.mode === "qwen_web_search" ? "Qwen web_search" : (search?.mode || "暂无")),
        searchQuery: search?.query || ""
      };
    }

    function onPickFile(e) {
      file.value = e.target.files?.[0] ?? null;
      error.value = "";
    }

    async function loadHealth() {
      try {
        const r = await fetch("/api/health");
        health.value = await r.json();
      } catch {
        health.value = null;
      }
    }

    function applyProfiles(profiles) {
      profileList.value = Array.isArray(profiles) ? profiles : [];
      for (const p of profileList.value) {
        if (p.speakerLabel && p.name) {
          speakerNameMap.value[p.speakerLabel] = p.name;
        }
      }
      if (selectedProfileSlug.value) {
        loadProfileDetail(selectedProfileSlug.value);
      }
    }

    async function loadProfileList() {
      try {
        const r = await fetch("/api/profiles");
        const res = await r.json();
        if (res.ok) {
          applyProfiles(res.data);
        }
      } catch {}
    }

    async function loadProfileDetail(slug) {
      try {
        const r = await fetch(`/api/profiles/${slug}`);
        const res = await r.json();
        if (res.ok) {
          profileDetail.value = res.data;
          selectedProfileSlug.value = slug;
          editingProfileName.value = false;
          editingProfileNameValue.value = res.data?.name || "";
        }
      } catch {}
    }

    async function deleteProfileAction(slug) {
      const profile = profileList.value.find((item) => item.slug === slug);
      const profileName = profile?.name || profile?.speakerLabel || slug;
      const firstConfirm = window.confirm(`确定要删除画像「${profileName}」吗？`);
      if (!firstConfirm) return;
      const secondConfirm = window.confirm(`删除后将无法恢复。\n请再次确认删除画像「${profileName}」。`);
      if (!secondConfirm) return;
      try {
        const r = await fetch(`/api/profiles/${slug}`, { method: "DELETE" });
        const res = await r.json();
        if (res.ok) {
          profileList.value = profileList.value.filter(p => p.slug !== slug);
          if (selectedProfileSlug.value === slug) {
            profileDetail.value = null;
            selectedProfileSlug.value = null;
          }
          if (currentCaptureProfileSlug.value === slug) {
            currentCaptureProfileSlug.value = null;
          }
          pushLog("已删除同事画像");
        }
      } catch {}
    }

    function getDisplayName(speakerLabel) {
      return speakerNameMap.value[speakerLabel] || speakerLabel;
    }

    function startEditProfileName() {
      if (!profileDetail.value) return;
      editingProfileName.value = true;
      editingProfileNameValue.value = profileDetail.value.name || "";
    }

    function cancelEditProfileName() {
      editingProfileName.value = false;
      editingProfileNameValue.value = profileDetail.value?.name || "";
    }

    async function saveProfileName() {
      if (!profileDetail.value?.slug || !editingProfileNameValue.value.trim()) return;
      try {
        const r = await fetch("/api/profiles/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug: profileDetail.value.slug,
            name: editingProfileNameValue.value.trim()
          })
        });
        const res = await r.json();
        if (!r.ok || !res.ok) {
          pushLog(`画像改名失败: ${res?.error || `http_${r.status}`}`);
          return;
        }
        pushLog(`已将画像改名为「${editingProfileNameValue.value.trim()}」`);
        await loadProfileList();
        await loadProfileDetail(profileDetail.value.slug);
      } catch (e) {
        pushLog(`画像改名请求出错: ${e?.message || "network_error"}`);
      } finally {
        editingProfileName.value = false;
      }
    }

    function getProfileNameBySlug(slug) {
      return profileList.value.find((item) => item.slug === slug)?.name || "";
    }

    function startEditSpeaker(speakerLabel) {
      editingSpeaker.value = speakerLabel;
      editingName.value = speakerNameMap.value[speakerLabel] || "";
    }

    async function saveSpeakerName() {
      if (!editingSpeaker.value || !editingName.value.trim()) return;
      const speakerLabel = editingSpeaker.value;
      const realName = editingName.value.trim();
      try {
        const r = await fetch("/api/profiles/name", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ speakerLabel, realName })
        });
        const res = await r.json();
        if (res.ok) {
          speakerNameMap.value[speakerLabel] = realName;
          pushLog(`已将「${speakerLabel}」命名为「${realName}」`);
          await loadProfileList();
        }
      } catch {}
      editingSpeaker.value = null;
      editingName.value = "";
    }

    function cancelEditSpeaker() {
      editingSpeaker.value = null;
      editingName.value = "";
    }

    function getDetectedSpeakers() {
      const speakers = new Set();
      for (const line of transcriptLines.value) {
        const match = line.match(/\[([^\]]+)\]\s*\[([^\]]+)\]/);
        if (match && (match[2].startsWith("发言人") || match[2] === "未知发言人")) {
          speakers.add(match[2]);
        }
      }
      return [...speakers].sort((a, b) => {
        const numA = parseInt(a.replace("发言人", ""), 10);
        const numB = parseInt(b.replace("发言人", ""), 10);
        return numA - numB;
      });
    }

    async function openCaptureProfileModal(mode = "select", purpose = "capture") {
      await loadProfileList();
      captureProfileMode.value = mode;
      captureProfilePurpose.value = purpose;
      captureProfileError.value = "";
      captureProfileSlug.value = selectedProfileSlug.value || profileList.value[0]?.slug || "";
      newProfileName.value = "";
      newProfileRole.value = "";
      showCaptureProfileModal.value = true;
    }

    function closeCaptureProfileModal() {
      showCaptureProfileModal.value = false;
      captureProfileError.value = "";
    }

    async function confirmCaptureProfile() {
      captureProfileError.value = "";
      let targetSlug = captureProfileSlug.value;

      if (captureProfileMode.value === "create") {
        if (!newProfileName.value.trim()) {
          captureProfileError.value = "请先输入画像名称";
          return;
        }
        try {
          const r = await fetch("/api/profiles/manual", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: newProfileName.value.trim(),
              role: newProfileRole.value.trim()
            })
          });
          const res = await r.json();
          if (!r.ok || !res.ok || !res.data?.slug) {
            captureProfileError.value = res?.error || `http_${r.status}`;
            return;
          }
          targetSlug = res.data.slug;
          pushLog(`已新建画像：${res.data.name}`);
          await loadProfileList();
        } catch (e) {
          captureProfileError.value = e?.message || "network_error";
          return;
        }
      }

      if (!targetSlug) {
        captureProfileError.value = "请选择本次要更新的画像";
        return;
      }

      currentCaptureProfileSlug.value = targetSlug;
      selectedProfileSlug.value = targetSlug;
      await loadProfileDetail(targetSlug);
      closeCaptureProfileModal();

      if (captureProfilePurpose.value !== "capture") {
        return;
      }

      transcriptLines.value = [];
      transcriptDraft.value = "";
      caseImages.value = [];
      caseLastProcessedFile.value = null;
      caseLastProcessedTranscriptLineCount.value = 0;
      data.value = null;
      const d = new Date();
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const HH = String(d.getHours()).padStart(2, '0');
      const MM = String(d.getMinutes()).padStart(2, '0');
      const SS = String(d.getSeconds()).padStart(2, '0');
      currentSessionId = `meeting-${yyyy}${mm}${dd}-${HH}${MM}${SS}`;
      pushLog(`本次录屏将更新画像：${getProfileNameBySlug(targetSlug) || targetSlug}`);
      await startCapture();
    }

    async function guessSpeakerNames() {
      const transcriptText = transcriptLines.value.join("\n");
      if (!transcriptText.trim()) return;
      pushLog("正在推测发言人身份...");
      try {
        const knownNames = Object.entries(speakerNameMap.value).map(([speakerLabel, realName]) => ({
          speakerLabel,
          realName
        }));
        const r = await fetch("/api/profiles/guess-speakers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcriptText, knownNames })
        });
        const res = await r.json();
        if (res.ok && res.data) {
          let guessCount = 0;
          for (const guess of res.data) {
            if (guess.guessedName && guess.confidence !== "low") {
              speakerNameMap.value[guess.speakerLabel] = guess.guessedName;
              guessCount++;
            }
          }
          pushLog(`推测完成：识别了 ${guessCount} 位发言人`);
          if (guessCount > 0) {
            for (const [label, name] of Object.entries(speakerNameMap.value)) {
              await fetch("/api/profiles/name", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ speakerLabel: label, realName: name })
              });
            }
            await loadProfileList();
          }
        }
      } catch {
        pushLog("推测发言人身份失败");
      }
    }

    async function onUpload() {
      if (!file.value || loading.value) return;
      loading.value = true;
      error.value = "";
      logs.value = [];
      data.value = {
        correctedTranscriptMd: "",
        participantsAndViewpointsMd: "",
        topicsReportMd: "",
        followUpQuestionsMd: "",
        glossaryMd: ""
      };

      try {
        const form = new FormData();
        form.append("file", file.value);
        pushLog("开始上传文件");
        const r = await fetch("/api/analyze-stream", { method: "POST", body: form });
        if (!r.ok) {
          error.value = `生成失败：http_${r.status}`;
          return;
        }
        if (!r.body) {
          error.value = "生成失败：浏览器不支持流式响应";
          return;
        }

        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let evt;
            try {
              evt = JSON.parse(trimmed);
            } catch {
              continue;
            }

            if (evt.type === "log") {
              pushLog(evt.message);
            } else if (evt.type === "delta") {
              const k = evt.section;
              if (data.value && typeof data.value[k] === "string") data.value[k] += evt.delta;
            } else if (evt.type === "section_done") {
              pushLog(`完成板块：${evt.section}`);
            } else if (evt.type === "error") {
              error.value = `生成失败：${evt.message ?? "unknown_error"}`;
              pushLog(error.value);
            } else if (evt.type === "done") {
              pushLog("全部生成完成");
              if (evt.data) data.value = evt.data;
            }
          }
        }
      } catch {
        error.value = "生成失败：网络或服务异常";
      } finally {
        loading.value = false;
      }
    }

    function onReset() {
      file.value = null;
      loading.value = false;
      error.value = "";
      data.value = null;
    }

    const isCapturing = ref(false);
    let captureInterval = null;
    let videoStream = null;
    let hiddenVideo = null;
    
    let audioContext = null;
    let micStream = null;
    let audioProcessor = null;
    let asrSocket = null;
    const transcriptLines = ref([]);
    const transcriptDraft = ref("");
    let isStoppingCapture = false;

    let currentSessionId = null;

    let analysisInterval = null;
    let isAnalyzing = false;
    let pendingCaseAnalysis = false;
    const caseLastProcessedFile = ref(null);
    const caseLastProcessedTranscriptLineCount = ref(0);

    function scheduleCaseAnalysis(delay = 5000) {
      if (analysisInterval) clearTimeout(analysisInterval);
      if (!isCapturing.value) return;
      analysisInterval = setTimeout(() => {
        triggerCaseAnalysis(false);
      }, delay);
    }

    function appendTranscriptLine(line) {
      if (!line) return;
      transcriptLines.value.push(line);
      transcriptDraft.value = "";
      pendingCaseAnalysis = true;
    }

    function updateTranscriptDraft(text) {
      transcriptDraft.value = text || "";
    }

    function getTranscriptDisplay() {
      const content = transcriptLines.value.slice().map(line => {
        return line.replace(/\[([^\]]+)\]\s*\[([^\]]+)\]/g, (match, ts, speaker) => {
          const displayName = speakerNameMap.value[speaker] || speaker;
          return `[${ts}] [${displayName}]`;
        });
      });
      if (transcriptDraft.value) {
        content.push(`[识别中] ${transcriptDraft.value}`);
      }
      return content.length ? content.join("\n") : "暂无";
    }

    function getCurrentCaptureProfile() {
      if (!currentCaptureProfileSlug.value) return null;
      return profileList.value.find((item) => item.slug === currentCaptureProfileSlug.value) || null;
    }

    function buildMeetingAdviceFingerprint(item) {
      return [item?.title || "", item?.summary || "", item?.suggestion || ""].join("|").trim();
    }

    function normalizeMeetingAdviceKeyPart(text) {
      return String(text || "")
        .trim()
        .replace(/[\s\p{P}\p{S}]+/gu, "")
        .slice(0, 48);
    }

    function buildMeetingAdviceIssueKey({ signalType = "", focusSpan = "", title = "", summary = "" } = {}) {
      const core = normalizeMeetingAdviceKeyPart(focusSpan) || normalizeMeetingAdviceKeyPart(summary) || normalizeMeetingAdviceKeyPart(title);
      return core ? [signalType || "none", core].join("|") : "";
    }

    function updateMeetingAdvisorDebug(patch = {}) {
      meetingAdvisorDebug.value = {
        ...meetingAdvisorDebug.value,
        ...patch,
        updatedAt: new Date().toLocaleTimeString()
      };
    }

    function removeMeetingAdvice(id) {
      meetingAdviceItems.value = meetingAdviceItems.value.filter((item) => item.id !== id);
    }

    function buildForcedMeetingTrigger(recentLines, triggerData = null, manualInstruction = "") {
      const trimmedRecent = Array.isArray(recentLines)
        ? recentLines.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      const manualFocus = typeof manualInstruction === "string" ? manualInstruction.trim().slice(0, 120) : "";
      const fallbackFocusSpan = trimmedRecent.slice(-2).join("；").slice(0, 120);
      return {
        shouldTrigger: true,
        signalType: triggerData?.signalType && triggerData.signalType !== "none" ? triggerData.signalType : "decision_pending",
        confidence: typeof triggerData?.confidence === "number" ? triggerData.confidence : 1,
        reason: triggerData?.shouldTrigger
          ? (triggerData.reason || "已手动触发会议建议。")
          : (manualFocus ? `已按手动要求强制触发会议建议：${manualFocus}` : "已手动强制触发会议建议，本轮即使预判未命中也继续生成建议。"),
        focusSpan: triggerData?.focusSpan || manualFocus || fallbackFocusSpan || "最近会议片段"
      };
    }

    async function requestMeetingAdviceManually(manualInstruction = "") {
      if (meetingAdvisorLoading.value) return;
      const forceWebSearch = meetingAdvisorForceWebSearch.value === true;
      const normalizedManualInstruction = typeof manualInstruction === "string"
        ? manualInstruction.trim()
        : meetingAdviceManualInstruction.value.trim();
      const recentLines = transcriptLines.value.slice(-8);
      const contextLines = transcriptLines.value.slice(-16);
      if (recentLines.length === 0) {
        meetingAdvisorStatus.value = "当前还没有可分析的会议转写，先开始录制或等待识别出内容。";
        updateMeetingAdvisorDebug({
          skippedReason: meetingAdvisorStatus.value,
          error: "",
          recentLines: [],
          contextLines: [],
          manualInstruction: normalizedManualInstruction
        });
        return;
      }
      meetingAdvisorStatus.value = forceWebSearch
        ? "已手动强制联网，正在获取会议建议..."
        : "已手动强制触发，正在获取会议建议...";
      await requestMeetingAdvice({
        recentLines,
        contextLines,
        isFinal: true,
        manualTrigger: true,
        forceTrigger: true,
        manualInstruction: normalizedManualInstruction,
        forceWebSearch
      });
    }

    async function requestMeetingAdvice({
      recentLines = [],
      contextLines = [],
      isFinal = false,
      manualTrigger = false,
      forceTrigger = false,
      manualInstruction = "",
      forceWebSearch = false
    } = {}) {
      if ((!meetingAdvisorEnabled.value && !manualTrigger) || meetingAdvisorLoading.value) return;
      const recent = Array.isArray(recentLines) ? recentLines.map((item) => String(item || "").trim()).filter(Boolean) : [];
      const context = Array.isArray(contextLines) ? contextLines.map((item) => String(item || "").trim()).filter(Boolean) : [];
      if (recent.length === 0 && !isFinal) return;

      meetingAdvisorLoading.value = true;
      meetingAdvisorStatus.value = forceWebSearch
        ? "正在强制联网获取会议建议..."
        : (manualTrigger ? "正在强制获取会议建议..." : "正在快速判断是否需要给会议建议...");
      updateMeetingAdvisorDebug({
        recentLines: recent.slice(-8),
        contextLines: context.slice(-16),
        trigger: null,
        advice: null,
        search: null,
        manualInstruction: typeof manualInstruction === "string" ? manualInstruction.trim() : "",
        skippedReason: "",
        error: ""
      });

      try {
        const summaryText = meetingAdviceItems.value
          .slice(0, 2)
          .map((item) => item.summary || item.title)
          .filter(Boolean)
          .join("；");

        const triggerResp = await fetch("/api/meeting-advisor/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recentLines: recent.slice(-8),
            contextLines: context.slice(-16),
            recentSummary: summaryText
          })
        });
        const trigger = await triggerResp.json().catch(() => null);
        let effectiveTrigger = trigger;
        if (!triggerResp.ok || !trigger?.ok || !trigger?.data) {
          meetingAdvisorStatus.value = `会议建议预判失败：${trigger?.message || trigger?.error || `http_${triggerResp.status}`}`;
          updateMeetingAdvisorDebug({ error: meetingAdvisorStatus.value });
          return;
        }

        if (!trigger.data.shouldTrigger && !forceTrigger) {
          updateMeetingAdvisorDebug({ trigger });
          meetingAdvisorStatus.value = trigger.data.reason || "这一段暂时没有明显阻塞或错误信号。";
          updateMeetingAdvisorDebug({ skippedReason: meetingAdvisorStatus.value });
          return;
        }

        const effectiveTriggerData = forceTrigger
          ? buildForcedMeetingTrigger(recent, trigger.data, manualInstruction)
          : trigger.data;
        effectiveTrigger = {
          ...trigger,
          data: effectiveTriggerData
        };
        updateMeetingAdvisorDebug({ trigger: effectiveTrigger });

        const profile = getCurrentCaptureProfile();
        const basePayload = {
          signalType: effectiveTriggerData.signalType || "",
          focusSpan: effectiveTriggerData.focusSpan || "",
          recentLines: recent.slice(-8),
          contextLines: context.slice(-16),
          recentSummary: summaryText,
          profileName: profile?.name || "",
          profileRole: profile?.role || "",
          pendingAdvice: meetingAdviceItems.value.slice(0, 5),
          manualInstruction: typeof manualInstruction === "string" ? manualInstruction.trim() : "",
          forceWebSearch
        };

        meetingAdvisorStatus.value = forceWebSearch
          ? "已进入强制联网模式，正在生成建议..."
          : (forceTrigger && !trigger.data.shouldTrigger
            ? "本轮未命中预判，但已按手动强制模式继续生成建议..."
            : "已命中会议信号，正在生成建议...");
        const adviceResp = await fetch("/api/meeting-advisor/advice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(basePayload)
        });
        const adviceResult = await adviceResp.json().catch(() => null);
        updateMeetingAdvisorDebug({ advice: adviceResult });
        if (!adviceResp.ok || !adviceResult?.ok || !adviceResult?.data) {
          meetingAdvisorStatus.value = `会议建议生成失败：${adviceResult?.message || adviceResult?.error || `http_${adviceResp.status}`}`;
          updateMeetingAdvisorDebug({ error: meetingAdvisorStatus.value });
          return;
        }

        const adviceData = adviceResult.data;
        const searchDebug = adviceData?.usedWebSearch
          ? {
              ok: true,
              connected: true,
              mode: forceWebSearch ? "forced_qwen_web_search" : "qwen_web_search",
              query: adviceData.searchQuery || "",
              sourceNote: adviceData.sourceNote || "",
              reason: forceWebSearch
                ? (adviceData.sourceNote || "本次由你手动开启强制联网，已通过 Qwen web_search 补充外部资料。")
                : (adviceData.sourceNote || "本次建议引用了外部实时资料，所以已联网搜索。")
            }
          : {
              ok: true,
              connected: false,
              mode: "disabled",
              query: "",
              sourceNote: adviceData.sourceNote || "基于当前会议内容生成。",
              reason: adviceData.sourceNote || "本次建议仅基于当前会议内容生成，未命中需要联网的信号。"
            };
        updateMeetingAdvisorDebug({ search: searchDebug });

        const summary = adviceData.summary || effectiveTriggerData.reason || "";
        const issueKey = buildMeetingAdviceIssueKey({
          signalType: effectiveTriggerData.signalType || "",
          focusSpan: effectiveTriggerData.focusSpan || "",
          title: adviceData.title || "会议建议",
          summary
        });
        const fingerprint = buildMeetingAdviceFingerprint({
          title: adviceData.title || "会议建议",
          summary,
          suggestion: adviceData.suggestion || ""
        });
        const nextItem = {
          id: `meeting-advice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          issueKey,
          signalType: effectiveTriggerData.signalType || "",
          focusSpan: effectiveTriggerData.focusSpan || "",
          title: adviceData.title || "会议建议",
          adviceType: adviceData.adviceType || "proposal",
          summary,
          suggestion: adviceData.suggestion || "",
          nextQuestion: adviceData.nextQuestion || "",
          sourceNote: adviceData.sourceNote || (adviceData.usedWebSearch ? "已通过 Qwen web_search 联网补充外部资料。" : "基于当前会议内容生成。"),
          analysisRecord: buildMeetingAdviceAnalysisRecord({
            triggerData: effectiveTriggerData,
            adviceData,
            search: searchDebug,
            manualInstruction: typeof manualInstruction === "string" ? manualInstruction.trim() : ""
          })
        };
        const existingIndex = issueKey
          ? meetingAdviceItems.value.findIndex((item) => item.issueKey === issueKey)
          : -1;
        const sameFingerprintIndex = meetingAdviceItems.value.findIndex((item) => buildMeetingAdviceFingerprint(item) === fingerprint);
        if (!fingerprint || fingerprint === lastMeetingAdviceFingerprint.value || sameFingerprintIndex >= 0) {
          meetingAdvisorStatus.value = "这次识别到的建议和最近内容重复，已自动跳过。";
          updateMeetingAdvisorDebug({ skippedReason: meetingAdvisorStatus.value });
          return;
        }

        lastMeetingAdviceFingerprint.value = fingerprint;
        if (existingIndex >= 0) {
          const existing = meetingAdviceItems.value[existingIndex];
          nextItem.id = existing.id;
          meetingAdviceItems.value = [
            nextItem,
            ...meetingAdviceItems.value.filter((item, idx) => idx !== existingIndex)
          ].slice(0, 8);
          meetingAdvisorStatus.value = "已更新同一困惑点的会议建议。";
        } else {
          meetingAdviceItems.value = [
            nextItem,
            ...meetingAdviceItems.value
          ].slice(0, 8);
          meetingAdvisorStatus.value = "已生成一条新的会议建议。";
        }
      } catch (e) {
        console.error("meeting advisor request error:", e);
        meetingAdvisorStatus.value = `会议建议请求出错：${e?.message || "network_error"}`;
        updateMeetingAdvisorDebug({ error: meetingAdvisorStatus.value });
      } finally {
        meetingAdvisorLoading.value = false;
      }
    }

    async function toggleCapture() {
      if (isCapturing.value) {
        await stopCapture();
      } else {
        await openCaptureProfileModal(profileList.value.length > 0 ? "select" : "create");
      }
    }

    async function initAudioRecording(systemStream) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        pushLog("未获取到麦克风权限，将仅录制系统声音");
      }

      audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      const dest = audioContext.createMediaStreamDestination();

      let audioSourceCount = 0;
      if (systemStream && systemStream.getAudioTracks().length > 0) {
        const sysSource = audioContext.createMediaStreamSource(new MediaStream(systemStream.getAudioTracks()));
        sysSource.connect(dest);
        audioSourceCount += 1;
      }

      if (micStream) {
        const micSource = audioContext.createMediaStreamSource(micStream);
        micSource.connect(dest);
        audioSourceCount += 1;
      }

      if (audioSourceCount === 0) {
        pushLog("未检测到可用音频源（系统音频/麦克风）");
        return;
      }

      const mixedStream = dest.stream;
      const source = audioContext.createMediaStreamSource(mixedStream);
      window.audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      
      const asrChunkMsFromUrl = Number(new URLSearchParams(window.location.search).get("asrChunkMs") || "200");
      const asrChunkMs = Number.isFinite(asrChunkMsFromUrl) ? Math.min(800, Math.max(100, asrChunkMsFromUrl)) : 200;
      const targetSamplesPerChunk = Math.max(1600, Math.round((16000 * asrChunkMs) / 1000));

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      asrSocket = new WebSocket(`${protocol}//${window.location.host}/ws/asr?sessionId=${currentSessionId}`);
      asrSocket.binaryType = "arraybuffer";

      let asrReady = false;
      let pcmCache = [];

      asrSocket.onopen = () => {
        pushLog("ASR WebSocket 已连接");
        pushLog(`当前音频分片时长: ${asrChunkMs}ms`);
      };

      function sendProbeAudio() {
        const sampleRate = 16000;
        const durationSec = Math.min(0.8, asrChunkMs / 1000);
        const freq = 440;
        const totalSamples = Math.floor(sampleRate * durationSec);
        const probe = new Int16Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) {
          const t = i / sampleRate;
          probe[i] = Math.round(Math.sin(2 * Math.PI * freq * t) * 0x1FFF);
        }
        asrSocket.send(probe.buffer);
      }

      asrSocket.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (e) {
          return;
        }
        
        if (msg.type === "ready") {
           asrReady = true;
           pushLog("后端大模型准备就绪，开始发送音频...");
           sendProbeAudio();
        } else if (msg.type === "partial") {
          updateTranscriptDraft(msg.text || "");
        } else if (msg.type === "sentence") {
          const now = new Date();
          const ts = String(now.getHours()).padStart(2, '0') + ":" + String(now.getMinutes()).padStart(2, '0') + ":" + String(now.getSeconds()).padStart(2, '0');
          appendTranscriptLine(`[${ts}] ${msg.text}`);
        } else if (msg.type === "error") {
          pushLog(`ASR错误: ${msg.message}`);
        }
      };

      window.audioProcessor.onaudioprocess = (e) => {
        if (!asrReady || !asrSocket || asrSocket.readyState !== WebSocket.OPEN) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < inputData.length; i++) {
          let s = Math.max(-1, Math.min(1, inputData[i]));
          const pcmVal = s < 0 ? s * 0x8000 : s * 0x7FFF;
          pcmCache.push(pcmVal);
        }

        if (pcmCache.length >= targetSamplesPerChunk) {
          const pcmData = new Int16Array(pcmCache);
          asrSocket.send(pcmData.buffer);
          pcmCache = [];
        }
      };

      source.connect(window.audioProcessor);
      
      const dummyGain = audioContext.createGain();
      dummyGain.gain.value = 0;
      window.audioProcessor.connect(dummyGain);
      dummyGain.connect(audioContext.destination);
    }

    async function startCapture() {
      try {
        videoStream = await navigator.mediaDevices.getDisplayMedia({ 
          video: true, 
          audio: true
        });
        
        await initAudioRecording(videoStream);

        hiddenVideo = document.createElement("video");
        hiddenVideo.srcObject = videoStream;
        hiddenVideo.play();
        
        videoStream.getVideoTracks()[0].onended = () => {
          stopCapture();
        };

        isCapturing.value = true;
        pushLog("开始截屏捕捉 (每10秒一次)...");

        captureInterval = setInterval(takeScreenshot, 10000);
        takeScreenshot();

        pushLog("开启实时分析 (基于上一轮完成自动触发)...");
        scheduleCaseAnalysis(15000);
      } catch (e) {
        console.error("Capture failed:", e);
        pushLog("截屏权限被拒绝或发生错误");
      }
    }

    async function stopCapture() {
      if (isStoppingCapture) return;
      isStoppingCapture = true;
      const sessionIdToFinalize = currentSessionId;
      isCapturing.value = false;
      if (captureInterval) clearInterval(captureInterval);
      if (analysisInterval) clearTimeout(analysisInterval);
      if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
      }
      if (hiddenVideo) {
        hiddenVideo.pause();
        hiddenVideo.srcObject = null;
        hiddenVideo = null;
      }
      if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
      }
      if (window.audioProcessor) {
        window.audioProcessor.disconnect();
        window.audioProcessor = null;
      }
      if (audioContext) {
        audioContext.close();
        audioContext = null;
      }
      if (asrSocket) {
        asrSocket.close();
        asrSocket = null;
      }
      pushLog("停止截屏与录音");
      await finalizeAsrTranscript(sessionIdToFinalize);
      isStoppingCapture = false;
    }

    async function finalizeAsrTranscript(sessionId) {
      if (!sessionId) return;
      pushLog("开始离线转写回填...");
      try {
        const r = await fetch("/api/asr/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId })
        });
        const rawText = await r.text();
        let res = null;
        try {
          res = rawText ? JSON.parse(rawText) : null;
        } catch (parseErr) {
          console.error("asr finalize parse error:", parseErr, rawText);
          pushLog(`离线回填响应解析失败: ${parseErr?.message || "invalid_json"}`);
          return;
        }
        if (!r.ok || !res?.ok) {
          pushLog(`离线回填失败: ${res?.message || res?.error || `http_${r.status}`}`);
          return;
        }
        const finalizedLines = Array.isArray(res?.data?.lines) ? res.data.lines : [];
        if (finalizedLines.length > 0) {
          transcriptLines.value = finalizedLines.map((line) => line.replace(/^\[([^\]]+)\]\s*\[[^\]]+\]\s*/, "[$1] "));
          transcriptDraft.value = "";
          caseLastProcessedTranscriptLineCount.value = transcriptLines.value.length;
          if (data.value) {
            data.value = {
              ...data.value,
              correctedTranscriptMd: transcriptLines.value.join("\n")
            };
          }
        }
        pushLog(`离线回填完成，模型：${res?.data?.model || "unknown"}`);
      } catch (e) {
        console.error("asr finalize request error:", e);
        pushLog(`离线回填请求出错: ${e?.message || "network_error"}`);
      }
    }

    async function triggerCaseAnalysis(isFinal = false) {
      if (!currentSessionId) return;
      if (isAnalyzing) {
        if (isFinal) {
          pushLog("等待当前分析完成以执行最终分析...");
          const checkInterval = setInterval(() => {
            if (!isAnalyzing) {
              clearInterval(checkInterval);
              triggerCaseAnalysis(true);
            }
          }, 1000);
        }
        return;
      }
      if (!isFinal && !pendingCaseAnalysis) {
        scheduleCaseAnalysis(5000);
        return;
      }
      isAnalyzing = true;
      pushLog(isFinal ? "开始最终案例分析..." : "触发实时增量案例分析...");
      try {
        const newLines = transcriptLines.value.slice(caseLastProcessedTranscriptLineCount.value);
        let newTranscriptText = newLines.join("\n");
        if (isFinal && transcriptDraft.value) {
            newTranscriptText += "\n[识别中] " + transcriptDraft.value;
        }

        const contextLineCount = Math.min(newLines.length, 100);
        const startIndex = Math.max(0, caseLastProcessedTranscriptLineCount.value - contextLineCount);
        const contextLines = transcriptLines.value.slice(startIndex, caseLastProcessedTranscriptLineCount.value);
        let contextTranscriptText = contextLines.join("\n");
        if ((newLines.length >= 3 || (isFinal && newTranscriptText.trim())) && !meetingAdvisorLoading.value) {
          Promise.resolve()
            .then(() => requestMeetingAdvice({
              recentLines: newLines.slice(-8),
              contextLines: transcriptLines.value.slice(-16),
              isFinal
            }))
            .catch((advisorErr) => {
              console.error("meeting advisor background error:", advisorErr);
            });
        }

        let prevAnalysisPayload = null;
        if (data.value) {
          prevAnalysisPayload = {
            participantsAndViewpointsMd: data.value.participantsAndViewpointsMd,
            topicsReportMd: data.value.topicsReportMd,
            followUpQuestionsMd: data.value.followUpQuestionsMd,
            glossaryMd: data.value.glossaryMd
          };
        }

        const r = await fetch("/api/analyze-case", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            sessionId: currentSessionId, 
            transcriptText: newTranscriptText,
            contextTranscriptText: contextTranscriptText,
            previousAnalysis: prevAnalysisPayload,
            lastProcessedFile: caseLastProcessedFile.value,
            isFinal,
            targetProfileSlug: currentCaptureProfileSlug.value
          })
        });
        const rawText = await r.text();
        let res = null;
        try {
          res = rawText ? JSON.parse(rawText) : null;
        } catch (parseErr) {
          console.error("analyze-case parse error:", parseErr, rawText);
          pushLog(`案例分析响应解析失败: ${parseErr?.message || "invalid_json"}`);
          if (!r.ok) {
            pushLog(`案例分析接口异常: http_${r.status}`);
          }
          return;
        }

        if (!res) {
          pushLog(`案例分析返回空响应${r.ok ? "" : `: http_${r.status}`}`);
          return;
        }

        if (!r.ok) {
          pushLog(`案例分析接口异常: ${res.message || res.error || `http_${r.status}`}`);
          return;
        }

        if (res.ok || res.error === 'no_valid_screenshots' || res.error === 'no_new_content') {
          pendingCaseAnalysis = false;
          caseLastProcessedTranscriptLineCount.value += newLines.length;
        }

        if (res.ok && res.data) {
          if (res.data.analysis) {
            if (data.value) {
              data.value = {
                ...data.value,
                correctedTranscriptMd: transcriptLines.value.join("\n"),
                participantsAndViewpointsMd: res.data.analysis.participantsAndViewpointsMd || data.value.participantsAndViewpointsMd,
                topicsReportMd: res.data.analysis.topicsReportMd || data.value.topicsReportMd,
                followUpQuestionsMd: res.data.analysis.followUpQuestionsMd || data.value.followUpQuestionsMd,
                glossaryMd: res.data.analysis.glossaryMd || data.value.glossaryMd
              };
            } else {
              data.value = res.data.analysis;
              data.value.correctedTranscriptMd = transcriptLines.value.join("\n");
            }
          }
          if (res.data.images && res.data.images.length > 0) {
            caseImages.value.push(...res.data.images);
          }
          if (res.data.lastProcessedFile) {
             caseLastProcessedFile.value = res.data.lastProcessedFile;
          }
          if (Array.isArray(res.data.profiles)) {
            applyProfiles(res.data.profiles);
          } else {
            loadProfileList();
          }
          if (res.data.profileSync) {
            if (res.data.profileSync.updated) {
              pushLog("同事画像已随本轮增量分析同步更新");
            } else if (res.data.profileSync.skippedReason) {
              pushLog(`同事画像本轮未更新：${res.data.profileSync.skippedReason}`);
            } else if (res.data.profileSync.attempted) {
              pushLog("同事画像本轮已尝试同步，但没有产生有效更新");
            }
          }
          pushLog(isFinal ? "最终案例分析完成" : "增量案例分析完成");
        } else if (res.error === 'no_valid_screenshots' || res.error === 'no_new_content') {
          pushLog("暂无新增截屏或内容");
        } else {
          pushLog(`案例分析失败: ${res.message || res.error || "unknown"}`);
        }
      } catch (e) {
        console.error("analyze-case request error:", e);
        pushLog(`案例分析请求出错: ${e?.message || "network_error"}`);
      } finally {
        isAnalyzing = false;
        if (isCapturing.value && !isFinal) {
          scheduleCaseAnalysis(5000);
        }
      }
    }

    async function takeScreenshot() {
      if (!hiddenVideo || !isCapturing.value) return;
      const canvas = document.createElement("canvas");
      canvas.width = hiddenVideo.videoWidth;
      canvas.height = hiddenVideo.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(hiddenVideo, 0, 0, canvas.width, canvas.height);
      
      const base64Image = canvas.toDataURL("image/png");
      
      try {
        const r = await fetch("/api/screenshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64Image, sessionId: currentSessionId })
        });
        const res = await r.json();
        if (res.ok) {
          pendingCaseAnalysis = true;
          pushLog(`截屏已保存: ${res.filename}`);
        } else {
          pushLog(`截屏保存失败`);
        }
      } catch (e) {
        pushLog("截屏上传出错");
      }
    }

    onMounted(() => {
      loadHealth();
      loadProfileList();
    });

    return {
      file,
      loading,
      error,
      data,
      health,
      logs,
      logEl,
      isCapturing,
      caseImages,
      transcriptLines,
      meetingAdviceItems,
      meetingAdvisorLoading,
      meetingAdvisorStatus,
      meetingAdvisorEnabled,
      meetingAdvisorForceWebSearch,
      meetingAdviceManualInstruction,
      meetingAdvisorDebug,
      showCaptureProfileModal,
      captureProfileMode,
      captureProfilePurpose,
      captureProfileSlug,
      captureProfileError,
      newProfileName,
      newProfileRole,
      currentCaptureProfileSlug,
      formatBytes,
      renderMd,
      onPickFile,
      onUpload,
      onReset,
      toggleCapture,
      formatDebugJson,
      getMeetingAdvisorNetworkStatus,
      getMeetingAdvisorSearchMode,
      getMeetingAdvisorSearchReason,
      getMeetingAdvisorTriggerReason,
      getMeetingAdvisorFocusSpan,
      getMeetingAdvisorAdviceSummary,
      getMeetingAdvisorManualInstruction,
      getTranscriptDisplay,
      removeMeetingAdvice,
      requestMeetingAdviceManually,
      speakerNameMap,
      profileList,
      selectedProfileSlug,
      profileDetail,
      editingProfileName,
      editingProfileNameValue,
      editingSpeaker,
      editingName,
      showProfilePanel,
      getDisplayName,
      startEditSpeaker,
      saveSpeakerName,
      cancelEditSpeaker,
      getDetectedSpeakers,
      guessSpeakerNames,
      loadProfileDetail,
      deleteProfileAction,
      startEditProfileName,
      cancelEditProfileName,
      saveProfileName,
      openCaptureProfileModal,
      closeCaptureProfileModal,
      confirmCaptureProfile,
      getProfileNameBySlug
    };
  },
  template: `
    <div class="container">
      <div class="header">
        <div>
          <div class="title">会议旁听 Agent</div>
          <div class="subtle">
            后端模型：{{ health?.model ?? "-" }} · thinking：{{ health?.enableThinking ?? "-" }}
          </div>
        </div>
        <div style="display:flex;gap:12px;align-items:center;">
          <div class="subtle">上传会议转写文档（txt/md）→ 生成分板块技术报告</div>
          <a href="/chat.html" class="btn secondary">同事画像对话</a>
          <a href="/chat-admin.html" class="btn secondary">编号后台</a>
        </div>
      </div>

      <div class="card">
        <div class="row">
          <input type="file" accept=".txt,.md,text/plain,text/markdown" @change="onPickFile" />
          <button class="btn" :disabled="!file || loading" @click="onUpload">
            {{ loading ? "生成中..." : "开始生成" }}
          </button>
          <button class="btn secondary" :disabled="loading && !data" @click="onReset">清空</button>
        </div>
        <div v-if="file" class="hint">已选择：{{ file.name }}（{{ formatBytes(file.size) }}）</div>
        <div v-if="error" class="error">{{ error }}</div>
      </div>

      <div v-if="data" class="panels">
        <div class="card">
          <div class="panel-title">2. 参与者与观点</div>
          <div class="md" v-html="renderMd(data.participantsAndViewpointsMd)"></div>
        </div>
        <div class="card">
          <div class="panel-title">3. 议题技术报告（按时间顺序）</div>
          <div class="md" v-html="renderMd(data.topicsReportMd)"></div>
        </div>
        <div class="card">
          <div class="panel-title">4. 追问清单（对谁问 / 问什么 / 期待回答）</div>
          <div class="md" v-html="renderMd(data.followUpQuestionsMd)"></div>
        </div>
      </div>

      <div class="monitor-layout">
        <div class="monitor-main">
          <div v-if="caseImages && caseImages.length > 0" class="card monitor" style="margin-top:20px;">
            <div class="panel-title">会议截屏记录（自动去重）</div>
            <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:10px;margin-top:10px;">
              <img v-for="(img, idx) in caseImages" :key="idx" :src="img" style="max-width:300px;border-radius:8px;border:1px solid #334155;flex-shrink:0;" />
            </div>
          </div>

          <div class="card monitor">
            <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;">
              <span>实时转写</span>
              <div class="subtle">当前更新画像：{{ currentCaptureProfileSlug ? getProfileNameBySlug(currentCaptureProfileSlug) : '未选择' }}</div>
            </div>
            <div class="pre">{{ getTranscriptDisplay() }}</div>
          </div>

          <div class="card monitor">
            <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" @click="showProfilePanel = !showProfilePanel">
              <span>同事画像 ({{ profileList.length }})</span>
              <span style="font-size:12px;color:#94a3b8;">{{ showProfilePanel ? '收起 ▲' : '展开 ▼' }}</span>
            </div>
            <div>
              <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
                <button class="btn secondary" @click.stop="openCaptureProfileModal('create', 'manage')">手动新增画像</button>
              </div>
              <div v-if="profileList.length === 0" class="hint" style="padding:12px 0;">暂无同事画像，请先手动新增，或在开始录屏时新建并选择。</div>
              <div v-else class="profile-grid" :class="{ collapsed: !showProfilePanel }">
                <div 
                  v-for="p in profileList" 
                  :key="p.slug" 
                  class="profile-card"
                  :class="{ active: selectedProfileSlug === p.slug, collapsed: !showProfilePanel }"
                  @click="loadProfileDetail(p.slug)"
                >
                  <div class="profile-name">{{ p.name || p.speakerLabel }}</div>
                  <div class="profile-role">{{ p.role || '角色未知' }}</div>
                  <div class="profile-tags" v-if="showProfilePanel && p.tags">
                    <span v-for="tag in (p.tags.personality || []).slice(0, 3)" :key="tag" class="tag">{{ tag }}</span>
                  </div>
                  <div class="profile-impression" v-if="showProfilePanel && p.impression">{{ p.impression }}</div>
                  <div class="profile-meta" v-if="showProfilePanel">参会 {{ p.meeting_count || 0 }} 次</div>
                  <button class="btn-delete-sm" @click.stop="deleteProfileAction(p.slug)" title="删除画像">×</button>
                </div>
              </div>
              <div v-if="showProfilePanel && profileDetail" class="profile-detail">
                <div class="profile-detail-header">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
                    <h3 style="margin:0;">{{ profileDetail.name || profileDetail.speakerLabel }} — 画像详情</h3>
                    <div style="display:flex;gap:8px;align-items:center;">
                      <template v-if="editingProfileName">
                        <input
                          v-model="editingProfileNameValue"
                          @keyup.enter="saveProfileName"
                          @keyup.escape="cancelEditProfileName"
                          placeholder="输入画像名称"
                          style="padding:8px 10px;border:1px solid var(--border-color);border-radius:6px;min-width:220px;"
                        />
                        <button class="btn secondary" @click="cancelEditProfileName">取消</button>
                        <button class="btn" @click="saveProfileName">保存名称</button>
                      </template>
                      <button v-else class="btn secondary" @click="startEditProfileName">修改名称</button>
                    </div>
                  </div>
                </div>
                <div class="profile-section">
                  <h4>Persona（性格与行为）</h4>
                  <div class="md" v-html="renderMd(profileDetail.personaMd)"></div>
                </div>
                <div class="profile-section">
                  <h4>Work（工作能力与方法）</h4>
                  <div class="md" v-html="renderMd(profileDetail.workMd)"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="card monitor">
            <div class="panel-title">运行日志</div>
            <div class="pre" ref="logEl">{{ logs.length ? logs.join("\\n") : (loading ? "准备中..." : "暂无") }}</div>
          </div>
        </div>

        <div class="monitor-side">
          <div class="card monitor">
            <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
              <span>会议建议</span>
              <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
                <label class="subtle" style="display:flex;gap:6px;align-items:center;cursor:pointer;">
                  <input type="checkbox" v-model="meetingAdvisorEnabled" />
                  <span>启用主动建议</span>
                </label>
                <label class="subtle" style="display:flex;gap:6px;align-items:center;cursor:pointer;">
                  <input type="checkbox" v-model="meetingAdvisorForceWebSearch" />
                  <span>强制联网</span>
                </label>
                <button class="btn secondary" @click="requestMeetingAdviceManually()" :disabled="meetingAdvisorLoading">
                  {{ meetingAdvisorLoading ? '获取中...' : '强制获取建议' }}
                </button>
                <div class="subtle">{{ meetingAdvisorLoading ? '判断中...' : (meetingAdviceItems.length + ' 条') }}</div>
              </div>
            </div>
            <div v-if="meetingAdvisorStatus" class="hint" style="margin-top:0;">{{ meetingAdvisorStatus }}</div>
            <textarea
              v-model="meetingAdviceManualInstruction"
              placeholder="在此输入获取建议要求"
              style="width:100%;min-height:110px;margin-top:12px;padding:12px;border:1px solid var(--border-color);border-radius:8px;resize:vertical;font:inherit;line-height:1.6;"
            ></textarea>
            <div v-if="meetingAdviceItems.length === 0" class="hint">还没有触发会议建议。</div>
            <div style="margin-top:12px;padding:12px;border:1px dashed var(--border-color);border-radius:10px;background:#f8fafc;">
              <div style="font-weight:700;">最近一次分析结果</div>
              <div class="subtle" style="margin-top:6px;">更新时间：{{ meetingAdvisorDebug.updatedAt || '暂无' }}</div>
              <div v-if="meetingAdvisorDebug.skippedReason" class="hint" style="margin-top:8px;">未出建议原因：{{ meetingAdvisorDebug.skippedReason }}</div>
              <div v-if="meetingAdvisorDebug.error" class="hint" style="margin-top:8px;color:#b91c1c;">错误：{{ meetingAdvisorDebug.error }}</div>
              <div class="subtle" style="margin-top:10px;">触发原因：{{ getMeetingAdvisorTriggerReason() }}</div>
              <div class="subtle" style="margin-top:6px;">困惑点：{{ getMeetingAdvisorFocusSpan() }}</div>
              <div class="subtle" style="margin-top:6px;">手动要求：{{ getMeetingAdvisorManualInstruction() }}</div>
              <div class="subtle" style="margin-top:6px;">建议摘要：{{ getMeetingAdvisorAdviceSummary() }}</div>
              <div class="subtle" style="margin-top:10px;">是否联网：{{ getMeetingAdvisorNetworkStatus() }}</div>
              <div class="subtle" style="margin-top:6px;">为什么联网：{{ getMeetingAdvisorSearchReason() }}</div>
              <div class="subtle" style="margin-top:6px;">本次搜索模式：{{ getMeetingAdvisorSearchMode() }}</div>
              <div v-if="meetingAdvisorDebug.search && meetingAdvisorDebug.search.query" class="subtle" style="margin-top:6px;">搜索词：{{ meetingAdvisorDebug.search.query }}</div>
              <div class="subtle" style="margin-top:10px;">最近片段</div>
              <div class="pre" style="margin-top:6px;max-height:120px;">{{ meetingAdvisorDebug.recentLines.join('\\n') || '暂无' }}</div>
            </div>
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
              <div v-if="item.analysisRecord" style="margin-top:10px;padding:10px;border:1px dashed var(--border-color);border-radius:8px;background:#f8fafc;">
                <div style="font-weight:700;">本条分析记录</div>
                <div class="subtle" style="margin-top:6px;">触发原因：{{ item.analysisRecord.triggerReason }}</div>
                <div class="subtle" style="margin-top:6px;">困惑点：{{ item.analysisRecord.focusSpan }}</div>
                <div class="subtle" style="margin-top:6px;">手动要求：{{ item.analysisRecord.manualInstruction || '暂无' }}</div>
                <div class="subtle" style="margin-top:6px;">建议摘要：{{ item.analysisRecord.adviceSummary }}</div>
                <div class="subtle" style="margin-top:6px;">是否联网：{{ item.analysisRecord.networkStatus }}</div>
                <div class="subtle" style="margin-top:6px;">为什么联网：{{ item.analysisRecord.networkReason }}</div>
                <div class="subtle" style="margin-top:6px;">本次搜索模式：{{ item.analysisRecord.searchMode }}</div>
                <div v-if="item.analysisRecord.searchQuery" class="subtle" style="margin-top:6px;">搜索词：{{ item.analysisRecord.searchQuery }}</div>
              </div>
              <div class="subtle" style="margin-top:8px;">{{ item.sourceNote }}</div>
            </div>
          </div>
        </div>
      </div>

      <div 
        class="floating-ball" 
        :class="{ capturing: isCapturing }"
        @click="toggleCapture"
        title="点击开始/停止截屏"
      >
        <span v-if="!isCapturing">录屏</span>
        <span v-else>停止</span>
      </div>

      <div v-if="showCaptureProfileModal" style="position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:10000;padding:16px;">
        <div class="card" style="width:min(520px,100%);margin:0;">
          <div class="panel-title">{{ captureProfileMode === 'create' ? '新建画像' : '选择本次要更新的画像' }}</div>
          <div class="hint" style="margin-top:0;">
            {{ captureProfilePurpose === 'manage'
              ? '手动创建一个画像，后续录屏可以直接复用。'
              : captureProfileMode === 'create'
              ? '手动创建一个画像，后续录屏可以直接复用。'
              : '本次录屏的增量分析和画像更新只会写入你手动选择的这一个画像。' }}
          </div>

          <div v-if="captureProfileMode === 'select'" style="margin-top:16px;">
            <div v-if="profileList.length === 0" class="hint">当前没有可选画像，请先新建。</div>
            <select v-else v-model="captureProfileSlug" style="width:100%;padding:10px 12px;border:1px solid var(--border-color);border-radius:6px;background:#fff;">
              <option value="" disabled>请选择画像</option>
              <option v-for="p in profileList" :key="p.slug" :value="p.slug">
                {{ p.name }}{{ p.role ? ' · ' + p.role : '' }}
              </option>
            </select>
            <div style="display:flex;justify-content:flex-end;margin-top:10px;">
              <button class="btn secondary" @click="captureProfileMode = 'create'">新建画像</button>
            </div>
          </div>

          <div v-else style="display:flex;flex-direction:column;gap:10px;margin-top:16px;">
            <input v-model="newProfileName" placeholder="画像名称，例如：张三 / 李工" style="width:100%;padding:10px 12px;border:1px solid var(--border-color);border-radius:6px;" />
            <input v-model="newProfileRole" placeholder="角色，可选，例如：架构师 / 产品经理" style="width:100%;padding:10px 12px;border:1px solid var(--border-color);border-radius:6px;" />
            <div style="display:flex;justify-content:flex-end;">
              <button v-if="profileList.length > 0" class="btn secondary" @click="captureProfileMode = 'select'">返回选择已有画像</button>
            </div>
          </div>

          <div v-if="captureProfileError" class="error">{{ captureProfileError }}</div>

          <div class="row" style="justify-content:flex-end;margin-top:16px;">
            <button class="btn secondary" @click="closeCaptureProfileModal">取消</button>
            <button v-if="captureProfileMode === 'select'" class="btn" @click="confirmCaptureProfile">{{ captureProfilePurpose === 'manage' ? '确认选中' : '确认并开始录屏' }}</button>
            <button v-else class="btn" @click="confirmCaptureProfile">
              {{ captureProfilePurpose === 'manage' ? '创建画像' : (profileList.length > 0 ? '创建并选中' : '创建并开始录屏') }}
            </button>
          </div>
        </div>
      </div>

    </div>
  `
});

(function() {
  const appEl = document.getElementById("app");
  if (!appEl) return;
  const snapshotHtml = appEl.innerHTML;
  const hasRealContent = snapshotHtml.length > 500;
  const isLikelyOffline = !window.navigator.onLine || (hasRealContent && snapshotHtml.includes("panel-title"));

  if (isLikelyOffline && hasRealContent) {
    const offlineBanner = document.createElement("div");
    offlineBanner.style.cssText = "background:#fbbf24;color:#1e293b;padding:8px 16px;text-align:center;font-size:14px;font-weight:600;";
    offlineBanner.textContent = "📋 离线快照模式 — 内容为保存时的状态，无法实时更新";
    appEl.insertBefore(offlineBanner, appEl.firstChild);
  } else {
    appEl.innerHTML = "";
    vm.mount(appEl);
  }
})();
