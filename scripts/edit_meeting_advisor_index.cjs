const fs = require("fs");
const path = require("path");

const filePath = path.resolve(process.cwd(), "server/src/index.js");
let text = fs.readFileSync(filePath, "utf8");

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`missing anchor: ${label}`);
  }
  return source.replace(search, replacement);
}

text = replaceOnce(
  text,
  `} from "./sessionPreferences.js";`,
  `} from "./sessionPreferences.js";
import { detectMeetingAdviceTrigger, generateMeetingAdvice } from "./meetingAdvisor.js";`,
  "meeting advisor import"
);

text = replaceOnce(
  text,
  `function parseJsonContent(raw) {
  if (!raw || typeof raw !== "string") return { ok: false, error: "empty_content" };
  const extracted = extractLikelyJsonObject(raw) ?? raw;
  const parsed = safeJsonParse(extracted);
  if (parsed.ok) return parsed;
  const cleaned = raw.replace(/\`\`\`json\\s*/g, "").replace(/\`\`\`\\s*/g, "").trim();
  return safeJsonParse(extractLikelyJsonObject(cleaned) ?? cleaned);
}

`,
  `function parseJsonContent(raw) {
  if (!raw || typeof raw !== "string") return { ok: false, error: "empty_content" };
  const extracted = extractLikelyJsonObject(raw) ?? raw;
  const parsed = safeJsonParse(extracted);
  if (parsed.ok) return parsed;
  const cleaned = raw.replace(/\`\`\`json\\s*/g, "").replace(/\`\`\`\\s*/g, "").trim();
  return safeJsonParse(extractLikelyJsonObject(cleaned) ?? cleaned);
}

function normalizeTranscriptLineArray(value, limit = 12) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(-limit);
}

function buildAdviceDigest(value) {
  if (!Array.isArray(value) || value.length === 0) return "";
  return value
    .slice(-5)
    .map((item, idx) => {
      const title = typeof item?.title === "string" ? item.title.trim() : "";
      const summary = typeof item?.summary === "string" ? item.summary.trim() : "";
      return \`\${idx + 1}. \${title || "未命名建议"}\${summary ? \`：\${summary}\` : ""}\`;
    })
    .join("\\n");
}

function normalizeWebContext(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const snippet = typeof item.snippet === "string" ? item.snippet.trim() : "";
      const url = typeof item.url === "string" ? item.url.trim() : "";
      if (!title && !snippet && !url) return null;
      return { title, snippet, url };
    })
    .filter(Boolean)
    .slice(0, 5);
}

`,
  "helper functions"
);

const routeAnchor = `app.post("/api/profiles/guess-speakers", async (req, res) => {`;
if (!text.includes(routeAnchor)) {
  throw new Error("missing anchor: profiles guess route");
}

const meetingRoutes = `app.post("/api/meeting-advisor/trigger", async (req, res) => {
  try {
    const {
      recentLines = [],
      contextLines = [],
      recentSummary = ""
    } = req.body || {};

    const result = await detectMeetingAdviceTrigger({
      recentLines: normalizeTranscriptLineArray(recentLines, 10),
      contextLines: normalizeTranscriptLineArray(contextLines, 12),
      recentSummary: typeof recentSummary === "string" ? recentSummary : ""
    });

    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: "meeting_trigger_failed", message: e?.message || "unknown_error" });
  }
});

app.post("/api/meeting-advisor/web-search", async (req, res) => {
  try {
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
    if (!query) {
      return res.status(400).json({ ok: false, error: "missing_query" });
    }

    const endpoint = (process.env.MEETING_ADVISOR_WEB_SEARCH_URL || "").trim();
    if (!endpoint) {
      return res.json({ ok: true, data: { items: [] } });
    }

    const apiKey = (process.env.MEETING_ADVISOR_WEB_SEARCH_API_KEY || "").trim();
    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
      headers.Authorization = \`Bearer \${apiKey}\`;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query,
        max_results: 5,
        include_answer: false,
        include_raw_content: false
      })
    });
    const payload = await response.json().catch(() => null);
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const items = results.slice(0, 5).map((item) => ({
      title: typeof item?.title === "string" ? item.title : "",
      snippet: typeof item?.content === "string"
        ? item.content
        : (typeof item?.snippet === "string" ? item.snippet : ""),
      url: typeof item?.url === "string" ? item.url : ""
    }));

    res.json({ ok: true, data: { items } });
  } catch (e) {
    res.status(500).json({ ok: false, error: "meeting_web_search_failed", message: e?.message || "unknown_error" });
  }
});

app.post("/api/meeting-advisor/advice", async (req, res) => {
  try {
    const {
      signalType = "",
      focusSpan = "",
      recentLines = [],
      contextLines = [],
      recentSummary = "",
      profileName = "",
      profileRole = "",
      pendingAdvice = [],
      webContext = []
    } = req.body || {};

    const advice = await generateMeetingAdvice({
      signalType: typeof signalType === "string" ? signalType : "",
      focusSpan: typeof focusSpan === "string" ? focusSpan : "",
      recentLines: normalizeTranscriptLineArray(recentLines, 10),
      contextLines: normalizeTranscriptLineArray(contextLines, 16),
      recentSummary: typeof recentSummary === "string" ? recentSummary : "",
      profileName: typeof profileName === "string" ? profileName : "",
      profileRole: typeof profileRole === "string" ? profileRole : "",
      pendingAdviceDigest: buildAdviceDigest(pendingAdvice),
      webContext: normalizeWebContext(webContext)
    });

    res.json({ ok: true, data: advice });
  } catch (e) {
    res.status(500).json({ ok: false, error: "meeting_advice_failed", message: e?.message || "unknown_error" });
  }
});

`;

text = text.replace(routeAnchor, `${meetingRoutes}${routeAnchor}`);

fs.writeFileSync(filePath, text, "utf8");
console.log("updated", filePath);
