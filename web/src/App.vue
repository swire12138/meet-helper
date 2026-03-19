<template>
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
      <div v-if="file" class="hint">
        已选择：{{ file.name }}（{{ formatBytes(file.size) }}）
      </div>
      <div v-if="error" class="error">{{ error }}</div>
    </div>

    <div v-if="data" class="panels">
      <div class="card">
        <div class="panel-title">1. 修正后的会议转写</div>
        <div class="pre">{{ data.correctedTranscriptMd }}</div>
      </div>

      <div class="card">
        <div class="panel-title">2. 参与者与观点</div>
        <div class="pre">{{ data.participantsAndViewpointsMd }}</div>
      </div>

      <div class="card">
        <div class="panel-title">3. 议题技术报告（按时间顺序）</div>
        <div class="pre">{{ data.topicsReportMd }}</div>
      </div>

      <div class="card">
        <div class="panel-title">4. 追问清单（对谁问 / 问什么 / 期待回答）</div>
        <div class="pre">{{ data.followUpQuestionsMd }}</div>
      </div>

      <div class="card">
        <div class="panel-title">5. 术语表（名词解释）</div>
        <div class="pre">{{ data.glossaryMd }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from "vue";

const file = ref(null);
const loading = ref(false);
const error = ref("");
const data = ref(null);
const health = ref(null);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function onPickFile(e) {
  const f = e.target.files?.[0] ?? null;
  file.value = f;
  error.value = "";
}

async function loadHealth() {
  try {
    const r = await fetch("/api/health");
    const j = await r.json();
    health.value = j;
  } catch {
    health.value = null;
  }
}

async function onUpload() {
  if (!file.value || loading.value) return;
  loading.value = true;
  error.value = "";
  data.value = null;

  try {
    const form = new FormData();
    form.append("file", file.value);

    const r = await fetch("/api/analyze", { method: "POST", body: form });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      error.value = `生成失败：${j?.error ?? "unknown_error"}`;
      return;
    }
    data.value = j.data;
  } catch (e) {
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
</script>
