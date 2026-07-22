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
  `    let analysisInterval = null;
    let meetingAdvisorPreviewTimer = null;
    let isAnalyzing = false;
`,
  `    let analysisInterval = null;
    let meetingAdvisorPreviewTimer = null;
    let lastMeetingAdvisorPreviewLineCount = 0;
    let isAnalyzing = false;
`,
  "preview line count"
);

replaceOnce(
  `    function scheduleMeetingAdvicePreview() {
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
`,
  `    function scheduleMeetingAdvicePreview() {
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
      const newLineCount = total - lastMeetingAdvisorPreviewLineCount;
      if (newLineCount < 3) {
        meetingAdvisorStatus.value = \`已收到 \${newLineCount} 句新增转写，继续积累后再预判。\`;
        updateMeetingAdvisorDebug({ skippedReason: "新增转写还太少，先继续积累上下文。" });
        return;
      }
      meetingAdvisorStatus.value = "已积累一段新增转写，等待自动预判...";
      meetingAdvisorPreviewTimer = setTimeout(() => {
        const latestTotal = transcriptLines.value.length;
        const recentLines = transcriptLines.value.slice(-8);
        const contextLines = transcriptLines.value.slice(Math.max(0, latestTotal - 24), Math.max(0, latestTotal - 8));
        lastMeetingAdvisorPreviewLineCount = latestTotal;
        Promise.resolve()
          .then(() => requestMeetingAdvice({
            recentLines,
            contextLines,
            isFinal: false
          }))
          .catch((err) => {
            console.error("meeting advisor preview error:", err);
          });
      }, 5000);
    }
`,
  "schedule window"
);

replaceOnce(
  `      transcriptLines.value = [];
      transcriptDraft.value = "";
      meetingAdvisorStatus.value = "等待录制中的新增转写，收到内容后会自动进行预判。";
`,
  `      transcriptLines.value = [];
      transcriptDraft.value = "";
      lastMeetingAdvisorPreviewLineCount = 0;
      meetingAdvisorStatus.value = "等待录制中的新增转写，收到内容后会自动进行预判。";
`,
  "reset preview count"
);

replaceOnce(
  `      if (captureInterval) clearInterval(captureInterval);
      if (analysisInterval) clearTimeout(analysisInterval);
      if (meetingAdvisorPreviewTimer) clearTimeout(meetingAdvisorPreviewTimer);
`,
  `      if (captureInterval) clearInterval(captureInterval);
      if (analysisInterval) clearTimeout(analysisInterval);
      if (meetingAdvisorPreviewTimer) clearTimeout(meetingAdvisorPreviewTimer);
      lastMeetingAdvisorPreviewLineCount = 0;
`,
  "clear preview count on stop"
);

fs.writeFileSync(filePath, text, "utf8");
console.log("updated", filePath);
