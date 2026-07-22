const fs = require("fs");
const path = require("path");

const filePath = path.resolve(process.cwd(), "web-static/app.js");
let text = fs.readFileSync(filePath, "utf8");

const search = `        <div class="hint" style="margin-top:0;">{{ meetingAdvisorStatus }}</div>
        <div v-if="meetingAdviceItems.length === 0" class="hint">还没有触发会议建议。</div>
`;

const replacement = `        <div class="hint" style="margin-top:0;">{{ meetingAdvisorStatus }}</div>
        <div class="hint" style="margin-top:6px;">
          预判结果：
          {{ meetingAdvisorDebug.trigger?.data
            ? ((meetingAdvisorDebug.trigger.data.shouldTrigger ? '已触发' : '未触发')
              + ' / '
              + (meetingAdvisorDebug.trigger.data.signalType || 'none')
              + ' / 置信度 '
              + Math.round((Number(meetingAdvisorDebug.trigger.data.confidence) || 0) * 100)
              + '%')
            : '暂无' }}
        </div>
        <div v-if="meetingAdvisorDebug.trigger?.data?.reason" class="hint" style="margin-top:4px;">
          分析结果：{{ meetingAdvisorDebug.trigger.data.reason }}
        </div>
        <div v-if="meetingAdviceItems.length === 0" class="hint">还没有触发会议建议。</div>
`;

if (!text.includes(search)) {
  throw new Error("missing advisor summary anchor");
}

text = text.replace(search, replacement);
fs.writeFileSync(filePath, text, "utf8");
console.log("updated", filePath);
