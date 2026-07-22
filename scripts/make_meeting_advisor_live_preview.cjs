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
  `    const meetingAdviceItems = ref([]);
    const meetingAdvisorLoading = ref(false);
    const meetingAdvisorStatus = ref("录制中遇到阻塞、错误或明显风险时，这里会主动出现建议。");
`,
  `    const meetingAdviceItems = ref([]);
    const meetingAdvisorLoading = ref(false);
    const meetingAdvisorStatus = ref("等待录制中的新增转写，收到内容后会自动进行预判。");
`,
  "initial advisor status"
);

replaceOnce(
  `    let analysisInterval = null;
    let isAnalyzing = false;
`,
  `    let analysisInterval = null;
    let meetingAdvisorPreviewTimer = null;
    let isAnalyzing = false;
`,
  "preview timer var"
);

replaceOnce(
  `    function appendTranscriptLine(line) {
      if (!line) return;
      transcriptLines.value.push(line);
      transcriptDraft.value = "";
    }
`,
  `    function appendTranscriptLine(line) {
      if (!line) return;
      transcriptLines.value.push(line);
      transcriptDraft.value = "";
      scheduleMeetingAdvicePreview();
    }
`,
  "append line schedule"
);

replaceOnce(
  `    function removeMeetingAdvice(id) {
      meetingAdviceItems.value = meetingAdviceItems.value.filter((item) => item.id !== id);
    }

    async function requestMeetingAdvice({ recentLines = [], contextLines = [], isFinal = false } = {}) {
`,
  `    function removeMeetingAdvice(id) {
      meetingAdviceItems.value = meetingAdviceItems.value.filter((item) => item.id !== id);
    }

    function scheduleMeetingAdvicePreview() {
      if (!meetingAdvisorEnabled.value) return;
      if (meetingAdvisorPreviewTimer) {
        clearTimeout(meetingAdvisorPreviewTimer);
      }
      const total = transcriptLines.value.length;
      if (total === 0) {
        meetingAdvisorStatus.value = "等待录制中的新增转写，收到内容后会自动进行预判。";
        updateMeetingAdvisorDebug({ skippedReason: "暂无新增转写内容。" });
        return;
      }
      meetingAdvisorStatus.value = "收到新增转写，等待自动预判...";
      meetingAdvisorPreviewTimer = setTimeout(() => {
        const recentLines = transcriptLines.value.slice(-4);
        const contextLines = transcriptLines.value.slice(Math.max(0, total - 12), Math.max(0, total - 4));
        Promise.resolve()
          .then(() => requestMeetingAdvice({
            recentLines,
            contextLines,
            isFinal: false
          }))
          .catch((err) => {
            console.error("meeting advisor preview error:", err);
          });
      }, 1800);
    }

    async function requestMeetingAdvice({ recentLines = [], contextLines = [], isFinal = false } = {}) {
`,
  "schedule preview function"
);

replaceOnce(
  `      if (captureInterval) clearInterval(captureInterval);
      if (analysisInterval) clearTimeout(analysisInterval);
`,
  `      if (captureInterval) clearInterval(captureInterval);
      if (analysisInterval) clearTimeout(analysisInterval);
      if (meetingAdvisorPreviewTimer) clearTimeout(meetingAdvisorPreviewTimer);
`,
  "clear preview timer on stop"
);

replaceOnce(
  `      transcriptLines.value = [];
      transcriptDraft.value = "";
      caseImages.value = [];
`,
  `      transcriptLines.value = [];
      transcriptDraft.value = "";
      meetingAdvisorStatus.value = "等待录制中的新增转写，收到内容后会自动进行预判。";
      meetingAdvisorDebug.value = {
        updatedAt: "",
        recentLines: [],
        contextLines: [],
        trigger: null,
        advice: null,
        search: null,
        skippedReason: "录制已开始，等待新增转写。",
        error: ""
      };
      caseImages.value = [];
`,
  "reset advisor debug on session start"
);

fs.writeFileSync(filePath, text, "utf8");
console.log("updated", filePath);
