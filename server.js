import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

loadDotenv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const MAX_FETCH_CHARS = 20000;
const SUPPORTED_LINK_HOSTS = ["zhipin.com", "zhaopin.com", "iguopin.com"];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function loadDotenv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex <= 0) continue;
    const key = trimmed.slice(0, equalIndex).trim();
    const value = trimmed.slice(equalIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value.replace(/^['"]|['"]$/g, "");
    }
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(text);
}

function normalizeValue(value) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  return cleaned || "-";
}

function preserveValue(value) {
  const cleaned = String(value || "").replace(/\r\n/g, "\n").trim();
  return cleaned || "-";
}

function keepMeaningful(value) {
  const normalized = normalizeValue(value);
  return normalized === "-" ? "" : normalized;
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return normalizeValue(match[1]);
  }
  return "-";
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function htmlFragmentToText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function sectionLine(label, value) {
  const normalized = keepMeaningful(value);
  return normalized ? `${label}: ${normalized}` : "";
}

function sectionBlock(label, value) {
  const normalized = preserveValue(value);
  return normalized === "-" ? "" : `${label}:\n${normalized}`;
}

function joinSections(sections) {
  return preserveValue(
    sections
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join("\n"),
  );
}

function extractAssignedJson(html, variableName) {
  const source = String(html || "");
  const markers = [`${variableName} = `, `${variableName}=`];
  const marker = markers.find((item) => source.includes(item));
  if (!marker) return null;
  const startIndex = source.indexOf(marker);
  const afterMarker = source.slice(startIndex + marker.length);
  const endIndex = afterMarker.indexOf("</script>");
  if (endIndex < 0) return null;
  const candidate = afterMarker.slice(0, endIndex).trim().replace(/;+\s*$/, "");
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function extractFirstUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : "";
}

