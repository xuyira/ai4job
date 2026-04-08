import { logger } from "../utils/logger.js";
import { fetch as undiciFetch, ProxyAgent } from "undici";

function createChatCompletionsUrl(baseUrl) {
  const normalizedBaseUrl = String(baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  return `${normalizedBaseUrl}/chat/completions`;
}

export function createOpenAIClient({ apiKey, model, baseUrl }) {
  const proxyUrl = process.env.OPENAI_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  const chatCompletionsUrl = createChatCompletionsUrl(baseUrl);

  async function chatJson({ system, user }) {
    if (!apiKey) {
      throw new Error("未配置 OPENAI_API_KEY，无法调用大模型。");
    }

    const response = await undiciFetch(chatCompletionsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      dispatcher,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI 调用失败: HTTP ${response.status} ${text.slice(0, 300)}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content || "{}";
    try {
      return JSON.parse(content);
    } catch (error) {
      logger.error("OpenAI JSON parse failed", { error: error.message, content: content.slice(0, 500) });
      throw new Error("大模型返回的 JSON 结构无效。");
    }
  }

  async function chatText({ system, user }) {
    if (!apiKey) {
      throw new Error("未配置 OPENAI_API_KEY，无法调用大模型。");
    }

    const response = await undiciFetch(chatCompletionsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      dispatcher,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI 调用失败: HTTP ${response.status} ${text.slice(0, 300)}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content || "";
    if (!content.trim()) {
      throw new Error("大模型未返回有效文本内容。");
    }
    return content;
  }

  return {
    chatJson,
    chatText,
  };
}
