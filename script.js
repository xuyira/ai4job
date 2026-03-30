const state = {
  jobs: [
    {
      id: "jd-001",
      company: "字节跳动",
      role: "后端开发实习生",
      city: "北京",
      type: "实习",
      status: "待投递",
      optimized: true,
      applied: false,
      interviewInvite: false,
      scoreBefore: 67,
      scoreAfter: 82,
      traits: ["工程能力", "接口设计", "稳定性", "业务理解", "协作沟通"],
    },
    {
      id: "jd-002",
      company: "美团",
      role: "数据分析师",
      city: "上海",
      type: "正职",
      status: "面试中",
      optimized: true,
      applied: true,
      interviewInvite: true,
      scoreBefore: 61,
      scoreAfter: 79,
      traits: ["SQL能力", "数据洞察", "实验设计", "业务沟通", "落地推动"],
    },
    {
      id: "jd-003",
      company: "小红书",
      role: "产品运营",
      city: "上海",
      type: "实习",
      status: "待优化",
      optimized: false,
      applied: false,
      interviewInvite: false,
      scoreBefore: 58,
      scoreAfter: 58,
      traits: ["内容敏感度", "增长方法", "用户洞察", "复盘能力", "跨团队协作"],
    },
  ],
  activeJobId: "jd-001",
  activeRound: "一面",
  askedQuestions: new Set(),
};

const questionPool = {
  一面: [
    "请用 STAR 结构介绍一个你推动结果落地的项目。",
    "这个项目里最难的技术问题是什么？你怎么拆解？",
    "如果线上接口 P99 延迟突然升高，你会如何排查？",
  ],
  二面: [
    "你如何权衡系统可用性和研发迭代速度？",
    "请复盘一个你做过但结果不理想的方案，重点说判断失误点。",
    "如果让你重构当前项目架构，你会先做哪三件事？",
  ],
  HR面: [
    "为什么选择我们公司和这个岗位？",
    "你过去一次团队冲突是如何处理的？",
    "如果短期没有拿到 offer，你会如何调整节奏？",
  ],
};

const suggestions = [
  {
    raw: "负责后端接口开发。",
    rewritten: "主导 3 个核心接口重构，将平均响应时间从 320ms 降至 180ms，支撑日均 10w+ 请求。",
    evidence: "JD 要求：高并发接口优化；材料：项目 A 性能压测记录。",
    trait: "工程能力",
  },
  {
    raw: "参与数据分析工作。",
    rewritten: "搭建用户分层看板并输出 4 条可执行增长策略，推动活动转化率提升 12%。",
    evidence: "JD 要求：数据驱动增长；材料：运营周报第 12 周。",
    trait: "业务理解",
  },
  {
    raw: "与同学一起完成项目。",
    rewritten: "跨 4 人团队协同推进项目里程碑，建立每周风险清单，按时完成交付。",
    evidence: "JD 要求：跨团队协作；材料：项目复盘文档。",
    trait: "协作沟通",
  },
];

function qs(selector) {
  return document.querySelector(selector);
}

function qsa(selector) {
  return [...document.querySelectorAll(selector)];
}

function getActiveJob() {
  return state.jobs.find((job) => job.id === state.activeJobId) || state.jobs[0];
}

function renderMetrics() {
  const total = state.jobs.length;
  const applied = state.jobs.filter((j) => j.applied).length;
  const invited = state.jobs.filter((j) => j.interviewInvite).length;
  const optimized = state.jobs.filter((j) => j.optimized).length;

  qs("#metricApplications").textContent = String(applied);
  qs("#metricInterviewRate").textContent = total ? `${Math.round((invited / total) * 100)}%` : "0%";
  qs("#metricOptimizationRate").textContent = total ? `${Math.round((optimized / total) * 100)}%` : "0%";
}

