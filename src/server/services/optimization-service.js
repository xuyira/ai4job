import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createLineDiff } from "./resume-diff-service.js";
import {
  buildJobAnalysisPrompt,
  buildResumeRewritePrompt,
  buildResumeScorePrompt,
  buildSuggestionRegenerationPrompt,
  buildSuggestionsPrompt,
} from "../llm/optimization-prompts.js";
import {
  createEmptyJobAnalysis,
  createEmptyResumeScore,
  createOptimizationSession,
  createResumeVersion,
  createSuggestionFeedback,
  createSuggestionItem,
  logSessionEvent,
  markSessionError,
  touchEntity,
} from "../../shared/optimization-schema.js";
import {
  OPTIMIZATION_STEPS,
  SCORE_TYPE,
  SESSION_STATUS,
  STEP_RESULT_STATUS,
  STREAM_EVENT,
  SUGGESTION_STATUS,
} from "../../shared/optimization-constants.js";
import { assertRequired, ensureArray } from "../utils/validation.js";

function safeSegment(value) {
  return encodeURIComponent(String(value || "").trim() || "unknown").replace(/%/g, "_");
}

async function readManifest(storageRoot, user, scopeId) {
  const manifestPath = path.join(storageRoot, safeSegment(user), safeSegment(scopeId), "manifest.json");
  try {
    const content = await fs.promises.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.materials) ? parsed.materials : [];
  } catch {
    return [];
  }
}

