export const OPTIMIZATION_STEPS = {
  JOB_ANALYSIS: "job_analysis",
  RESUME_SCORING: "resume_scoring",
  SUGGESTION_GENERATION: "suggestion_generation",
  FEEDBACK_REVIEW: "feedback_review",
  RESUME_GENERATION: "resume_generation",
  RESUME_RESCORING: "resume_rescoring",
};

export const SESSION_STATUS = {
  DRAFT: "draft",
  IN_PROGRESS: "in_progress",
  WAITING_FEEDBACK: "waiting_feedback",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
};

export const STEP_RESULT_STATUS = {
  PENDING: "pending",
  STREAMING: "streaming",
  COMPLETED: "completed",
  FAILED: "failed",
};

export const SUGGESTION_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  EDITED: "edited",
  REGENERATING: "regenerating",
  APPLIED: "applied",
};

export const SCORE_TYPE = {
  ORIGINAL: "original",
  OPTIMIZED: "optimized",
};

export const STREAM_EVENT = {
  SESSION: "session",
  JOB_ANALYSIS_DELTA: "job_analysis_delta",
  JOB_ANALYSIS_COMPLETED: "job_analysis_completed",
  SCORE_DELTA: "score_delta",
  SCORE_COMPLETED: "score_completed",
  SUGGESTION_DELTA: "suggestion_delta",
  SUGGESTIONS_COMPLETED: "suggestions_completed",
  RESUME_DELTA: "resume_delta",
  RESUME_COMPLETED: "resume_completed",
  ERROR: "error",
  DONE: "done",
};
