import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createOpenAIClient } from "./src/server/llm/openai-client.js";
import { createOptimizationSessionStore } from "./src/server/services/optimization-session-store.js";
import { createOptimizationService } from "./src/server/services/optimization-service.js";
import { endSse, sendSseHeaders, writeSseEvent } from "./src/server/utils/http.js";
import { logger } from "./src/server/utils/logger.js";
import { SCORE_TYPE, STREAM_EVENT } from "./src/shared/optimization-constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

loadDotenv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const MAX_FETCH_CHARS = 20000;
const SUPPORTED_LINK_HOSTS = ["zhipin.com", "zhaopin.com", "iguopin.com"];
const MATERIALS_ROOT = path.join(__dirname, "storage");
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".txt", ".md",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg",
  ".ppt", ".pptx",
]);
const PPT_EXTENSIONS = new Set([".ppt", ".pptx"]);
const openAIClient = createOpenAIClient({
  apiKey: OPENAI_API_KEY,
  model: OPENAI_MODEL,
  baseUrl: OPENAI_BASE_URL,
});
const optimizationSessionStore = createOptimizationSessionStore({
  storageRoot: MATERIALS_ROOT,
});
const optimizationService = createOptimizationService({
  storageRoot: MATERIALS_ROOT,
  sessionStore: optimizationSessionStore,
  llmClient: openAIClient,
});

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
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

function sendBinary(res, statusCode, buffer, contentType, disposition = "inline") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(buffer),
    "Content-Disposition": disposition,
  });
  res.end(buffer);
}

function normalizeValue(value) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  return cleaned || "-";
}

function preserveValue(value) {
  const cleaned = String(value || "").replace(/\r\n/g, "\n").trim();
  return cleaned || "-";
}

function nullableValue(value) {
  const cleaned = String(value || "").trim();
  return cleaned;
}

function safeSegment(value) {
  return encodeURIComponent(String(value || "").trim() || "unknown").replace(/%/g, "_");
}

function materialsDirFor(user, jobId) {
  return path.join(MATERIALS_ROOT, safeSegment(user), safeSegment(jobId));
}

function materialFilesDirFor(user, jobId) {
  return path.join(materialsDirFor(user, jobId), "files");
}

function materialsManifestPath(user, jobId) {
  return path.join(materialsDirFor(user, jobId), "manifest.json");
}

async function ensureMaterialsDir(user, jobId) {
  await fs.promises.mkdir(materialFilesDirFor(user, jobId), { recursive: true });
}

