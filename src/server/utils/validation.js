export function assertRequired(value, message) {
  if (!String(value || "").trim()) {
    throw new Error(message);
  }
}

export function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}
