export function writeNdjson(res, obj) {
  res.write(`${JSON.stringify(obj)}\n`);
}

export function nowIso() {
  return new Date().toISOString();
}
