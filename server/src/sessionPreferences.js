﻿﻿﻿﻿﻿const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

function toIsoString(value, fallback = "") {
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return fallback;
}

function hashText(text) {
  const source = String(text || "");
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function buildPreferenceKey(item, index) {
  const explicitKey = typeof item?.key === "string" ? item.key.trim() : "";
  if (explicitKey) return explicitKey;
  const seed = [item?.label || "", item?.value || "", item?.evidence || "", index].join("|");
  return `pref-${hashText(seed)}`;
}

function normalizeTemporaryPreferenceItem(item, index, fallbackUpdatedAt) {
  if (!item || typeof item !== "object") return null;
  const label = typeof item.label === "string" ? item.label.trim() : "";
  const value = typeof item.value === "string" ? item.value.trim() : "";
  if (!label || !value) return null;
  return {
    key: buildPreferenceKey(item, index),
    label,
    value,
    evidence: typeof item.evidence === "string" ? item.evidence.trim() : "",
    updatedAt: toIsoString(item.updatedAt, fallbackUpdatedAt)
  };
}

function buildEmptyPreferenceData(nowIso = "") {
  return {
    updatedAt: nowIso,
    expiresAt: "",
    items: []
  };
}

export function normalizeTemporaryPreferenceData(value, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : DEFAULT_TTL_MS;
  const nowIso = now.toISOString();

  if (!value || typeof value !== "object") {
    return buildEmptyPreferenceData("");
  }

  const updatedAt = toIsoString(value.updatedAt, nowIso);
  const normalizedItems = Array.isArray(value.items)
    ? value.items
        .map((item, index) => normalizeTemporaryPreferenceItem(item, index, updatedAt))
        .filter(Boolean)
    : [];

  if (normalizedItems.length === 0) {
    return buildEmptyPreferenceData(updatedAt || nowIso);
  }

  const expiresAt = toIsoString(value.expiresAt, new Date(new Date(updatedAt).getTime() + ttlMs).toISOString());
  if (expiresAt) {
    const expireTime = new Date(expiresAt);
    if (!Number.isNaN(expireTime.getTime()) && expireTime.getTime() <= now.getTime()) {
      return buildEmptyPreferenceData(nowIso);
    }
  }

  return {
    updatedAt,
    expiresAt,
    items: normalizedItems
  };
}

export function clearTemporaryPreferenceData(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  return buildEmptyPreferenceData(now.toISOString());
}

export function removeTemporaryPreferenceItem(value, key, options = {}) {
  const normalized = normalizeTemporaryPreferenceData(value, options);
  const normalizedKey = typeof key === "string" ? key.trim() : "";
  if (!normalizedKey || normalized.items.length === 0) {
    return normalized;
  }

  const nextItems = normalized.items.filter((item) => item.key !== normalizedKey);
  if (nextItems.length === 0) {
    return clearTemporaryPreferenceData(options);
  }

  return normalizeTemporaryPreferenceData(
    {
      updatedAt: options.now instanceof Date ? options.now.toISOString() : new Date().toISOString(),
      expiresAt: normalized.expiresAt,
      items: nextItems
    },
    options
  );
}
