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
  `function buildMeetingAdviceFingerprint(item) {
      return [item?.title || "", item?.summary || "", item?.suggestion || ""].join("|").trim();
    }

    `,
  `function buildMeetingAdviceFingerprint(item) {
      return [item?.title || "", item?.summary || "", item?.suggestion || ""].join("|").trim();
    }

    function normalizeMeetingAdviceKeyPart(text) {
      return String(text || "")
        .trim()
        .replace(/[\\s\\p{P}\\p{S}]+/gu, "")
        .slice(0, 48);
    }

    function buildMeetingAdviceIssueKey({ signalType = "", focusSpan = "", title = "", summary = "" } = {}) {
      const core = normalizeMeetingAdviceKeyPart(focusSpan) || normalizeMeetingAdviceKeyPart(summary) || normalizeMeetingAdviceKeyPart(title);
      return core ? [signalType || "none", core].join("|") : "";
    }

    `,
  "issue key helpers"
);

replaceOnce(
  `const fingerprint = buildMeetingAdviceFingerprint(adviceData);
        if (!fingerprint || fingerprint === lastMeetingAdviceFingerprint.value || meetingAdviceItems.value.some((item) => buildMeetingAdviceFingerprint(item) === fingerprint)) {
          meetingAdvisorStatus.value = "这次识别到的建议和最近内容重复，已自动跳过。";
          updateMeetingAdvisorDebug({ skippedReason: meetingAdvisorStatus.value });
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
`,
  `const summary = adviceData.summary || trigger.data.reason || "";
        const issueKey = buildMeetingAdviceIssueKey({
          signalType: trigger.data.signalType || "",
          focusSpan: trigger.data.focusSpan || "",
          title: adviceData.title || "会议建议",
          summary
        });
        const fingerprint = buildMeetingAdviceFingerprint({
          title: adviceData.title || "会议建议",
          summary,
          suggestion: adviceData.suggestion || ""
        });
        const nextItem = {
          id: \`meeting-advice-\${Date.now()}-\${Math.random().toString(36).slice(2, 8)}\`,
          issueKey,
          signalType: trigger.data.signalType || "",
          focusSpan: trigger.data.focusSpan || "",
          title: adviceData.title || "会议建议",
          adviceType: adviceData.adviceType || "proposal",
          summary,
          suggestion: adviceData.suggestion || "",
          nextQuestion: adviceData.nextQuestion || "",
          sourceNote: adviceData.sourceNote || (adviceData.needWebSearch ? "已尝试补充外部资料。" : "基于当前会议内容生成。")
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
`,
  "root dedupe block"
);

fs.writeFileSync(filePath, text, "utf8");
console.log("updated", filePath);
