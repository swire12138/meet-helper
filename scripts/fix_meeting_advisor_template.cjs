const fs = require("fs");
const path = require("path");

const filePath = path.resolve(process.cwd(), "web-static/app.js");
let text = fs.readFileSync(filePath, "utf8");

text = text.replace(
  "{{ meetingAdvisorLoading ? '判断中...' : `${meetingAdviceItems.length} 条` }}",
  "{{ meetingAdvisorLoading ? '判断中...' : (meetingAdviceItems.length + ' 条') }}"
);

fs.writeFileSync(filePath, text, "utf8");
console.log("fixed", filePath);