function hostFromUrl(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

function isSupportedLinkHost(host) {
  return SUPPORTED_LINK_HOSTS.some((item) => host.includes(item));
}

function detectCompany(text, host = "") {
  const companyPatterns = [
    /公司(?:名称)?[：:\s]+([^\n，。,；;|]+)/i,
    /企业[：:\s]+([^\n，。,；;|]+)/i,
    /招聘单位[：:\s]+([^\n，。,；;|]+)/i,
  ];
  const byPattern = firstMatch(text, companyPatterns);
  if (byPattern !== "-") return byPattern;

        const companyMap = [
          ["zhaopin.com", "智联招聘"],
          ["zhipin.com", "Boss直聘"],
          ["iguopin.com", "国聘"],
          ["join.qq.com", "腾讯"],
          ["careers.tencent.com", "腾讯"],
    ["bytedance", "字节跳动"],
    ["xiaohongshu", "小红书"],
    ["alibaba", "阿里巴巴"],
    ["aliyun", "阿里云"],
    ["meituan", "美团"],
    ["baidu", "百度"],
    ["jd.com", "京东"],
    ["zhipin", "Boss直聘"],
    ["lagou", "拉勾"],
    ["liepin", "猎聘"],
  ];
  const hostHit = companyMap.find(([key]) => host.includes(key) || text.toLowerCase().includes(key));
  if (hostHit) return hostHit[1];

  const cnMap = ["腾讯", "字节跳动", "小红书", "阿里巴巴", "美团", "百度", "京东", "滴滴", "快手", "网易", "米哈游"];
  const cnHit = cnMap.find((item) => text.includes(item));
  return cnHit || "-";
}

function detectPosition(text) {
  const patterns = [
    /职位[：:\s]+([^\n]+?)(?:\s{2,}|$)/i,
    /岗位[：:\s]+([^\n]+?)(?:\s{2,}|$)/i,
    /招聘岗位[：:\s]+([^\n]+?)(?:\s{2,}|$)/i,
    /岗位名称[：:\s]+([^\n]+?)(?:\s{2,}|$)/i,
    /Job Title[：:\s]+([^\n]+?)(?:\s{2,}|$)/i,
  ];
  const byPattern = firstMatch(text, patterns);
  if (byPattern !== "-") return byPattern;

  const titleLine = text
    .split(/[\n。]/)
    .map((line) => line.trim())
    .find((line) => /((工程师|经理|分析师|实习生|培训生|运营|产品|设计|开发|算法|研究员|顾问))/.test(line) && line.length <= 60);
  return titleLine ? normalizeValue(titleLine) : "-";
}

function detectLocation(text) {
  const patterns = [
    /地点[：:\s]+([^\n，。,；;|]+)/i,
    /工作地点[：:\s]+([^\n，。,；;|]+)/i,
    /城市[：:\s]+([^\n，。,；;|]+)/i,
    /Base[：:\s]+([^\n，。,；;|]+)/i,
  ];
  const byPattern = firstMatch(text, patterns);
  if (byPattern !== "-") return byPattern;

  const cities = ["北京", "上海", "杭州", "深圳", "广州", "成都", "南京", "武汉", "苏州", "西安", "Remote", "远程"];
  const hit = cities.find((item) => text.includes(item));
  return hit || "-";
}

function detectSourceChannel(rawInput, host = "") {
  if (/^https?:\/\//i.test(rawInput)) {
    const hostMap = [
      ["zhaopin.com", "智联招聘"],
      ["zhipin.com", "Boss直聘"],
      ["iguopin.com", "国聘"],
      ["join.qq.com", "官网"],
      ["careers.tencent.com", "官网"],
      ["lagou.com", "拉勾"],
      ["liepin.com", "猎聘"],
      ["jobs.bytedance.com", "官网"],
      ["talent.alibaba.com", "官网"],
      ["jobs.jd.com", "官网"],
    ];
    const hit = hostMap.find(([key]) => host.includes(key));
    return hit ? hit[1] : "-";
  }

  const textMap = [
    [/boss|boss直聘/i, "Boss直聘"],
    [/智联|zhaopin/i, "智联招聘"],
    [/国聘|iguopin/i, "国聘"],
    [/拉勾/i, "拉勾"],
    [/猎聘/i, "猎聘"],
    [/官网/i, "官网"],
    [/内推/i, "内推"],
  ];
  const hit = textMap.find(([pattern]) => pattern.test(rawInput));
  return hit ? hit[1] : "-";
}

function detectJDText(rawInput, sourceText, isLink) {
  if (!isLink) return normalizeValue(rawInput);
  const cleaned = normalizeValue(sourceText);
  if (cleaned !== "-") return cleaned.slice(0, MAX_FETCH_CHARS);
  return "-";
}

function heuristicParse({ rawInput, sourceText, host }) {
  return {
    company: detectCompany(sourceText, host),
    position: detectPosition(sourceText),
    location: detectLocation(sourceText),
    sourceChannel: detectSourceChannel(rawInput, host),
    jdText: detectJDText(rawInput, sourceText, /^https?:\/\//i.test(rawInput)),
  };
}

async function fetchPageContent(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`抓取失败: HTTP ${response.status}`);
  }

  const html = await response.text();
  return {
    finalUrl: response.url,
    html,
    text: stripHtml(html).slice(0, MAX_FETCH_CHARS),
  };
}

async function fetchPageContentWithCurl(url) {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-sL",
      "--max-redirs",
      "5",
      "--user-agent",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
      "--header",
      "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "--header",
      "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
      url,
    ],
    {
      maxBuffer: 5 * 1024 * 1024,
    },
  );

  return {
    finalUrl: url,
    html: stdout,
    text: stripHtml(stdout).slice(0, MAX_FETCH_CHARS),
  };
}

