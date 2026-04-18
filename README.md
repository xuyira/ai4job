# AI4JOB

当前推荐部署方式见 [DEPLOY.md](/home/xyr/workspace/ai4job/DEPLOY.md)。

## EdgeOne Pages MVP

仓库现已补上 `node-functions/` 入口，目标是先以 EdgeOne Pages 最小可用版本上线。

当前保留：

- 静态页面访问
- 基于文本的岗位分析
- 基于文本的简历优化主链路
- 本地浏览器中的岗位与文本简历保存

当前暂未实现：

- 文件上传
- 服务端 `storage/` 持久化
- 岗位资料库 / 个人资料库
- PPT 预览与文件转换
- 其余增强接口

这些能力在界面或接口中会显示“暂未实现 / 等待后续开发”。

## Run

```bash
npm start
```

默认访问：`http://localhost:3000`

说明：

- `npm start` 启动的是原有 Node 服务入口，便于本地兼容运行。
- EdgeOne Pages 部署使用仓库中的 `node-functions/`，不依赖 `server.listen(...)` 常驻进程。

## Env

复制 `.env.example` 后自行注入：

```bash
HOST=0.0.0.0
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
- 对外部署时建议设置 `HOST=0.0.0.0`。
- EdgeOne Pages 最小版主要使用 `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_BASE_URL`。
