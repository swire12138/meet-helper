import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setupAsrSocket } from "./asr.js";

export function setupScreenCatchRoutes(app, server) {
  app.post("/api/screenshot", (req, res) => {
    try {
      const { image, sessionId } = req.body;
      if (!image) return res.status(400).json({ ok: false, error: "missing_image" });
      
      const sessionDirName = sessionId || "default-session";
      const baseDir = path.resolve(process.cwd(), "..", "screen-catch", "data", sessionDirName);
      const picsDir = path.join(baseDir, "pics");
      
      if (!fs.existsSync(picsDir)) {
        fs.mkdirSync(picsDir, { recursive: true });
      }

      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `screenshot-${timestamp}.png`;
      const filepath = path.join(picsDir, filename);
      
      fs.writeFileSync(filepath, buffer);
      res.json({ ok: true, filename });
    } catch (e) {
      console.error("Screenshot save error:", e);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  setupAsrSocket(server);
}
