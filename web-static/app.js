const { createApp, ref, onMounted, nextTick } = Vue;

createApp({
  setup() {
    const markedLib = globalThis.marked;
    if (markedLib?.setOptions) markedLib.setOptions({ gfm: true, breaks: true });

    const file = ref(null);
    const loading = ref(false);
    const error = ref("");
    const data = ref(null);
    const health = ref(null);
    const logs = ref([]);
    const logEl = ref(null);

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
      if (typeof markedLib?.parse === "function") html = markedLib.parse(source);
      else if (typeof markedLib === "function") html = markedLib(source);
      else html = source;
      return globalThis.DOMPurify?.sanitize ? globalThis.DOMPurify.sanitize(html) : html;
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

    onMounted(loadHealth);

    return {
      file,
      loading,
      error,
      data,
      health,
      logs,
      logEl,
      formatBytes,
      renderMd,
      onPickFile,
      onUpload,
      onReset
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
        <div class="subtle">上传会议转写文档（txt/md）→ 生成分板块技术报告</div>
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
          <div class="panel-title">1. 修正后的会议转写</div>
          <div class="md" v-html="renderMd(data.correctedTranscriptMd)"></div>
        </div>
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

      <div class="card monitor">
        <div class="panel-title">运行日志</div>
        <div class="pre" ref="logEl">{{ logs.length ? logs.join("\\n") : (loading ? "准备中..." : "暂无") }}</div>
      </div>
    </div>
  `
}).mount("#app");