function renderJobList() {
  const list = qs("#jobList");
  list.innerHTML = "";
  state.jobs.forEach((job) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${job.company} - ${job.role}</strong><br><span class="muted">${job.city}｜${job.type}｜${job.status}</span>`;
    li.style.cursor = "pointer";
    li.onclick = () => {
      state.activeJobId = job.id;
      renderResumeModule();
    };
    list.appendChild(li);
  });
}

function renderTodo() {
  const todos = [
    "完成 1 个 JD 的简历优化会话",
    "完成一面模拟并查看复盘",
    "更新 2 条投递状态",
  ];
  const list = qs("#todoList");
  list.innerHTML = todos.map((t) => `<li>${t}</li>`).join("");
}

function renderResumeModule() {
  const job = getActiveJob();
  qs("#traits").innerHTML = job.traits.map((t) => `<span class="chip">${t}</span>`).join("");
  qs("#scoreBefore").textContent = String(job.scoreBefore);
  qs("#scoreAfter").textContent = String(job.scoreAfter);
  qs("#scoreDelta").textContent = `+${job.scoreAfter - job.scoreBefore}`;

  const container = qs("#suggestions");
  container.innerHTML = "";
  suggestions.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div><strong>原句：</strong>${item.raw}</div>
      <div><strong>建议：</strong>${item.rewritten}</div>
      <div class="muted"><strong>证据：</strong>${item.evidence}</div>
      <div class="muted"><strong>目的：</strong>匹配核心特质「${item.trait}」</div>
      <div class="suggestion-actions">
        <button class="mini-btn" data-action="accept">接受</button>
        <button class="mini-btn" data-action="reject">拒绝</button>
      </div>
    `;
    li.querySelectorAll(".mini-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        li.querySelectorAll(".mini-btn").forEach((x) => x.classList.remove("accepted", "rejected"));
        if (btn.dataset.action === "accept") btn.classList.add("accepted");
        if (btn.dataset.action === "reject") btn.classList.add("rejected");
      });
    });
    container.appendChild(li);
  });
}

function renderKanban() {
  const columns = ["待优化", "待投递", "面试中", "已结束"];
  const board = qs("#kanbanBoard");
  board.innerHTML = columns
    .map((col) => {
      const cards = state.jobs
        .filter((j) => j.status === col)
        .map(
          (j) => `
            <div class="kanban-card">
              <strong>${j.company}</strong><br>
              ${j.role}<br>
              <span class="muted">优化 ${j.scoreBefore} -> ${j.scoreAfter}</span>
            </div>
          `
        )
        .join("");
      return `<div class="kanban-col"><h4>${col}</h4>${cards || "<p class='muted'>暂无</p>"}</div>`;
    })
    .join("");
}

function initTabs() {
  qsa(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      qsa(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      qsa(".panel").forEach((p) => p.classList.remove("active"));
      qs(`#${tab.dataset.target}`).classList.add("active");
    });
  });
}

function initInterview() {
  qsa(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      qsa(".seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.activeRound = btn.dataset.round;
    });
  });

  qs("#genQuestionBtn").addEventListener("click", () => {
    const pool = questionPool[state.activeRound];
    const available = pool.filter((q) => !state.askedQuestions.has(`${state.activeRound}-${q}`));
    const question = available[0] || pool[Math.floor(Math.random() * pool.length)];
    state.askedQuestions.add(`${state.activeRound}-${question}`);
    qs("#questionText").textContent = question;
  });

  qs("#reviewBtn").addEventListener("click", () => {
    const answer = qs("#answerInput").value.trim();
    const box = qs("#reviewBox");
    if (!answer) {
      box.innerHTML = "<p class='muted'>请先输入你的回答，再生成复盘。</p>";
      return;
    }

    const hasNumber = /\d/.test(answer);
    const hasStructure = /首先|然后|最后|第一|第二/.test(answer);
    const score = Math.min(100, 60 + (hasNumber ? 20 : 0) + (hasStructure ? 20 : 0));
    box.innerHTML = `
      <p><strong>题级评分：</strong>${score} / 100</p>
      <p><strong>考察点：</strong>结构化表达、结果量化、业务相关性</p>
      <p><strong>建议：</strong>${hasStructure ? "结构清晰，继续强化细节。" : "建议按 STAR 或“背景-动作-结果”组织表达。"}
      ${hasNumber ? "已包含量化结果。" : "建议补充至少 1 个量化结果提升说服力。"}
      </p>
    `;
  });
}

function initNewJobDialog() {
  const dialog = qs("#newJobDialog");
  qs("#newJobBtn").addEventListener("click", () => dialog.showModal());

  qs("#newJobForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const job = {
      id: `jd-${Date.now()}`,
      company: formData.get("company"),
      role: formData.get("role"),
      city: formData.get("city"),
      type: formData.get("type"),
      status: "待优化",
      optimized: false,
      applied: false,
      interviewInvite: false,
      scoreBefore: 55,
      scoreAfter: 55,
      traits: ["待解析", "待解析", "待解析", "待解析", "待解析"],
    };
    state.jobs.unshift(job);
    state.activeJobId = job.id;
    renderAll();
    dialog.close();
  });
}

function renderAll() {
  renderMetrics();
  renderJobList();
  renderTodo();
  renderResumeModule();
  renderKanban();
}

function init() {
  initTabs();
  initInterview();
  initNewJobDialog();
  renderAll();
}

init();
