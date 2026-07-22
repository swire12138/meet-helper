const fs = require("fs");
const path = require("path");

const filePath = path.resolve(process.cwd(), "web-static/app.js");
let text = fs.readFileSync(filePath, "utf8");

const line = `          <div v-if="item.nextQuestion" class="hint" style="margin-top:8px;">建议追问：{{ item.nextQuestion }}</div>
`;

if (!text.includes(line)) {
  throw new Error("missing nextQuestion line");
}

text = text.replace(line, "");
fs.writeFileSync(filePath, text, "utf8");
console.log("updated", filePath);
