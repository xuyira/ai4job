# AI4JOB

## Run

```bash
npm start
```

默认访问：`http://localhost:3000`

## Env

复制 `.env.example` 后自行注入：

```bash
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
OPENAI_BASE_URL=https://api.openai.com/v1
PORT=3000
```

说明：

- 未配置 `OPENAI_API_KEY` 时，服务端仍可抓取网页并执行规则解析。
- 配置 `OPENAI_API_KEY` 后，服务端会在抓取正文后调用 OpenAI 做结构化抽取。
- 如使用 OpenAI 兼容网关，可把 `OPENAI_BASE_URL` 改成对应地址，例如 `https://aihubmix.com/v1`。
- 前端不要直接双击 `index.html` 打开，应通过本地服务访问。
