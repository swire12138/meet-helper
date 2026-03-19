# 会议旁听 Agent (Meet Helper)

这是一个基于 Node.js 和 Vue 3 开发的“会议旁听”智能体应用。它通过对接 Qwen (通义千问) 大模型，能够自动读取会议转写文档（如架构师技术讨论），并将其结构化为多个专业的独立板块，以便快速提取技术决议和追问细节。

## 🌟 核心功能

应用会将长篇的会议转写文本拆解并流式输出为以下 4 个独立板块（支持 Markdown 富文本展示）：

1. **修正后的会议转写**：根据上下文，自动修复语音识别中常见的近似音、错词和混淆的专业名词，并保留时间戳和对话结构。
2. **参与者与观点**：提取会议中出现的所有参与者，并总结每个人在各个技术议题上的核心观点和立场。
3. **议题技术报告**：按讨论时间顺序，梳理每个议题的“讨论初现状”、“讨论中遇到的问题”、“最终结论”以及“前后差异对比”。
4. **追问清单**：审查讨论中的遗漏或不确定点，自动生成针对特定参与者的追问，包含“对谁问”、“问什么”以及“期待的回答”。

> *注：原包含的“术语表”功能因精简需要已在当前版本中关闭。*

## 🛠 技术栈

- **后端**：Node.js, Express, Multer (处理文件上传), OpenAI Node SDK (用于连接兼容 OpenAI 接口的大模型)
- **前端**：Vue 3 (通过 CDN 和本地静态托管直接引入，无构建负担), CSS (原生响应式布局)
- **依赖库**：`marked` (Markdown 渲染), `DOMPurify` (防 XSS 注入)

## 🚀 快速开始

### 1. 环境准备

确保你已安装了 [Node.js](https://nodejs.org/) (建议 v18+)。

### 2. 安装依赖

在项目根目录下运行：

```bash
npm install
```

### 3. 配置环境变量

复制环境样例文件并重命名为 `.env`：

```bash
cp .env.example .env
```

然后编辑 `.env` 文件，填入你的 Qwen API Key 和模型配置（详见下文配置说明）。

### 4. 启动服务

```bash
npm run dev
```

启动后，后端服务将运行在 `http://localhost:8787`，并且会自动托管前端静态页面。
打开浏览器访问 [http://localhost:8787/](http://localhost:8787/) 即可使用。

## ⚙️ 环境变量说明 (`.env`)

| 变量名 | 说明 | 默认/推荐值 |
| --- | --- | --- |
| `QWEN_API_KEY` | 你的阿里云 DashScope API Key | `sk-xxxxxx` |
| `QWEN_BASE_URL` | Qwen 的 OpenAI 兼容接口地址 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `QWEN_MODEL` | 使用的模型版本（推荐使用 flash 版本以降低首 Token 延迟） | `qwen3.5-flash` 或 `qwen3.5-plus` |
| `QWEN_ENABLE_THINKING` | 是否开启模型的深度思考功能 | `false` |
| `QWEN_MAX_TOKENS` | 单个板块输出的最大 Token 数限制 | `8192` |

## 💡 流式输出与性能说明

- **原生流式渲染**：应用采用 NDJSON (Newline Delimited JSON) 格式进行前后端流式通信，模型每生成一部分内容，前端就会立即通过 `v-html` 渲染出来。
- **模块串行执行**：为了保证上下文的连贯性，后三个板块（观点、报告、追问）依赖于第一个板块（修正后的转写）的完整输出作为输入 Prompt。因此，执行逻辑是**严格串行**的。
- **首 Token 延迟 (TTFT)**：由于大模型处理超长上下文需要预填充 (Prefill) 时间，且后续模块的输入包含前序模块的全文，因此**每个模块开始吐词前都会有等待时间，且该等待时间与上一模块的输出长度呈正相关**。

## 📁 目录结构

```text
meet-helper/
├── server/                 # 后端服务
│   ├── src/
│   │   ├── analyze.js      # 核心逻辑：大模型流式调用与串行控制
│   │   ├── env.js          # 环境变量加载
│   │   ├── index.js        # Express 路由与静态托管入口
│   │   ├── ndjson.js       # NDJSON 流式写入工具
│   │   ├── prompts.js      # 各个板块的 Prompt 模板定义
│   │   └── qwenClient.js   # Qwen SDK 客户端初始化
│   └── package.json
├── web-static/             # 前端静态页面 (由后端直接托管)
│   ├── lib/                # 本地化的第三方库 (marked, purify)
│   ├── app.js              # Vue 3 组合式 API 核心逻辑
│   ├── index.html          # 前端入口
│   └── style.css           # 页面样式
├── samples/                # 测试样例
│   └── demo-transcript.txt # 会议转写测试文档
├── .env.example            # 环境变量模板
├── .gitignore
└── package.json            # 根目录 npm workspaces 配置
```