async function readFileText(filePath) {
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function extractDocxText(filePath) {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("unzip", ["-p", filePath, "word/document.xml"]);
    return String(stdout || "")
      .replace(/<w:p[^>]*>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch {
    return "";
  }
}

async function extractPdfText(filePath) {
  throw new Error(`当前环境缺少 PDF 解析能力，无法读取 ${path.basename(filePath)} 的正文。请改用 DOCX / Markdown / TXT，或先将 PDF 转成 DOCX 后再上传。`);
}

async function extractMaterialContent(storageRoot, user, scopeId, material) {
  if (!material) return "";
  if (material.type === "text") return String(material.content || "");
  const fullPath = path.join(storageRoot, safeSegment(user), safeSegment(scopeId), material.filePath || "");
  const ext = path.extname(material.fileName || "").toLowerCase();
  if (ext === ".md" || ext === ".txt") {
    return readFileText(fullPath);
  }
  if (ext === ".docx") {
    return extractDocxText(fullPath);
  }
  if (ext === ".pdf") {
    return extractPdfText(fullPath);
  }
  return "";
}

function pickResumeSections(resumeText) {
  const normalized = String(resumeText || "").replace(/\r\n/g, "\n");
  const chunks = normalized.split(/\n(?=#{1,3}\s)/).filter(Boolean);
  if (chunks.length) {
    return chunks.slice(0, 8).map((chunk, index) => ({
      targetSection: chunk.split("\n")[0].replace(/^#+\s*/, "").trim() || `Section ${index + 1}`,
      targetAnchor: `section-${index + 1}`,
      originalText: chunk.trim(),
    }));
  }

  const paragraphs = normalized.split(/\n{2,}/).filter(Boolean);
  return paragraphs.slice(0, 8).map((chunk, index) => ({
    targetSection: `段落 ${index + 1}`,
    targetAnchor: `paragraph-${index + 1}`,
    originalText: chunk.trim(),
  }));
}

function hasMeaningfulResumeContent(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  if (normalized.includes("当前文件类型暂未解析出正文")) return false;
  return normalized.length >= 40;
}

function validateJobAnalysisPayload(parsed) {
  if (!parsed || typeof parsed !== "object") throw new Error("岗位分析结果为空。");
  for (const key of ["summary", "coreResponsibilities", "requiredSkills", "bonusSkills", "keywords", "experienceRequirement", "structuralSignals", "keyQuestions", "rawText"]) {
    if (!(key in parsed)) throw new Error(`岗位分析缺少字段：${key}`);
  }
  if (!Array.isArray(parsed.coreResponsibilities) || !parsed.coreResponsibilities.length) throw new Error("岗位分析缺少核心职责。");
  if (!Array.isArray(parsed.requiredSkills) || !parsed.requiredSkills.length) throw new Error("岗位分析缺少必备技能。");
  if (!Array.isArray(parsed.keywords) || !parsed.keywords.length) throw new Error("岗位分析缺少关键词。");
  for (const key of ["coreWork", "roleDifferentiators", "businessDirection", "idealCandidate"]) {
    const item = parsed.keyQuestions?.[key];
    if (!item || typeof item !== "object") throw new Error(`岗位分析关键问题缺少字段：${key}`);
    if (!String(item.question || "").trim()) throw new Error(`岗位分析关键问题缺少 question：${key}`);
    if (!String(item.answer || "").trim()) throw new Error(`岗位分析关键问题缺少 answer：${key}`);
  }
}

function validateResumeScorePayload(parsed) {
  if (!parsed || typeof parsed !== "object") throw new Error("简历评分结果为空。");
  if (!Number.isFinite(Number(parsed.totalScore))) throw new Error("简历评分缺少 totalScore。");
  if (!parsed.rubric?.jobMatch || !parsed.rubric?.contentQuality || !parsed.rubric?.persuasiveness) {
    throw new Error("简历评分 rubric 结构不完整。");
  }
}

function validateSuggestionsPayload(parsed) {
  const suggestions = ensureArray(parsed?.suggestions);
  if (!suggestions.length) throw new Error("模型没有返回任何逐条建议。");
  for (const item of suggestions) {
    if (!String(item.targetSection || "").trim()) throw new Error("建议缺少 targetSection。");
    if (!String(item.originalText || "").trim()) throw new Error("建议缺少 originalText。");
    if (!String(item.suggestedText || "").trim()) throw new Error("建议缺少 suggestedText。");
  }
}

function hasMeaningfulDiff(before, after) {
  return String(before || "").trim() !== String(after || "").trim();
}

export function createOptimizationService({ storageRoot, sessionStore, llmClient }) {
  const activeControllers = new Map();

  async function listMaterials(user, scopeId) {
    return readManifest(storageRoot, user, scopeId);
  }

  async function listMaterialsWithContent(user, scopeId) {
    const materials = await listMaterials(user, scopeId);
    return Promise.all(materials.map(async (item) => ({
      ...item,
      extractedContent: await extractMaterialContent(storageRoot, user, scopeId, item),
    })));
  }

  async function getResumeMaterial(user, resumeId) {
    const materials = await listMaterials(user, "__resume_library__");
    return materials.find((item) => item.id === resumeId) || null;
  }

  async function getResumeText(user, resumeId) {
    const material = await getResumeMaterial(user, resumeId);
    if (!material) throw new Error("未找到当前简历版本");
    const content = await extractMaterialContent(storageRoot, user, "__resume_library__", material);
    if (!hasMeaningfulResumeContent(content || material.content || "")) {
      throw new Error(`简历正文提取失败：${material.name || material.fileName || "当前简历"}。请上传 DOCX / Markdown / TXT，或先将 PDF 转成 DOCX。`);
    }
    return {
      material,
      content: content || material.content || "",
    };
  }

  async function createOrLoadSession({ user, sessionId, jobId, selectedResumeId, userGoal = "", constraints = {} }) {
    if (sessionId) {
      return sessionStore.load(user, sessionId);
    }

    assertRequired(user, "缺少用户标识");
    assertRequired(jobId, "缺少岗位标识");
    assertRequired(selectedResumeId, "缺少简历标识");

    const { material, content } = await getResumeText(user, selectedResumeId);
    const session = createOptimizationSession({
      id: randomUUID(),
      user,
      jobId,
      selectedResumeId,
      userGoal,
      constraints,
      originalResumeVersion: createResumeVersion({
        id: randomUUID(),
        sessionId: "",
        sourceMaterialId: material.id,
        kind: "original",
        title: material.name || material.fileName || "原简历",
        content,
        format: material.type === "text" ? "markdown" : "text",
      }),
    });
    session.originalResumeVersion.sessionId = session.id;
    await sessionStore.save(session);
    return session;
  }

  async function withStep(session, { step, stepStatusKey }, worker) {
    session.status = SESSION_STATUS.IN_PROGRESS;
    session.currentStep = step;
    session.stepStatus[stepStatusKey] = STEP_RESULT_STATUS.STREAMING;
    session.updatedAt = new Date().toISOString();
    await sessionStore.save(session);

    try {
      const result = await worker();
      session.stepStatus[stepStatusKey] = STEP_RESULT_STATUS.COMPLETED;
      session.updatedAt = new Date().toISOString();
      await sessionStore.save(session);
      return result;
    } catch (error) {
      session.stepStatus[stepStatusKey] = STEP_RESULT_STATUS.FAILED;
      markSessionError(session, {
        step,
        message: error.message || "步骤执行失败",
        retryable: true,
      });
      await sessionStore.save(session);
      throw error;
    }
  }

  function setAbortController(sessionId, controller) {
    activeControllers.set(sessionId, controller);
  }

  function clearAbortController(sessionId) {
    activeControllers.delete(sessionId);
  }

  async function pauseSession(user, sessionId) {
    const session = await sessionStore.load(user, sessionId);
    session.status = SESSION_STATUS.PAUSED;
    session.updatedAt = new Date().toISOString();
    const controller = activeControllers.get(sessionId);
    if (controller) controller.aborted = true;
    await sessionStore.save(session);
    return session;
  }

  async function continueLatestSession(user, { jobId, resumeId }) {
    return sessionStore.loadLatestIncomplete(user, { jobId, resumeId });
  }

  async function analyzeJob({ session, job, writeEvent }) {
    return withStep(session, { step: OPTIMIZATION_STEPS.JOB_ANALYSIS, stepStatusKey: "jobAnalysis" }, async () => {
      const jobMaterials = await listMaterials(session.user, session.jobId);
      const controller = { aborted: false };
      setAbortController(session.id, controller);
      const analysis = createEmptyJobAnalysis({
        id: randomUUID(),
        sessionId: session.id,
        jobId: session.jobId,
      });
      analysis.status = STEP_RESULT_STATUS.STREAMING;
      session.jobAnalysis = analysis;
      await sessionStore.save(session);
      writeEvent?.(STREAM_EVENT.SESSION, { sessionId: session.id, step: session.currentStep });

      const enrichedJobMaterials = await listMaterialsWithContent(session.user, session.jobId);
      const prompt = buildJobAnalysisPrompt({
        job,
        jobMaterials: enrichedJobMaterials.map((item) => ({
          ...item,
          content: item.extractedContent || item.content || "",
        })),
      });
      let parsed;
      try {
        parsed = await llmClient.chatJson({
          system: "你是严谨的岗位分析器，只能依据输入内容输出结构化岗位分析 JSON。",
          user: prompt,
        });
        validateJobAnalysisPayload(parsed);
      } catch (error) {
        logSessionEvent(session, {
          id: randomUUID(),
          type: "job_analysis_failed",
          step: OPTIMIZATION_STEPS.JOB_ANALYSIS,
          message: `岗位分析失败：${error.message}`,
        });
        await sessionStore.save(session);
        throw new Error(`岗位分析失败：${error.message}`);
      }

      const patch = {
        ...parsed,
        status: STEP_RESULT_STATUS.COMPLETED,
      };
      for (const [field, value] of Object.entries(patch)) {
        if (controller.aborted) throw new Error("会话已暂停");
        analysis[field] = value;
        touchEntity(analysis);
        await sessionStore.save(session);
        writeEvent?.(STREAM_EVENT.JOB_ANALYSIS_DELTA, { field, value, sessionId: session.id });
      }

      logSessionEvent(session, {
        id: randomUUID(),
        type: "job_analysis_completed",
        step: OPTIMIZATION_STEPS.JOB_ANALYSIS,
        message: "岗位分析完成",
      });
      await sessionStore.save(session);
      clearAbortController(session.id);
      writeEvent?.(STREAM_EVENT.JOB_ANALYSIS_COMPLETED, { sessionId: session.id, jobAnalysis: analysis });
      return analysis;
    });
  }

  async function scoreResume({ session, scoreType, writeEvent }) {
    const resumeVersion = scoreType === SCORE_TYPE.OPTIMIZED ? session.optimizedResumeVersion : session.originalResumeVersion;
    if (!resumeVersion) throw new Error("当前不存在可评分的简历版本");
    const stepStatusKey = scoreType === SCORE_TYPE.OPTIMIZED ? "rescoring" : "originalScore";
    const step = scoreType === SCORE_TYPE.OPTIMIZED ? OPTIMIZATION_STEPS.RESUME_RESCORING : OPTIMIZATION_STEPS.RESUME_SCORING;

    return withStep(session, { step, stepStatusKey }, async () => {
      const personalMaterials = await listMaterialsWithContent(session.user, "__personal_materials__");
      const score = createEmptyResumeScore({
        id: randomUUID(),
        sessionId: session.id,
        resumeVersionId: resumeVersion.id,
        scoreType,
      });
      score.status = STEP_RESULT_STATUS.STREAMING;
      if (scoreType === SCORE_TYPE.OPTIMIZED) session.optimizedScore = score;
      else session.originalScore = score;
      await sessionStore.save(session);

      const prompt = buildResumeScorePrompt({
        jobAnalysis: session.jobAnalysis,
        resumeText: resumeVersion.content,
        personalMaterials: personalMaterials.map((item) => ({
          ...item,
          content: item.extractedContent || item.content || "",
        })),
        scoreType,
      });

      let parsed;
      try {
        parsed = await llmClient.chatJson({
          system: "你是简历评分器，请严格返回结构化 JSON。",
          user: prompt,
        });
        validateResumeScorePayload(parsed);
      } catch (error) {
        logSessionEvent(session, {
          id: randomUUID(),
          type: "resume_score_failed",
          step,
          message: `简历评分失败：${error.message}`,
        });
        await sessionStore.save(session);
        throw new Error(`简历评分失败：${error.message}`);
      }

      for (const [field, value] of Object.entries({ ...parsed, status: STEP_RESULT_STATUS.COMPLETED })) {
        score[field] = value;
        touchEntity(score);
        await sessionStore.save(session);
        writeEvent?.(STREAM_EVENT.SCORE_DELTA, { sessionId: session.id, scoreType, field, value });
      }

      logSessionEvent(session, {
        id: randomUUID(),
        type: "resume_score_completed",
        step,
        message: scoreType === SCORE_TYPE.OPTIMIZED ? "优化后简历评分完成" : "原简历评分完成",
      });
      if (scoreType === SCORE_TYPE.ORIGINAL) {
        session.currentStep = OPTIMIZATION_STEPS.SUGGESTION_GENERATION;
      } else {
        session.status = SESSION_STATUS.COMPLETED;
      }
      await sessionStore.save(session);
      writeEvent?.(STREAM_EVENT.SCORE_COMPLETED, { sessionId: session.id, scoreType, score });
      return score;
    });
  }

  async function generateSuggestions({ session, userGoal, constraints, writeEvent }) {
    return withStep(session, { step: OPTIMIZATION_STEPS.SUGGESTION_GENERATION, stepStatusKey: "suggestions" }, async () => {
      const personalMaterials = await listMaterialsWithContent(session.user, "__personal_materials__");
      session.userGoal = userGoal || session.userGoal || "";
      session.constraints = {
        emphasize: ensureArray(constraints?.emphasize || session.constraints.emphasize),
        preserve: ensureArray(constraints?.preserve || session.constraints.preserve),
      };
      session.suggestions = [];
      await sessionStore.save(session);

      const prompt = buildSuggestionsPrompt({
        jobAnalysis: session.jobAnalysis,
        resumeText: session.originalResumeVersion.content,
        originalScore: session.originalScore,
        userGoal: session.userGoal,
        constraints: session.constraints,
        personalMaterials: personalMaterials.map((item) => ({
          ...item,
          content: item.extractedContent || item.content || "",
        })),
      });
      let parsed;
      try {
        parsed = await llmClient.chatJson({
          system: "你是结构化简历优化建议生成器，只能输出 JSON。",
          user: prompt,
        });
        validateSuggestionsPayload(parsed);
      } catch (error) {
        logSessionEvent(session, {
          id: randomUUID(),
          type: "suggestions_failed",
          step: OPTIMIZATION_STEPS.SUGGESTION_GENERATION,
          message: `逐条建议生成失败：${error.message}`,
        });
        await sessionStore.save(session);
        throw new Error(`逐条建议生成失败：${error.message}`);
      }

      for (const rawItem of ensureArray(parsed.suggestions)) {
        const suggestion = createSuggestionItem({
          id: randomUUID(),
          sessionId: session.id,
          targetSection: rawItem.targetSection,
          targetAnchor: rawItem.targetAnchor,
          originalText: rawItem.originalText,
        });
        suggestion.suggestedText = rawItem.suggestedText || "";
        suggestion.reason = rawItem.reason || suggestion.reason;
        suggestion.expectedBenefit = rawItem.expectedBenefit || "";
        suggestion.riskNotice = rawItem.riskNotice || "";
        suggestion.priority = rawItem.priority || "medium";
        suggestion.diffPreview = {
          before: suggestion.originalText,
          after: suggestion.suggestedText,
        };
        suggestion.status = SUGGESTION_STATUS.PENDING;
        session.suggestions.push(suggestion);
        touchEntity(suggestion);
        await sessionStore.save(session);
        writeEvent?.(STREAM_EVENT.SUGGESTION_DELTA, { sessionId: session.id, suggestion });
      }

      session.status = SESSION_STATUS.WAITING_FEEDBACK;
      session.currentStep = OPTIMIZATION_STEPS.FEEDBACK_REVIEW;
      session.stepStatus.feedback = STEP_RESULT_STATUS.PENDING;
      logSessionEvent(session, {
        id: randomUUID(),
        type: "suggestions_completed",
        step: OPTIMIZATION_STEPS.SUGGESTION_GENERATION,
        message: `已生成 ${session.suggestions.length} 条优化建议`,
      });
      await sessionStore.save(session);
      writeEvent?.(STREAM_EVENT.SUGGESTIONS_COMPLETED, { sessionId: session.id, suggestions: session.suggestions });
      return session.suggestions;
    });
  }

  async function regenerateSuggestion({ session, suggestion, instruction }) {
    let parsed;
    try {
      parsed = await llmClient.chatJson({
        system: "你是简历建议重写器，只能输出 JSON。",
        user: buildSuggestionRegenerationPrompt({ suggestion, instruction, jobAnalysis: session.jobAnalysis }),
      });
      if (!String(parsed?.suggestedText || "").trim()) {
        throw new Error("模型没有返回重写后的建议文本。");
      }
    } catch (error) {
      throw new Error(`建议重写失败：${error.message}`);
    }
    suggestion.suggestedText = parsed.suggestedText || suggestion.suggestedText;
    suggestion.expectedBenefit = parsed.expectedBenefit || suggestion.expectedBenefit;
    suggestion.riskNotice = parsed.riskNotice || suggestion.riskNotice;
    suggestion.reason = parsed.reason || suggestion.reason;
    suggestion.regeneratedCount += 1;
    suggestion.status = SUGGESTION_STATUS.PENDING;
    suggestion.diffPreview = {
      before: suggestion.originalText,
      after: suggestion.suggestedText,
    };
    touchEntity(suggestion);
  }

  async function applySuggestionActions({ session, actions, generateResume = false, writeEvent }) {
    return withStep(session, { step: OPTIMIZATION_STEPS.FEEDBACK_REVIEW, stepStatusKey: "feedback" }, async () => {
      for (const action of ensureArray(actions)) {
        const suggestion = session.suggestions.find((item) => item.id === action.suggestionId);
        if (!suggestion) continue;

        session.feedbackHistory.push(createSuggestionFeedback({
          id: randomUUID(),
          sessionId: session.id,
          suggestionId: suggestion.id,
          action: action.action,
          editedText: action.editedText,
          comment: action.comment,
          userInstruction: action.userInstruction,
        }));

        if (action.action === "accept") {
          suggestion.status = SUGGESTION_STATUS.ACCEPTED;
        } else if (action.action === "reject") {
          suggestion.status = SUGGESTION_STATUS.REJECTED;
        } else if (action.action === "edit") {
          suggestion.status = SUGGESTION_STATUS.EDITED;
          suggestion.suggestedText = String(action.editedText || suggestion.suggestedText);
          suggestion.diffPreview = { before: suggestion.originalText, after: suggestion.suggestedText };
        } else if (action.action === "regenerate") {
          suggestion.status = SUGGESTION_STATUS.REGENERATING;
          await regenerateSuggestion({ session, suggestion, instruction: action.userInstruction || action.comment || "" });
        }
        touchEntity(suggestion);
      }

      session.stepStatus.feedback = STEP_RESULT_STATUS.COMPLETED;
      session.currentStep = generateResume ? OPTIMIZATION_STEPS.RESUME_GENERATION : OPTIMIZATION_STEPS.FEEDBACK_REVIEW;
      await sessionStore.save(session);

      if (generateResume) {
        await generateOptimizedResume({ session, writeEvent });
      }
      return session;
    });
  }

  async function generateOptimizedResume({ session, writeEvent }) {
    return withStep(session, { step: OPTIMIZATION_STEPS.RESUME_GENERATION, stepStatusKey: "optimizedResume" }, async () => {
      const accepted = session.suggestions.filter((item) => [SUGGESTION_STATUS.ACCEPTED, SUGGESTION_STATUS.EDITED].includes(item.status));
      let content = session.originalResumeVersion.content;

      if (!accepted.length) {
        throw new Error("尚未采纳任何建议，无法生成新简历");
      }

      try {
        content = await llmClient.chatText({
          system: "你是简历合成器，请输出合并后的简历正文。",
          user: buildResumeRewritePrompt({
            resumeText: session.originalResumeVersion.content,
            suggestions: accepted,
            constraints: session.constraints,
          }),
        });
      } catch (error) {
        throw new Error(`新简历生成失败：${error.message}`);
      }

      if (!hasMeaningfulDiff(session.originalResumeVersion.content, content)) {
        throw new Error("模型返回的新简历与原简历没有实质差异。");
      }

      const optimized = createResumeVersion({
        id: randomUUID(),
        sessionId: session.id,
        parentVersionId: session.originalResumeVersion.id,
        kind: "optimized",
        title: `${session.originalResumeVersion.title} - 优化版`,
        content,
        format: "markdown",
      });
      optimized.acceptedSuggestionIds = accepted.filter((item) => item.status === SUGGESTION_STATUS.ACCEPTED).map((item) => item.id);
      optimized.editedSuggestionIds = accepted.filter((item) => item.status === SUGGESTION_STATUS.EDITED).map((item) => item.id);
      optimized.rejectedSuggestionIds = session.suggestions.filter((item) => item.status === SUGGESTION_STATUS.REJECTED).map((item) => item.id);
      optimized.changeSummary = accepted.map((item) => `${item.targetSection}: ${item.expectedBenefit || "已应用优化建议"}`);
      optimized.diff = createLineDiff(session.originalResumeVersion.content, content);

      session.optimizedResumeVersion = optimized;
      session.currentStep = OPTIMIZATION_STEPS.RESUME_RESCORING;
      await sessionStore.save(session);
      writeEvent?.(STREAM_EVENT.RESUME_DELTA, { sessionId: session.id, field: "content", value: content });
      writeEvent?.(STREAM_EVENT.RESUME_COMPLETED, { sessionId: session.id, optimizedResumeVersion: optimized });

      logSessionEvent(session, {
        id: randomUUID(),
        type: "optimized_resume_completed",
        step: OPTIMIZATION_STEPS.RESUME_GENERATION,
        message: "优化版简历生成完成",
      });
      await sessionStore.save(session);
      return optimized;
    });
  }

  async function loadSession(user, sessionId) {
    return sessionStore.load(user, sessionId);
  }

  return {
    createOrLoadSession,
    loadSession,
    continueLatestSession,
    analyzeJob,
    scoreResume,
    generateSuggestions,
    applySuggestionActions,
    generateOptimizedResume,
    pauseSession,
    getResumeText,
  };
}
