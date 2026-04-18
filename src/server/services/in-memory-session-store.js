export function createInMemoryOptimizationSessionStore() {
  const sessions = new Map();

  function key(user, sessionId) {
    return `${String(user || "").trim()}::${String(sessionId || "").trim()}`;
  }

  async function save(session) {
    sessions.set(key(session.user, session.id), structuredClone(session));
  }

  async function load(user, sessionId) {
    const session = sessions.get(key(user, sessionId));
    if (!session) {
      throw new Error("未找到优化会话，当前最小版暂不支持服务端持久化恢复。");
    }
    return structuredClone(session);
  }

  async function loadLatestIncomplete(user, { jobId = "", resumeId = "" } = {}) {
    const userPrefix = `${String(user || "").trim()}::`;
    const matches = [];
    for (const [entryKey, session] of sessions.entries()) {
      if (!entryKey.startsWith(userPrefix)) continue;
      if (jobId && session.jobId !== jobId) continue;
      if (resumeId && session.selectedResumeId !== resumeId) continue;
      if (session.status === "completed") continue;
      matches.push(structuredClone(session));
    }
    matches.sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
    return matches[0] || null;
  }

  return {
    save,
    load,
    loadLatestIncomplete,
  };
}
