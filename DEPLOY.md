# AI4JOB Deployment

## 当前推荐：EdgeOne Pages 最小可用版本

仓库已经补上 `node-functions/` 入口，当前推荐优先部署到 EdgeOne Pages。

### 当前保留能力

- 静态页面访问
- 文本岗位分析
- 文本简历优化主链路
- 浏览器本地保存岗位和文本简历

### 当前暂未实现

- 文件上传
- 服务端 `storage/` 持久化
- 岗位资料库 / 个人资料库
- PPT 预览与文件转换
- 一部分增强接口

这些能力在接口或页面中会返回明确说明，例如：

- `EdgeOne Pages 最小版暂未实现该能力`
- `等待后续开发`

## EdgeOne Pages 部署步骤

### 1. 导入仓库

将当前仓库连接到 EdgeOne Pages 项目。

### 2. 构建设置

当前最小版不依赖额外前端构建产物，仓库根目录中的静态文件可直接作为页面资源使用，同时 `node-functions/` 目录作为函数入口。

推荐关注以下目录：

- `index.html`
- `node-functions/`
- `src/server/`

### 3. 环境变量

至少配置以下变量：

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

说明：

- 未配置 `OPENAI_API_KEY` 时，简历优化主链路无法调用模型
- 如使用 OpenAI 兼容网关，可调整 `OPENAI_BASE_URL`
- `HOST` 与 `PORT` 不是 EdgeOne Pages 最小版的核心变量

### 4. 部署后校验

优先检查：

```text
/api/health
```

正常情况下会返回当前运行模式和最小版说明。

然后验证：

- 页面能正常打开
- 选择已有文本简历或填写基础信息后，可以发起简历优化
- 文件上传相关入口会返回明确提示，而不是报错崩溃

## 本地兼容运行

当前仓库仍保留原有 Node 入口，方便本地兼容调试：

```bash
npm install
npm start
```

默认访问：

```text
http://localhost:3000
```

注意：

- 本地 `npm start` 仍然是旧的 Node 服务模式
- EdgeOne Pages 部署实际使用的是 `node-functions/`
- 两条链路并存，便于过渡

## 旧方案：Docker / Nginx

仓库中的 [`Dockerfile`](/home/xyr/workspace/ai4job/Dockerfile) 、[`docker-compose.yml`](/home/xyr/workspace/ai4job/docker-compose.yml) 和 [`deploy/nginx/ai4job.conf`](/home/xyr/workspace/ai4job/deploy/nginx/ai4job.conf) 仍可作为旧的服务器部署方案参考。

但对当前目标来说，它们不再是首选路径。