async function readMaterialsManifest(user, jobId) {
  try {
    const content = await fs.promises.readFile(materialsManifestPath(user, jobId), "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.materials) ? parsed : { materials: [] };
  } catch {
    return { materials: [] };
  }
}

async function writeMaterialsManifest(user, jobId, manifest) {
  await ensureMaterialsDir(user, jobId);
  await fs.promises.writeFile(
    materialsManifestPath(user, jobId),
    JSON.stringify({ materials: manifest.materials || [] }, null, 2),
    "utf8",
  );
}

function serializeMaterial(material) {
  return {
    id: material.id,
    name: material.name,
    category: material.category || "其他",
    type: material.type,
    content: material.type === "text" ? material.content || "" : "",
    fileName: material.fileName || "",
    mimeType: material.mimeType || "",
    createdAt: material.createdAt || "",
    updatedAt: material.updatedAt || "",
  };
}

function assertMaterialScope(user, jobId) {
  if (!nullableValue(user) || !nullableValue(jobId)) {
    throw new Error("缺少用户或岗位标识");
  }
}

async function listJobMaterials(user, jobId) {
  assertMaterialScope(user, jobId);
  const manifest = await readMaterialsManifest(user, jobId);
  return manifest.materials.map(serializeMaterial);
}

async function saveTextMaterial({ user, jobId, id, name, category, content }) {
  assertMaterialScope(user, jobId);
  const materialName = nullableValue(name);
  if (!materialName) throw new Error("资料名称不能为空");

  const manifest = await readMaterialsManifest(user, jobId);
  const now = new Date().toISOString();
  const textContent = String(content || "");
  const existingIndex = manifest.materials.findIndex((item) => item.id === id);

  if (existingIndex >= 0) {
    if (manifest.materials[existingIndex].type !== "text") {
      throw new Error("该资料不是文本资料");
    }
    manifest.materials[existingIndex] = {
      ...manifest.materials[existingIndex],
      name: materialName,
      category: nullableValue(category) || manifest.materials[existingIndex].category || "其他",
      content: textContent,
      updatedAt: now,
    };
  } else {
    manifest.materials.unshift({
      id: randomUUID(),
      name: materialName,
      category: nullableValue(category) || "其他",
      type: "text",
      content: textContent,
      fileName: "",
      filePath: "",
      mimeType: "text/plain",
      createdAt: now,
      updatedAt: now,
    });
  }

  await writeMaterialsManifest(user, jobId, manifest);
  return manifest.materials.map(serializeMaterial);
}

async function uploadJobMaterials({ user, jobId, files }) {
  assertMaterialScope(user, jobId);
  if (!Array.isArray(files) || !files.length) {
    throw new Error("缺少上传文件");
  }

  const manifest = await readMaterialsManifest(user, jobId);
  await ensureMaterialsDir(user, jobId);
  const filesDir = materialFilesDirFor(user, jobId);
  const now = new Date().toISOString();

  for (const item of files) {
    const fileName = path.basename(String(item.fileName || "").trim());
    const ext = path.extname(fileName).toLowerCase();
    if (!fileName || !ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
      throw new Error(`不支持的文件类型：${fileName || "未知文件"}`);
    }

    const buffer = Buffer.from(String(item.contentBase64 || ""), "base64");
    if (!buffer.length) {
      throw new Error(`文件内容为空：${fileName}`);
    }
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error(`单文件不能超过 20MB：${fileName}`);
    }

    const id = randomUUID();
    const storedFileName = `${id}${ext}`;
    await fs.promises.writeFile(path.join(filesDir, storedFileName), buffer);

    manifest.materials.unshift({
      id,
      name: nullableValue(item.displayName) || fileName,
      category: nullableValue(item.category) || "其他",
      type: "file",
      content: "",
      fileName,
      filePath: path.join("files", storedFileName),
      mimeType: item.mimeType || MIME_TYPES[ext] || "application/octet-stream",
      createdAt: now,
      updatedAt: now,
    });
  }

  await writeMaterialsManifest(user, jobId, manifest);
  return manifest.materials.map(serializeMaterial);
}

async function updateMaterialMeta({ user, jobId, id, name, category }) {
  assertMaterialScope(user, jobId);
  const materialName = nullableValue(name);
  if (!materialName) throw new Error("资料名称不能为空");

  const manifest = await readMaterialsManifest(user, jobId);
  const target = manifest.materials.find((item) => item.id === id);
  if (!target) throw new Error("未找到资料");

  target.name = materialName;
  target.category = nullableValue(category) || target.category || "其他";
  target.updatedAt = new Date().toISOString();
  await writeMaterialsManifest(user, jobId, manifest);
  return manifest.materials.map(serializeMaterial);
}

async function deleteMaterial({ user, jobId, id }) {
  assertMaterialScope(user, jobId);
  const manifest = await readMaterialsManifest(user, jobId);
  const target = manifest.materials.find((item) => item.id === id);
  if (!target) throw new Error("未找到资料");

  if (target.type === "file" && target.filePath) {
    await fs.promises.rm(path.join(materialsDirFor(user, jobId), target.filePath), { force: true });
  }

  manifest.materials = manifest.materials.filter((item) => item.id !== id);
  await writeMaterialsManifest(user, jobId, manifest);
  return manifest.materials.map(serializeMaterial);
}

async function purgeJobMaterials({ user, jobIds }) {
  if (!nullableValue(user) || !Array.isArray(jobIds)) return;
  await Promise.all(
    jobIds
      .map((jobId) => nullableValue(jobId))
      .filter(Boolean)
      .map((jobId) => fs.promises.rm(materialsDirFor(user, jobId), { recursive: true, force: true })),
  );
}

