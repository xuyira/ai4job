import fs from "node:fs";
import path from "node:path";

function safeSegment(value) {
  return encodeURIComponent(String(value || "").trim() || "unknown").replace(/%/g, "_");
}

export function createOptimizationSessionStore({ storageRoot }) {
  function sessionDir(user) {
    return path.join(storageRoot, safeSegment(user), "__optimization_sessions__");
  }

  function sessionPath(user, sessionId) {
    return path.join(sessionDir(user), `${safeSegment(sessionId)}.json`);
  }

  async function ensureDir(user) {
    await fs.promises.mkdir(sessionDir(user), { recursive: true });
  }

  async function save(session) {
    await ensureDir(session.user);
    await fs.promises.writeFile(sessionPath(session.user, session.id), JSON.stringify(session, null, 2), "utf8");
  }

  async function load(user, sessionId) {
    const content = await fs.promises.readFile(sessionPath(user, sessionId), "utf8");
    return JSON.parse(content);
  }

  async function loadLatestIncomplete(user, { jobId = "", resumeId = "" } = {}) {
    try {
      await ensureDir(user);
      const files = await fs.promises.readdir(sessionDir(user));
      const sessions = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const content = await fs.promises.readFile(path.join(sessionDir(user), file), "utf8");
        const session = JSON.parse(content);
        if (jobId && session.jobId !== jobId) continue;
        if (resumeId && session.selectedResumeId !== resumeId) continue;
        if (session.status === "completed") continue;
        sessions.push(session);
      }
      sessions.sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
      return sessions[0] || null;
    } catch {
      return null;
    }
  }

  return {
    save,
    load,
    loadLatestIncomplete,
  };
}
