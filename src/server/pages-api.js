import { createOpenAIClient } from "./llm/openai-client.js";
import { createOptimizationService } from "./services/optimization-service.js";
import { createInMemoryOptimizationSessionStore } from "./services/in-memory-session-store.js";
import { logger } from "./utils/logger.js";

const sessionStore = createInMemoryOptimizationSessionStore();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function notImplemented(message = "EdgeOne Pages 最小版暂未实现该能力") {
  return json({
    ok: false,
    code: "EDGE_MVP_NOT_IMPLEMENTED",
    error: message,
  }, 501);
}

function createRuntime(env = {}) {
  const openAIClient = createOpenAIClient({
    apiKey: env.OPENAI_API_KEY || "",
    model: env.OPENAI_MODEL || "gpt-4.1-mini",
    baseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  });

  return createOptimizationService({
    storageRoot: "",
    sessionStore,
    llmClient: openAIClient,
    materialProvider: {
      async list() {
        return [];
      },
      async listWithContent() {
        return [];
      },
    },
  });
}

async function readJson(request) {
  const text = await request.text();
  return JSON.parse(text || "{}");
}

function envFromContext(context) {
  return context?.env || {};
}

export async function handlePagesRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === "OPTIONS") {
    return json({}, 204);
  }

  if (!pathname.startsWith("/api/")) {
    return json({ ok: false, error: "Not found" }, 404);
  }

  if (request.method === "GET" && pathname === "/api/health") {
    const env = envFromContext(context);
    return json({
      ok: true,
      runtime: "edgeone-pages-node-functions-mvp",
      openaiConfigured: Boolean(env.OPENAI_API_KEY),
      model: env.OPENAI_API_KEY ? (env.OPENAI_MODEL || "gpt-4.1-mini") : "-",
      notes: [
        "当前为 EdgeOne Pages 最小可用版本",
        "文件上传、资料库服务端持久化、PPT 预览暂未实现",
      ],
    });
  }

  if (pathname.startsWith("/api/job-materials")) {
    return notImplemented("EdgeOne Pages 最小版暂未实现资料上传与服务端资料库能力，等待后续开发。");
  }

  if (request.method === "GET" && pathname === "/api/optimization-session") {
    try {
      const service = createRuntime(envFromContext(context));
      const session = await service.loadSession(
        url.searchParams.get("user") || "",
        url.searchParams.get("sessionId") || "",
      );
      return json({ ok: true, data: session });
    } catch (error) {
      return json({ ok: false, error: error.message || "读取会话失败" }, 400);
    }
  }

  if (request.method === "GET" && pathname === "/api/continue-optimization-session") {
    try {
      const service = createRuntime(envFromContext(context));
      const session = await service.continueLatestSession(
        url.searchParams.get("user") || "",
        {
          jobId: url.searchParams.get("jobId") || "",
          resumeId: url.searchParams.get("resumeId") || "",
        },
      );
      return json({ ok: true, data: session });
    } catch (error) {
      return json({ ok: false, error: error.message || "读取优化会话失败" }, 400);
    }
  }

  if (request.method === "POST" && pathname === "/api/analyze-job") {
    try {
      const payload = await readJson(request);
      const service = createRuntime(envFromContext(context));
      const session = await service.createOrLoadSession({
        user: payload.user,
        sessionId: payload.sessionId,
        jobId: payload.jobId,
        selectedResumeId: payload.selectedResumeId,
        resumeText: payload.resumeText,
        resumeTitle: payload.resumeTitle,
        userGoal: payload.userGoal,
        constraints: payload.constraints,
      });
      const jobAnalysis = await service.analyzeJob({
        session,
        job: payload.job || {},
      });
      return json({ ok: true, data: { sessionId: session.id, jobAnalysis, session } });
    } catch (error) {
      logger.error("Analyze job failed", { error: error.message });
      return json({ ok: false, error: error.message || "岗位分析失败" }, 400);
    }
  }

  if (request.method === "POST" && pathname === "/api/generate-optimized-resume") {
    try {
      const payload = await readJson(request);
      const service = createRuntime(envFromContext(context));
      const session = await service.loadSession(payload.user, payload.sessionId);
      const optimizedResumeVersion = await service.generateOptimizedResume({ session });
      return json({ ok: true, data: { sessionId: session.id, optimizedResumeVersion, session } });
    } catch (error) {
      logger.error("Generate optimized resume failed", { error: error.message });
      return json({ ok: false, error: error.message || "生成优化简历失败" }, 400);
    }
  }

  if (pathname === "/api/score-resume" || pathname === "/api/generate-suggestions" || pathname === "/api/apply-suggestions" || pathname === "/api/rescore-resume" || pathname === "/api/pause-optimization-session" || pathname === "/api/parse-job") {
    return notImplemented("当前最小版仅保留基础简历优化主链路，其余增强能力等待后续开发。");
  }

  return json({ ok: false, error: "Not found" }, 404);
}