async function readMaterialFile({ user, jobId, id }) {
  assertMaterialScope(user, jobId);
  const manifest = await readMaterialsManifest(user, jobId);
  const target = manifest.materials.find((item) => item.id === id);
  if (!target || target.type !== "file" || !target.filePath) {
    throw new Error("未找到文件资料");
  }

  const filePath = path.join(materialsDirFor(user, jobId), target.filePath);
  const buffer = await fs.promises.readFile(filePath);
  return {
    buffer,
    fileName: target.fileName || `${target.name}${path.extname(filePath)}`,
    mimeType: target.mimeType || MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    filePath,
  };
}

async function findOfficeBinary() {
  for (const command of ["soffice", "libreoffice"]) {
    try {
      await execFileAsync(command, ["--version"]);
      return command;
    } catch {
      continue;
    }
  }
  return "";
}

async function convertPresentationToPdf(filePath) {
  const officeBinary = await findOfficeBinary();
  if (!officeBinary) return null;

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ai4job-ppt-preview-"));
  try {
    await execFileAsync(officeBinary, [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      tempDir,
      filePath,
    ]);

    const pdfName = `${path.basename(filePath, path.extname(filePath))}.pdf`;
    const pdfPath = path.join(tempDir, pdfName);
    const buffer = await fs.promises.readFile(pdfPath);
    return {
      buffer,
      fileName: pdfName,
      mimeType: "application/pdf",
    };
  } catch {
    return null;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
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
    /公司(?:名称)?[：:\s]+(.+?)(?=\s*(?:职位|岗位|地点|工作地点|职位描述|岗位描述|任职要求|投递链接|岗位职责|链接|https?:\/\/|$))/i,
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
    /(?:职位|岗位|招聘岗位|岗位名称|Job Title)[：:\s]+(.+?)(?=\s*(?:地点|工作地点|城市|Base|职位描述|岗位描述|任职要求|投递链接|岗位职责|链接|https?:\/\/|$))/i,
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

function detectSalary(text) {
  const patterns = [
    /(?:薪资|薪酬|工资|月薪|年薪|薪资范围)[：:\s]+([^\n，。；;|]+)/i,
    /((?:\d{1,3}(?:\.\d+)?[kKＫ]\s*[-~至]\s*\d{1,3}(?:\.\d+)?[kKＫ])(?:\s*[·xX×＊*]\s*\d{1,2}(?:\.\d+)?)?)/,
    /((?:\d{1,3}(?:,\d{3})+|\d{4,6})\s*[-~至]\s*(?:\d{1,3}(?:,\d{3})+|\d{4,6})\s*(?:元\/(?:月|年)|\/(?:月|年)))/,
    /((?:面议|薪资面议))/,
  ];
  const byPattern = firstMatch(text, patterns);
  return byPattern !== "-" ? byPattern : "-";
}

function detectLocation(text) {
  const patterns = [
    /(?:地点|工作地点|城市|Base)[：:\s]+(.+?)(?=\s*(?:职位描述|岗位描述|任职要求|投递链接|岗位职责|链接|https?:\/\/|$))/i,
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
  if ((/^https?:\/\//i.test(rawInput) || host) && host) {
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
    salary: detectSalary(sourceText),
    location: detectLocation(sourceText),
    sourceChannel: detectSourceChannel(rawInput, host),
    jdText: detectJDText(rawInput, sourceText, /^https?:\/\//i.test(rawInput)),
  };
}

function isBlankField(value) {
  const trimmed = String(value ?? "").trim();
  return !trimmed || trimmed === "-";
}

function extractBlankJobFields(form) {
  const jdText = preserveValue(form.jdText);
  if (jdText === "-") {
    throw new Error("缺少岗位描述");
  }

  const embeddedUrl = extractFirstUrl(jdText);
  const applyLink = isBlankField(form.applyLink) ? normalizeValue(embeddedUrl) : normalizeValue(form.applyLink);
  const host = applyLink !== "-" ? hostFromUrl(applyLink) : "";

  return {
    company: isBlankField(form.company) ? detectCompany(jdText, host) : normalizeValue(form.company),
    position: isBlankField(form.position) ? detectPosition(jdText) : normalizeValue(form.position),
    salary: isBlankField(form.salary) ? detectSalary(jdText) : normalizeValue(form.salary),
    location: isBlankField(form.location) ? detectLocation(jdText) : normalizeValue(form.location),
    applyLink,
    sourceChannel: detectSourceChannel(applyLink !== "-" ? applyLink : jdText, host),
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
      salary: "-",
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
      salary: normalizeValue(position.salary60),
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
      salary: detectSalary(structuredText),
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
  const chatCompletionsUrl = `${OPENAI_BASE_URL.replace(/\/+$/, "")}/chat/completions`;

  const prompt = [
    "你是岗位解析器。请从输入内容中提取岗位信息，并且只返回 JSON。",
    "字段必须包含：company, position, salary, location, sourceChannel, jdText。",
    "如果识别不出来，值必须是 '-'，不要编造。",
    "sourceChannel 只允许输出：官网、Boss直聘、智联招聘、国聘、拉勾、猎聘、内推、-。",
    `原始输入: ${rawInput}`,
    `域名: ${host || "-"}`,
    `网页正文: ${fetchedText || "-"}`,
  ].join("\n");

  const response = await fetch(chatCompletionsUrl, {
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
    salary: normalizeValue(parsed.salary),
    location: normalizeValue(parsed.location),
    sourceChannel: ["官网", "Boss直聘", "智联招聘", "国聘", "拉勾", "猎聘", "内推"].includes(parsed.sourceChannel) ? parsed.sourceChannel : "-",
    jdText: preserveValue(parsed.jdText),
  };
}

async function parseJobInput(rawInput) {
  const embeddedUrl = extractFirstUrl(rawInput);
  const rawTrimmed = String(rawInput || "").trim();
  const isPureLink = /^https?:\/\/[^\s]+$/i.test(rawTrimmed);
  const linkUrl = embeddedUrl || "";
  const host = linkUrl ? hostFromUrl(linkUrl) : "";

  if (isPureLink) {
    throw new Error("岗位上传仅支持粘贴文本，不支持只粘贴链接。请把岗位描述文本一并粘贴进来。");
  }

  const heuristic = heuristicParse({ rawInput, sourceText: rawInput, host });

  try {
    const llmResult = await extractWithOpenAI({
      rawInput,
      fetchedText: rawInput,
      host,
    });
    return {
      ...(llmResult || heuristic),
      jdLink: linkUrl || "-",
      applyLink: linkUrl || "-",
      jdText: llmResult?.jdText || heuristic.jdText || "-",
      parser: llmResult ? "openai" : "heuristic",
      fetchStatus: linkUrl ? "embedded_link_detected" : "not_needed",
    };
  } catch (error) {
    return {
      ...heuristic,
      jdLink: linkUrl || "-",
      applyLink: linkUrl || "-",
      parser: "heuristic",
      fetchStatus: linkUrl ? `embedded_link_detected_llm_failed:${error.message}` : "not_needed",
    };
  }
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function handleWorkflowSse(res, worker) {
  sendSseHeaders(res);
  try {
    await worker((event, data) => {
      writeSseEvent(res, event, { ok: true, ...data });
    });
    writeSseEvent(res, STREAM_EVENT.DONE, { ok: true });
  } catch (error) {
    logger.error("Workflow stream failed", { error: error.message });
    writeSseEvent(res, STREAM_EVENT.ERROR, { ok: false, error: error.message || "工作流执行失败" });
  } finally {
    endSse(res);
  }
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

  if (req.method === "GET" && req.url.startsWith("/api/job-materials/file")) {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host}`);
      let file = await readMaterialFile({
        user: requestUrl.searchParams.get("user") || "",
        jobId: requestUrl.searchParams.get("jobId") || "",
        id: requestUrl.searchParams.get("id") || "",
      });
      const download = requestUrl.searchParams.get("download") === "1";
      const ext = path.extname(file.fileName).toLowerCase();
      if (!download && PPT_EXTENSIONS.has(ext)) {
        const converted = await convertPresentationToPdf(file.filePath);
        if (converted) file = { ...file, ...converted };
      }
      sendBinary(
        res,
        200,
        file.buffer,
        file.mimeType,
        `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      );
      return;
    } catch (error) {
      sendJson(res, 404, { ok: false, error: error.message || "文件不存在" });
      return;
    }
  }

  if (req.method === "GET" && req.url.startsWith("/api/job-materials")) {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host}`);
      const materials = await listJobMaterials(
        requestUrl.searchParams.get("user") || "",
        requestUrl.searchParams.get("jobId") || "",
      );
      sendJson(res, 200, { ok: true, materials });
      return;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || "读取资料失败" });
      return;
    }
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

  if (req.method === "POST" && req.url === "/api/extract-job-fields") {
    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body || "{}");
      const result = extractBlankJobFields({
        company: payload.company,
        position: payload.position,
        salary: payload.salary,
        location: payload.location,
        jdText: payload.jdText,
        applyLink: payload.applyLink,
      });
      sendJson(res, 200, { ok: true, result });
      return;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || "提取失败" });
      return;
    }
  }

  if (req.method === "POST" && req.url === "/api/job-materials/text") {
    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body || "{}");
      const materials = await saveTextMaterial(payload);
      sendJson(res, 200, { ok: true, materials });
      return;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || "保存资料失败" });
      return;
    }
  }

  if (req.method === "POST" && req.url === "/api/job-materials/file") {
    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body || "{}");
      const materials = await uploadJobMaterials(payload);
      sendJson(res, 200, { ok: true, materials });
      return;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || "上传资料失败" });
      return;
    }
  }

  if (req.method === "POST" && req.url === "/api/job-materials/meta") {
    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body || "{}");
      const materials = await updateMaterialMeta(payload);
      sendJson(res, 200, { ok: true, materials });
      return;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || "更新资料失败" });
      return;
    }
  }

  if (req.method === "POST" && req.url === "/api/job-materials/delete") {
    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body || "{}");
      const materials = await deleteMaterial(payload);
      sendJson(res, 200, { ok: true, materials });
      return;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || "删除资料失败" });
      return;
    }
  }

  if (req.method === "POST" && req.url === "/api/job-materials/purge") {
    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body || "{}");
      await purgeJobMaterials(payload);
      sendJson(res, 200, { ok: true });
      return;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || "清理资料失败" });
      return;
    }
  }

  if (req.method === "POST" && req.url === "/api/analyze-job") {
    try {
      const payload = JSON.parse((await readRequestBody(req)) || "{}");
      const session = await optimizationService.createOrLoadSession({
        user: payload.user,
        sessionId: payload.sessionId,
        jobId: payload.jobId,
        selectedResumeId: payload.selectedResumeId,
        userGoal: payload.userGoal,
        constraints: payload.constraints,
      });
      if (payload.stream) {
        await handleWorkflowSse(res, async (writeEvent) => {
          await optimizationService.analyzeJob({
            session,
            job: payload.job || {},
            writeEvent,
          });
        });
        return;
      }

      const result = await optimizationService.analyzeJob({
        session,
        job: payload.job || {},
      });
      sendJson(res, 200, { ok: true, data: { sessionId: session.id, jobAnalysis: result } });
      return;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || "岗位分析失败" });
      return;
    }
  }

  if (req.method === "POST" && req.url === "/api/score-resume") {
    try {
      const payload = JSON.parse((await readRequestBody(req)) || "{}");
      const session = await optimizationService.loadSession(payload.user, payload.sessionId);
      const scoreType = payload.scoreType === SCORE_TYPE.OPTIMIZED ? SCORE_TYPE.OPTIMIZED : SCORE_TYPE.ORIGINAL;
      if (payload.stream) {
        await handleWorkflowSse(res, async (writeEvent) => {
          await optimizationService.scoreResume({
            session,
            scoreType,
            writeEvent,
          });
        });
        return;
      }
      const score = await optimizationService.scoreResume({
        session,
        scoreType,
      });
      sendJson(res, 200, { ok: true, data: { sessionId: session.id, score } });
      return;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || "简历评分失败" });
      return;
    }
  }

  if (req.method === "POST" && req.url === "/api/generate-suggestions") {
    try {
      const payload = JSON.parse((await readRequestBody(req)) || "{}");
      const session = await optimizationService.loadSession(payload.user, payload.sessionId);
      if (payload.stream) {
        await handleWorkflowSse(res, async (writeEvent) => {
          await optimizationService.generateSuggestions({
            session,
            userGoal: payload.userGoal,
            constraints: payload.constraints || {},
            writeEvent,
          });
        });
        return;
      }
      const suggestions = await optimizationService.generateSuggestions({
        session,
        userGoal: payload.userGoal,
        constraints: payload.constraints || {},
      });
      sendJson(res, 200, { ok: true, data: { sessionId: session.id, suggestions } });
      return;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || "生成建议失败" });
      return;
    }
  }

  if (req.method === "POST" && req.url === "/api/apply-suggestions") {
    try {
      const payload = JSON.parse((await readRequestBody(req)) || "{}");
      const session = await optimizationService.loadSession(payload.user, payload.sessionId);
      if (payload.stream) {
        await handleWorkflowSse(res, async (writeEvent) => {
          await optimizationService.applySuggestionActions({
            session,
            actions: payload.actions || [],
            generateResume: Boolean(payload.generateResume),
            writeEvent,
          });
        });
        return;
      }
      const updated = await optimizationService.applySuggestionActions({
        session,
        actions: payload.actions || [],
        generateResume: Boolean(payload.generateResume),
      });
      sendJson(res, 200, { ok: true, data: { session: updated } });
      return;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || "应用建议失败" });
      return;
    }
  }

  if (req.method === "POST" && req.url === "/api/rescore-resume") {
    try {
      const payload = JSON.parse((await readRequestBody(req)) || "{}");
      const session = await optimizationService.loadSession(payload.user, payload.sessionId);
      if (payload.stream) {
        await handleWorkflowSse(res, async (writeEvent) => {
          await optimizationService.scoreResume({
            session,
            scoreType: SCORE_TYPE.OPTIMIZED,
            writeEvent,
          });
        });
        return;
      }
      const score = await optimizationService.scoreResume({
        session,
        scoreType: SCORE_TYPE.OPTIMIZED,
      });
      sendJson(res, 200, { ok: true, data: { sessionId: session.id, score } });
      return;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || "复评分失败" });
      return;
    }
  }

  if (req.method === "GET" && req.url.startsWith("/api/continue-optimization-session")) {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host}`);
      const session = await optimizationService.continueLatestSession(
        requestUrl.searchParams.get("user") || "",
        {
          jobId: requestUrl.searchParams.get("jobId") || "",
          resumeId: requestUrl.searchParams.get("resumeId") || "",
        },
      );
      sendJson(res, 200, { ok: true, data: session });
      return;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || "读取优化会话失败" });
      return;
    }
  }

  if (req.method === "GET" && req.url.startsWith("/api/optimization-session")) {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host}`);
      const session = await optimizationService.loadSession(
        requestUrl.searchParams.get("user") || "",
        requestUrl.searchParams.get("sessionId") || "",
      );
      sendJson(res, 200, { ok: true, data: session });
      return;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || "读取会话失败" });
      return;
    }
  }

  if (req.method === "POST" && req.url === "/api/pause-optimization-session") {
    try {
      const payload = JSON.parse((await readRequestBody(req)) || "{}");
      const session = await optimizationService.pauseSession(payload.user, payload.sessionId);
      sendJson(res, 200, { ok: true, data: session });
      return;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || "暂停会话失败" });
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