async function fetchTencentJoinDetail(url) {
  const parsedUrl = new URL(url);
  const postId = parsedUrl.searchParams.get("postid") || parsedUrl.searchParams.get("postId");
  if (!postId) return null;

  const apiUrl = `https://join.qq.com/api/v1/jobDetails/getJobDetailsByPostId?timestamp=${Date.now()}&postId=${encodeURIComponent(postId)}`;
  const response = await fetch(apiUrl, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Referer: url,
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`腾讯岗位接口失败: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const detail = payload?.data;
  if (!detail) {
    throw new Error("腾讯岗位接口未返回 data");
  }

  const structuredText = [
    `公司: 腾讯`,
    `职位: ${detail.title || "-"}`,
    `职位类别: ${detail.tidName || "-"}`,
    `招聘地点: ${Array.isArray(detail.recruitCityList) && detail.recruitCityList.length ? detail.recruitCityList.join("、") : "-"}`,
    `工作地点: ${Array.isArray(detail.workCityList) && detail.workCityList.length ? detail.workCityList.join("、") : "-"}`,
    `岗位描述:\n${detail.desc || "-"}`,
    `任职要求:\n${detail.request || "-"}`,
  ].join("\n");

  return {
    finalUrl: url,
    text: structuredText.slice(0, MAX_FETCH_CHARS),
    structured: {
      company: "腾讯",
      position: normalizeValue(detail.title),
      location:
        Array.isArray(detail.recruitCityList) && detail.recruitCityList.length
          ? normalizeValue(detail.recruitCityList.join("、"))
          : Array.isArray(detail.workCityList) && detail.workCityList.length
            ? normalizeValue(detail.workCityList.join("、"))
            : "-",
      sourceChannel: "官网",
      jdText: preserveValue(structuredText),
    },
  };
}

async function fetchZhilianDetail(url) {
  let page = await fetchPageContentWithCurl(url);
  let initialData = extractAssignedJson(page.html, "window.__INITIAL_DATA__");
  if (!initialData) {
    page = await fetchPageContent(url);
    initialData = extractAssignedJson(page.html, "window.__INITIAL_DATA__");
  }
  const main = initialData?.main;
  const position = main?.positionDetail;
  const campus = main?.campusJobDetail;
  const company = main?.companyDetail;

  if (!position) {
    throw new Error("智联页面未找到岗位详情数据");
  }

  const companyName = normalizeValue(campus?.companyName || company?.companyName || company?.displayOrgName);
  const positionName = normalizeValue(position.positionName);
  const location = normalizeValue(
    [position.positionWorkCity, position.positionCityDistrict, position.streetName].filter(Boolean).join("·")
      || position.workAddress
      || campus?.cityName,
  );
  const addressText = [
    keepMeaningful(position.workAddress),
    ...(Array.isArray(position.multiAddresses)
      ? position.multiAddresses.map((item) => keepMeaningful(item.jobAddress || item.poiName)).filter(Boolean)
      : []),
  ]
    .filter((item, index, list) => list.indexOf(item) === index)
    .filter(Boolean)
    .join("；");
  const structuredText = joinSections([
    sectionLine("公司", companyName),
    sectionLine("职位", positionName),
    sectionLine("薪资", position.salary60),
    sectionLine("城市", position.positionWorkCity || campus?.cityName),
    sectionLine("地点", location),
    sectionLine("经验要求", position.positionWorkingExp),
    sectionLine("学历要求", position.education),
    sectionLine("职位类别", position.jobTypeLevelName),
    sectionLine("细分类别", position.subJobTypeLevelName),
    sectionLine("优选专业", Array.isArray(position.needMajor) ? position.needMajor.join("、") : ""),
    sectionLine("技能标签", Array.isArray(position.skillTags) ? position.skillTags.join("、") : ""),
    sectionBlock("职位详情", htmlFragmentToText(position.jobDesc || position.jobDescHighlight)),
    sectionBlock("工作地点", addressText),
    sectionLine("企业性质", company?.property || campus?.orgTypeName),
    sectionLine("所属行业", company?.industryName || campus?.industryName),
    sectionLine("企业规模", company?.companySize || campus?.orgSizeName),
    sectionBlock("公司简介", htmlFragmentToText(company?.companyDescription)),
  ]);

  return {
    finalUrl: page.finalUrl,
    text: structuredText.slice(0, MAX_FETCH_CHARS),
    structured: {
      company: companyName,
      position: positionName,
      location,
      sourceChannel: "智联招聘",
      jdText: structuredText,
    },
  };
}

async function fetchGuopinCompanyIntro(companyId) {
  if (!companyId) return null;

  const response = await fetch("https://gp-api.iguopin.com/api/company/index/v1/info", {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
    },
    body: JSON.stringify({ id: [companyId] }),
  });

  if (!response.ok) return null;
  const payload = await response.json();
  return Array.isArray(payload?.data) ? payload.data[0] || null : null;
}

async function fetchGuopinDetail(url) {
  const parsedUrl = new URL(url);
  const jobId = parsedUrl.searchParams.get("id") || parsedUrl.pathname.split("/").filter(Boolean).pop();
  if (!jobId) {
    throw new Error("国聘链接缺少职位 id");
  }

  const response = await fetch(`https://gp-api.iguopin.com/api/jobs/v1/info?id=${encodeURIComponent(jobId)}`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Referer: url,
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`国聘岗位接口失败: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const detail = payload?.data;
  if (!detail) {
    throw new Error("国聘岗位接口未返回 data");
  }

  const companyProfile = (await fetchGuopinCompanyIntro(detail.company_id)) || detail.company_info || {};
  const location = normalizeValue(
    Array.isArray(detail.district_list) && detail.district_list.length
      ? detail.district_list.map((item) => item.area_cn || item.address).filter(Boolean).join("、")
      : companyProfile.area_cn || companyProfile.address,
  );
  const addressText =
    Array.isArray(detail.district_list) && detail.district_list.length
      ? detail.district_list.map((item) => [item.area_cn, item.address].filter(Boolean).join(" ")).join("\n")
      : "";
  const structuredText = joinSections([
    sectionLine("公司", detail.company_name),
    sectionLine("职位", detail.job_name),
    sectionLine("招聘类型", detail.recruitment_type_cn),
    sectionLine("职位性质", detail.nature_cn),
    sectionLine("职位类别", detail.category_cn),
    sectionLine("学历要求", detail.education_cn),
    sectionLine("经验要求", detail.experience_cn),
    sectionLine("专业要求", Array.isArray(detail.major_cn) ? detail.major_cn.join("、") : ""),
    sectionLine("所属行业", Array.isArray(detail.industry_cn) ? detail.industry_cn.join("、") : companyProfile.industry_cn),
    sectionLine("招聘地点", location),
    sectionBlock("详细地址", addressText),
    sectionLine("发布时间", detail.start_time),
    sectionLine("截止时间", detail.end_time),
    sectionBlock("岗位内容", detail.contents),
    sectionLine("企业性质", companyProfile.nature_cn),
    sectionLine("企业规模", companyProfile.scale_cn),
    sectionLine("企业网址", companyProfile.website),
    sectionBlock("公司介绍", companyProfile.introduction),
  ]);

  return {
    finalUrl: url,
    text: structuredText.slice(0, MAX_FETCH_CHARS),
    structured: {
      company: normalizeValue(detail.company_name),
      position: normalizeValue(detail.job_name),
      location,
      sourceChannel: "国聘",
      jdText: structuredText,
    },
  };
}

async function fetchBossDetail(url) {
  const page = await fetchPageContent(url);
  if (
    page.finalUrl.includes("security-check") ||
    page.html.includes("securityPageName=\"securityCheck\"") ||
    page.html.includes("__zp_stoken__")
  ) {
    throw new Error("Boss直聘链接触发安全校验，当前本地解析器无法直接抓取岗位正文，请改为粘贴岗位文本。");
  }

  const cleaned = stripHtml(page.html);
  const structured = heuristicParse({ rawInput: url, sourceText: cleaned, host: hostFromUrl(page.finalUrl) });
  return {
    finalUrl: page.finalUrl,
    text: cleaned.slice(0, MAX_FETCH_CHARS),
    structured: {
      ...structured,
      sourceChannel: "Boss直聘",
      jdText: preserveValue(cleaned.slice(0, MAX_FETCH_CHARS)),
    },
  };
}

async function extractWithOpenAI({ rawInput, fetchedText, host }) {
  if (!OPENAI_API_KEY) return null;

  const prompt = [
    "你是岗位解析器。请从输入内容中提取岗位信息，并且只返回 JSON。",
    "字段必须包含：company, position, location, sourceChannel, jdText。",
    "如果识别不出来，值必须是 '-'，不要编造。",
    "sourceChannel 只允许输出：官网、Boss直聘、拉勾、猎聘、内推、-。",
    `原始输入: ${rawInput}`,
    `域名: ${host || "-"}`,
    `网页正文: ${fetchedText || "-"}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "你是一个严谨的岗位信息抽取器，只能从给定内容中抽取，不得补造信息。",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI 调用失败: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);
  return {
    company: normalizeValue(parsed.company),
    position: normalizeValue(parsed.position),
    location: normalizeValue(parsed.location),
    sourceChannel: ["官网", "Boss直聘", "智联招聘", "国聘", "拉勾", "猎聘", "内推"].includes(parsed.sourceChannel) ? parsed.sourceChannel : "-",
    jdText: preserveValue(parsed.jdText),
  };
}

