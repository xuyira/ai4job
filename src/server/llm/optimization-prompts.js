export function buildJobAnalysisPrompt({ job, jobMaterials }) {
  return [
    "你是简历优化工作流中的岗位分析节点。输出必须是 JSON。",
    "字段必须包含：summary, coreResponsibilities, requiredSkills, bonusSkills, keywords, experienceRequirement, structuralSignals, keyQuestions, evidence, rawText。",
    "keyQuestions 包含 coreWork, roleDifferentiators, businessDirection, idealCandidate。",
    "keyQuestions 下每个字段都必须是对象，且包含 question 和 answer。",
    "question 是最值得追问的关键问题，answer 是你仅基于岗位描述和相关资料得出的判断答案；信息不足时要明确说明不足，不能编造。",
    "evidence 是数组，每项包含 sourceType, sourceId, quote, reasoning。",
    `岗位公司：${job.company || "-"}`,
    `岗位名称：${job.position || "-"}`,
    `岗位描述：${job.jdText || "-"}`,
    `岗位相关资料：${jobMaterials.map((item) => `[${item.category}] ${item.name}\n${item.content || item.fileName || ""}`).join("\n\n") || "-"}`,
  ].join("\n");
}

export function buildResumeScorePrompt({ jobAnalysis, resumeText, personalMaterials, scoreType }) {
  return [
    "你是简历评分节点。输出必须是 JSON。",
    "字段必须包含：totalScore, rubric, deductionReasons, techBusinessFit, improvements, rawText。",
    "rubric 下包含 jobMatch, contentQuality, persuasiveness 三个对象，每个对象都带 score, breakdown, reasons。",
    `评分类型：${scoreType}`,
    `岗位分析：${JSON.stringify(jobAnalysis)}`,
    `简历文本：${resumeText || "-"}`,
    `个人相关资料：${personalMaterials.map((item) => `[${item.category}] ${item.name}\n${item.content || item.fileName || ""}`).join("\n\n") || "-"}`,
  ].join("\n");
}

export function buildSuggestionsPrompt({ jobAnalysis, resumeText, originalScore, userGoal, constraints, personalMaterials }) {
  return [
    "你是逐条简历优化建议生成节点。输出必须是 JSON。",
    "字段必须包含 suggestions，且 suggestions 为数组。",
    "每一项必须包含：suggestionKind, targetSection, targetAnchor, originalText, suggestedText, reason, expectedBenefit, riskNotice, priority。",
    "suggestionKind 只允许为 resume_edit 或 future_advice。",
    "resume_edit 表示可以直接体现在当前简历里的改写建议；future_advice 表示当前简历无法诚实补写、但值得后续补足的准备建议。",
    "future_advice 不能鼓励伪造经历，应该明确写成未来补强方向或面试准备方向。",
    "reason 必须包含 basedOnJobAnalysis, basedOnResume, basedOnMaterials, explanation。",
    "如果使用了个人相关资料，basedOnMaterials 必须写入命中的具体资料名称；若未命中则返回空数组。",
    "如存在个人相关资料，优先结合这些资料生成更贴近候选人真实经历的建议。",
    "请给出 4 到 8 条结构化建议。",
    `用户目标：${userGoal || "-"}`,
    `强调项：${(constraints.emphasize || []).join("、") || "-"}`,
    `保留项：${(constraints.preserve || []).join("、") || "-"}`,
    `岗位分析：${JSON.stringify(jobAnalysis)}`,
    `原简历评分：${JSON.stringify(originalScore)}`,
    `简历文本：${resumeText || "-"}`,
    `个人相关资料：${personalMaterials.map((item) => `[${item.category}] ${item.name}\n${item.content || item.fileName || ""}`).join("\n\n") || "-"}`,
  ].join("\n");
}

export function buildResumeRewritePrompt({ resumeText, suggestions, constraints }) {
  return [
    "你是简历合成节点。请基于原简历和已采纳建议生成新的 markdown 简历正文。",
    "不要输出解释，只输出简历正文。",
    `原简历：\n${resumeText || "-"}`,
    `已采纳建议：\n${suggestions.map((item, index) => `${index + 1}. [${item.targetSection}] ${item.suggestedText}`).join("\n") || "-"}`,
    `约束：保留 ${constraints.preserve?.join("、") || "-"}；强调 ${constraints.emphasize?.join("、") || "-"}`,
  ].join("\n");
}

export function buildSuggestionRegenerationPrompt({ suggestion, instruction, jobAnalysis }) {
  return [
    "你是建议重写节点。输出 JSON，字段包含 suggestedText, expectedBenefit, riskNotice, reason。",
    `原建议：${JSON.stringify(suggestion)}`,
    `用户反馈：${instruction || "-"}`,
    `岗位分析：${JSON.stringify(jobAnalysis)}`,
  ].join("\n");
}
