const fs = require("fs");
const path = require("path");

const filePath = path.resolve(process.cwd(), "web-static/app.js");
let text = fs.readFileSync(filePath, "utf8");

const newBlock = `const adviceData = adviceResult.data;
        updateMeetingAdvisorDebug({
          search: adviceData?.usedWebSearch
            ? { ok: true, mode: "qwen_web_search", query: adviceData.searchQuery || "", sourceNote: adviceData.sourceNote || "" }
            : { ok: true, mode: "disabled" }
        });`;

const start = text.indexOf(`let adviceData = adviceResult.data;`);
const end = text.indexOf(`const summary = adviceData.summary || trigger.data.reason || "";`, start);
if (start < 0 || end < 0 || end <= start) {
  throw new Error("advice web-search markers not found");
}
text = text.slice(0, start) + newBlock + "\n\n        " + text.slice(end);
text = text.replace(
  `sourceNote: adviceData.sourceNote || (adviceData.needWebSearch ? "已尝试补充外部资料。" : "基于当前会议内容生成。")`,
  `sourceNote: adviceData.sourceNote || (adviceData.usedWebSearch ? "已通过 Qwen web_search 联网补充外部资料。" : "基于当前会议内容生成。")`
);

fs.writeFileSync(filePath, text, "utf8");
console.log("updated", filePath);