async function parseJobInput(rawInput) {
  const embeddedUrl = extractFirstUrl(rawInput);
  const rawTrimmed = String(rawInput || "").trim();
  const isPureLink = /^https?:\/\/[^\s]+$/i.test(rawTrimmed);
  const isLink = Boolean(embeddedUrl) && isPureLink;
  const linkUrl = embeddedUrl || "";
  let host = "";
  let fetched = null;
  let structuredResult = null;

  if (isPureLink && linkUrl) {
    host = hostFromUrl(linkUrl);
    if (!isSupportedLinkHost(host)) {
      throw new Error("当前仅支持智联招聘、Boss直聘、国聘链接，其他网站请粘贴岗位文本。");
    }
  }

  if (isLink) {
    try {
      host = hostFromUrl(linkUrl);
      if (host.includes("zhaopin.com")) {
        fetched = await fetchZhilianDetail(linkUrl);
        structuredResult = fetched?.structured || null;
      } else if (host.includes("iguopin.com")) {
        fetched = await fetchGuopinDetail(linkUrl);
        structuredResult = fetched?.structured || null;
      } else if (host.includes("zhipin.com")) {
        fetched = await fetchBossDetail(linkUrl);
        structuredResult = fetched?.structured || null;
      } else if (host.includes("join.qq.com")) {
        fetched = await fetchTencentJoinDetail(linkUrl);
        structuredResult = fetched?.structured || null;
      }
      if (!fetched) {
        fetched = await fetchPageContent(linkUrl);
      }
      host = new URL(fetched.finalUrl).host.toLowerCase();
    } catch (error) {
      const fallback = heuristicParse({ rawInput, sourceText: rawInput, host });
      fallback.jdText = "-";
      return {
        ...fallback,
        jdLink: linkUrl || "-",
        applyLink: linkUrl || "-",
        parser: "heuristic",
        fetchStatus: error.message,
      };
    }
  }

  if (!isLink && linkUrl) {
    host = hostFromUrl(linkUrl);
    if (isSupportedLinkHost(host)) {
      try {
        fetched = await fetchPageContent(linkUrl);
      } catch {
        fetched = null;
      }
    }
  }

  const sourceText = isLink ? fetched?.text || "-" : rawInput;
  const heuristic = structuredResult || heuristicParse({ rawInput, sourceText, host });

  if (!isLink && linkUrl && fetched?.text) {
    if (heuristic.company === "-") heuristic.company = detectCompany(fetched.text, host);
    if (heuristic.position === "-") heuristic.position = detectPosition(fetched.text);
    if (heuristic.location === "-") heuristic.location = detectLocation(fetched.text);
    if (heuristic.sourceChannel === "-") heuristic.sourceChannel = detectSourceChannel(linkUrl, host);
  }

  try {
    const llmResult = await extractWithOpenAI({
      rawInput,
      fetchedText: isLink ? sourceText : fetched?.text || sourceText,
      host,
    });
    return {
      ...(llmResult || heuristic),
      jdLink: linkUrl || "-",
      applyLink: linkUrl || "-",
      jdText: structuredResult?.jdText || heuristic.jdText || llmResult?.jdText || "-",
      parser: llmResult ? "openai" : structuredResult ? "site_adapter" : "heuristic",
      fetchStatus: isLink ? "ok" : fetched ? "embedded_link_detected" : "not_needed",
    };
  } catch (error) {
    return {
      ...heuristic,
      jdLink: linkUrl || "-",
      applyLink: linkUrl || "-",
      parser: structuredResult ? "site_adapter" : "heuristic",
      fetchStatus: isLink ? `ok_llm_failed:${error.message}` : fetched ? `embedded_link_detected_llm_failed:${error.message}` : "not_needed",
    };
  }
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function handleApi(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      openaiConfigured: Boolean(OPENAI_API_KEY),
      model: OPENAI_API_KEY ? OPENAI_MODEL : "-",
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/parse-job") {
    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body || "{}");
      const input = String(payload.input || "").trim();
      if (!input) {
        sendJson(res, 400, { error: "缺少 input" });
        return;
      }

      const result = await parseJobInput(input);
      sendJson(res, 200, { ok: true, result });
      return;
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || "解析失败" });
      return;
    }
  }

  sendJson(res, 404, { error: "Not found" });
}

async function handleStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.join(__dirname, pathname);

  try {
    const file = await readFile(filePath);
    const ext = path.extname(filePath);
    sendText(res, 200, file, MIME_TYPES[ext] || "application/octet-stream");
  } catch (error) {
    sendText(res, 404, "Not found");
  }
}

const server = createServer(async (req, res) => {
  if (!req.url) {
    sendText(res, 400, "Bad request");
    return;
  }

  if (req.url.startsWith("/api/")) {
    await handleApi(req, res);
    return;
  }

  await handleStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`AI4JOB server running at http://${HOST}:${PORT}`);
});
