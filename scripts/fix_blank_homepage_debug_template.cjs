const fs = require("fs");
const path = require("path");

const filePath = path.resolve(process.cwd(), "web-static/app.js");
let text = fs.readFileSync(filePath, "utf8");

const helperSearch = `    function formatDebugJson(value) {
      if (value == null) return "暂无";
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
`;

const helperReplacement = `    function formatDebugJson(value) {
      if (value == null) return "暂无";
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }

    function formatDebugLines(lines) {
      if (!Array.isArray(lines) || lines.length === 0) return "暂无";
      return lines.join("\\n");
    }
`;

if (!text.includes(helperSearch)) {
  throw new Error("missing formatDebugJson block");
}
text = text.replace(helperSearch, helperReplacement);

const returnSearch = `      meetingAdvisorDebug,
      formatDebugJson,
      removeMeetingAdvice,
`;
const returnReplacement = `      meetingAdvisorDebug,
      formatDebugJson,
      formatDebugLines,
      removeMeetingAdvice,
`;
if (!text.includes(returnSearch)) {
  throw new Error("missing return block");
}
text = text.replace(returnSearch, returnReplacement);

const templateSearch = `{{ meetingAdvisorDebug.recentLines.join('\\n') || '暂无' }}`;
const templateReplacement = `{{ formatDebugLines(meetingAdvisorDebug.recentLines) }}`;
if (!text.includes(templateSearch)) {
  throw new Error("missing recent lines template");
}
text = text.replace(templateSearch, templateReplacement);

fs.writeFileSync(filePath, text, "utf8");
console.log("updated", filePath);
