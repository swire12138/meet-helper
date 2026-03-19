import dotenv from "dotenv";
import path from "node:path";

export function loadEnv() {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env")
  ];

  for (const p of candidates) {
    const result = dotenv.config({ path: p, override: true });
    if (!result.error) return;
  }
}

export function getRequiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
