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

    const isCapturing = ref(false);
    let captureInterval = null;
    let videoStream = null;
    let hiddenVideo = null;
    
    // Audio related
    let audioContext = null;
    let micStream = null;
    let audioProcessor = null;
    let asrSocket = null;
    const transcriptLines = ref([]);
    const transcriptDraft = ref("");
    let fullPcmSamples = [];
    let isStoppingCapture = false;

    let currentSessionId = null;

    function appendTranscriptLine(line) {
      if (!line) return;
      transcriptLines.value.push(line);
      transcriptDraft.value = "";
    }

    function updateTranscriptDraft(text) {
      transcriptDraft.value = text || "";
    }

    function getTranscriptDisplay() {
      const content = transcriptLines.value.slice();
      if (transcriptDraft.value) {
        content.push(`[识别中] ${transcriptDraft.value}`);
      }
      return content.length ? content.join("\n") : "暂无";
    }

    function pcmSamplesToWavBase64(samples, sampleRate = 16000) {
      const pcm = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        pcm[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
      }
      const dataSize = pcm.byteLength;
      const header = new ArrayBuffer(44);
      const view = new DataView(header);
      const writeStr = (offset, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
      };
      writeStr(0, "RIFF");
      view.setUint32(4, 36 + dataSize, true);
      writeStr(8, "WAVE");
      writeStr(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, "data");
      view.setUint32(40, dataSize, true);

      const wav = new Uint8Array(44 + dataSize);
      wav.set(new Uint8Array(header), 0);
      wav.set(new Uint8Array(pcm.buffer), 44);
      let binary = "";
      for (let i = 0; i < wav.length; i++) binary += String.fromCharCode(wav[i]);
      return btoa(binary);
    }

    async function finalizeSpeakerDiarization() {
      if (!currentSessionId || fullPcmSamples.length === 0) return;
      try {
        pushLog("开始离线说话人分离回填...");
        const audioWavBase64 = pcmSamplesToWavBase64(fullPcmSamples, 16000);
        const r = await fetch("/api/asr/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: currentSessionId, audioWavBase64 })
        });
        const result = await r.json();
        if (!result?.ok) {
          pushLog(`离线分离失败: ${result?.error || "unknown_error"}`);
          return;
        }
        if (Array.isArray(result.lines)) {
          transcriptLines.value = result.lines.slice();
          transcriptDraft.value = "";
        }
        pushLog(`离线分离完成，识别到${result?.speakerCount ?? 0}位发言人`);
      } catch {
        pushLog("离线分离请求失败");
      }
    }

    async function toggleCapture() {
      if (isCapturing.value) {
        await stopCapture();
      } else {
        transcriptLines.value = [];
        transcriptDraft.value = "";
        fullPcmSamples = [];
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const HH = String(d.getHours()).padStart(2, '0');
        const MM = String(d.getMinutes()).padStart(2, '0');
        const SS = String(d.getSeconds()).padStart(2, '0');
        currentSessionId = `meeting-${yyyy}${mm}${dd}-${HH}${MM}${SS}`;
        await startCapture();
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

      // We need PCM 16-bit 16kHz mono
      const mixedStream = dest.stream;
      const source = audioContext.createMediaStreamSource(mixedStream);
      // 使用更现代、推荐的方式或者确保 scriptProcessor 继续工作
      // 为了适配 DashScope 可能需要更大的 buffer size，调整大小并缓存
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
        pushLog("已发送探测音频包");
      }

      asrSocket.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch(e) {
          return;
        }
        
        // 增加处理 asrReady 状态
        if (msg.type === "ready") {
           asrReady = true;
           pushLog("后端大模型准备就绪，开始发送音频...");
           sendProbeAudio();
        } else if (msg.type === "partial") {
          updateTranscriptDraft(msg.text || "");
        } else if (msg.type === "sentence") {
          const speaker = msg.speakerId || "发言人1";
          appendTranscriptLine(`[${speaker}] ${msg.text}`);
        } else if (msg.type === "error") {
          pushLog(`ASR错误: ${msg.message}`);
        }
      };

      window.audioProcessor.onaudioprocess = (e) => {
        if (!asrReady || !asrSocket || asrSocket.readyState !== WebSocket.OPEN) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < inputData.length; i++) {
          let s = Math.max(-1, Math.min(1, inputData[i]));
          pcmCache.push(s < 0 ? s * 0x8000 : s * 0x7FFF);
          fullPcmSamples.push(s);
        }

        // 当积攒到约 3200 采样（约 200 毫秒的音频，16000Hz * 0.2s = 3200）时再发送
        // 适当减小包体积，避免过长导致实时性变差，但比之前的极小包稳定
        if (pcmCache.length >= targetSamplesPerChunk) {
          const pcmData = new Int16Array(pcmCache);
          asrSocket.send(pcmData.buffer);
          pcmCache = []; // 清空缓存
        }
      };

      source.connect(window.audioProcessor);
      // 创建一个无声节点来保持 scriptProcessor 工作
      const dummyNode = audioContext.createGain();
      dummyNode.gain.value = 0;
      window.audioProcessor.connect(dummyNode);
      dummyNode.connect(audioContext.destination);
    }

    async function startCapture() {
      try {
        videoStream = await navigator.mediaDevices.getDisplayMedia({ 
          video: true, 
          audio: true // Request system audio
        });
        
        await initAudioRecording(videoStream);

        hiddenVideo = document.createElement("video");
        hiddenVideo.srcObject = videoStream;
        hiddenVideo.play();
        
        videoStream.getVideoTracks()[0].onended = () => {
          stopCapture();
        };

        isCapturing.value = true;
        pushLog("开始截屏捕捉 (每5秒一次)...");

        captureInterval = setInterval(takeScreenshot, 5000);
        takeScreenshot();
      } catch (e) {
        console.error("Capture failed:", e);
        pushLog("截屏权限被拒绝或发生错误");
      }
    }

    async function stopCapture() {
      if (isStoppingCapture) return;
      isStoppingCapture = true;
      isCapturing.value = false;
      if (captureInterval) clearInterval(captureInterval);
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
      await finalizeSpeakerDiarization();
      isStoppingCapture = false;
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
          pushLog(`截屏已保存: ${res.filename}`);
        } else {
          pushLog(`截屏保存失败`);
        }
      } catch (e) {
        pushLog("截屏上传出错");
      }
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
      isCapturing,
      formatBytes,
      renderMd,
      onPickFile,
      onUpload,
      onReset,
      toggleCapture
      ,
      getTranscriptDisplay
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
        <div class="panel-title">实时转写</div>
        <div class="pre">{{ getTranscriptDisplay() }}</div>
      </div>

      <div class="card monitor">
        <div class="panel-title">运行日志</div>
        <div class="pre" ref="logEl">{{ logs.length ? logs.join("\\n") : (loading ? "准备中..." : "暂无") }}</div>
      </div>

      <!-- Floating Ball for screen capture -->
      <div 
        class="floating-ball" 
        :class="{ capturing: isCapturing }"
        @click="toggleCapture"
        title="点击开始/停止截屏"
      >
        <span v-if="!isCapturing">录屏</span>
        <span v-else>停止</span>
      </div>
    </div>
  `
}).mount("#app");
