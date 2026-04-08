import {
  OPTIMIZATION_STEPS,
  SCORE_TYPE,
  SESSION_STATUS,
  STEP_RESULT_STATUS,
  SUGGESTION_STATUS,
} from "./optimization-constants.js";

function nowIso() {
  return new Date().toISOString();
}

function createEmptyKeyQuestionItem() {
  return {
    question: "",
    answer: "",
  };
}

export function createEmptyJobAnalysis({ id, sessionId, jobId }) {
  const now = nowIso();
  return {
    id,
    sessionId,
    jobId,
    version: 1,
    status: STEP_RESULT_STATUS.PENDING,
    summary: "",
    coreResponsibilities: [],
    requiredSkills: [],
    bonusSkills: [],
    keywords: [],
    experienceRequirement: "",
    structuralSignals: [],
    keyQuestions: {
      coreWork: createEmptyKeyQuestionItem(),
      roleDifferentiators: createEmptyKeyQuestionItem(),
      businessDirection: createEmptyKeyQuestionItem(),
      idealCandidate: createEmptyKeyQuestionItem(),
    },
    evidence: [],
    rawText: "",
    createdAt: now,
    updatedAt: now,
  };
}

export function createEmptyResumeScore({ id, sessionId, resumeVersionId, scoreType }) {
  const now = nowIso();
  return {
    id,
    sessionId,
    resumeVersionId,
    scoreType,
    status: STEP_RESULT_STATUS.PENDING,
    totalScore: 0,
    rubric: {
      jobMatch: {
        weight: 40,
        score: 0,
        breakdown: {
          jdAlignment: 0,
          keywordCoverage: 0,
          experienceRelevance: 0,
        },
        reasons: [],
      },
      contentQuality: {
        weight: 30,
        score: 0,
        breakdown: {
          clarity: 0,
          structure: 0,
          completeness: 0,
          professionalism: 0,
        },
        reasons: [],
      },
      persuasiveness: {
        weight: 30,
        score: 0,
        breakdown: {
          quantifiedImpact: 0,
          projectStrength: 0,
          differentiation: 0,
        },
        reasons: [],
      },
      },
    deductionReasons: [],
    techBusinessFit: {
      canApply: false,
      conclusion: "",
      priorities: [],
    },
    improvements: {
      improvedDimensions: [],
      remainingIssues: [],
    },
    rawText: "",
    createdAt: now,
    updatedAt: now,
  };
}

export function createResumeVersion({ id, sessionId, sourceMaterialId, parentVersionId, kind, title, content, format = "markdown" }) {
  const now = nowIso();
  return {
    id,
    sessionId: sessionId || "",
    sourceMaterialId: sourceMaterialId || "",
    parentVersionId: parentVersionId || "",
    kind,
    title,
    content: content || "",
    format,
    acceptedSuggestionIds: [],
    rejectedSuggestionIds: [],
    editedSuggestionIds: [],
    changeSummary: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createSuggestionItem({ id, sessionId, targetSection = "", targetAnchor = "", originalText = "" }) {
  const now = nowIso();
  return {
    id,
    sessionId,
    targetSection,
    targetAnchor,
    originalText,
    suggestedText: "",
    reason: {
      basedOnJobAnalysis: [],
      basedOnResume: [],
      basedOnMaterials: [],
      explanation: "",
    },
    expectedBenefit: "",
    riskNotice: "",
    priority: "medium",
    status: SUGGESTION_STATUS.PENDING,
    diffPreview: {
      before: originalText,
      after: "",
    },
    regeneratedCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function createSuggestionFeedback({ id, sessionId, suggestionId, action, editedText = "", comment = "", userInstruction = "" }) {
  return {
    id,
    sessionId,
    suggestionId,
    action,
    editedText,
    comment,
    userInstruction,
    createdAt: nowIso(),
  };
}

export function createOptimizationSession({ id, user, jobId, selectedResumeId, originalResumeVersion, userGoal = "", constraints = {} }) {
  const now = nowIso();
  return {
    id,
    user,
    jobId,
    selectedResumeId,
    status: SESSION_STATUS.DRAFT,
    currentStep: OPTIMIZATION_STEPS.JOB_ANALYSIS,
    stepStatus: {
      jobAnalysis: STEP_RESULT_STATUS.PENDING,
      originalScore: STEP_RESULT_STATUS.PENDING,
      suggestions: STEP_RESULT_STATUS.PENDING,
      feedback: STEP_RESULT_STATUS.PENDING,
      optimizedResume: STEP_RESULT_STATUS.PENDING,
      rescoring: STEP_RESULT_STATUS.PENDING,
    },
    userGoal,
    constraints: {
      emphasize: Array.isArray(constraints.emphasize) ? constraints.emphasize : [],
      preserve: Array.isArray(constraints.preserve) ? constraints.preserve : [],
    },
    jobAnalysis: undefined,
    originalResumeVersion,
    optimizedResumeVersion: undefined,
    originalScore: undefined,
    optimizedScore: undefined,
    suggestions: [],
    feedbackHistory: [],
    eventLog: [],
    lastError: undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export function touchEntity(entity) {
  entity.updatedAt = nowIso();
  return entity;
}

export function logSessionEvent(session, { id, type, step, message, meta }) {
  session.eventLog.push({
    id,
    type,
    step,
    message,
    createdAt: nowIso(),
    meta: meta || {},
  });
  session.updatedAt = nowIso();
}

export function markSessionError(session, { step, message, retryable = true }) {
  session.status = SESSION_STATUS.FAILED;
  session.lastError = {
    step,
    message,
    retryable,
    at: nowIso(),
  };
  session.updatedAt = nowIso();
}

export function isIncompleteSession(session) {
  return session && session.status !== SESSION_STATUS.COMPLETED;
}

export function normalizeScoreType(scoreType) {
  return scoreType === SCORE_TYPE.OPTIMIZED ? SCORE_TYPE.OPTIMIZED : SCORE_TYPE.ORIGINAL;
}
