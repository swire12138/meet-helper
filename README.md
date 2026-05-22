# Meet Helper (会议助手)

Meet Helper 是一个基于大语言模型和语音识别技术开发的多模态实时会议分析与转写工具。它可以实时监听麦克风语音流进行高精度转写，并结合会议屏幕的定时截图，通过多模态大模型（Qwen-VL）实时提供结构化的会议增量分析、总结与待办事项。

## 🌟 核心功能

1. **实时语音流转写 (Real-time ASR)**：
   - 前端采集麦克风音频流，通过 WebSocket 实时传输给后端。
   - 后端调用阿里云 **Paraformer-Realtime** 语音识别模型，将音频实时转换为带标点的文字流，并在网页端滚动显示，延迟极低。
   
2. **多模态实时增量分析 (Multimodal Incremental Analysis)**：
   - 网页端每隔一定时间自动进行一次“屏幕截图”并截取这段时间内的“新增转写文本”。
   - 将“图文组合”数据发送至后端，后端结合上一次的会议纪要上下文，调用 **Qwen-VL** 系列多模态大模型进行推理。
   - 大模型能“看懂”屏幕上的 PPT/代码/图表，结合发言人的“语音”，实时输出（或追加）高价值的结构化总结、会议结论和行动项。

## 🧠 使用的模型 (Models Used)

本项目深度集成了阿里云灵积 (DashScope) 平台提供的领先 AI 模型：

- **qwen-vl-max / qwen-vl-plus**：
  - **用途**：多模态会议纪要分析。
  - **能力**：具备强大的视觉理解能力，能够识别屏幕截图中的文字、图表逻辑，并结合 ASR 转写的语音内容，综合输出高质量的会议摘要。
  - **调用方式**：兼容 OpenAI API 格式的 RESTful 请求。
  
- **paraformer-realtime-v2** (或同系列实时模型)：
  - **用途**：实时语音流转文字。
  - **能力**：低延迟流式 ASR 识别，适合在会议进行中提供“字幕”级的实时反馈。

## 🛠 技术栈

- **后端 (Server)**：
  - Node.js (Express 提供静态文件服务和 RESTful API，`ws` 提供 WebSocket 音频流传输)
- **前端 (Web)**：
  - 原生 HTML / CSS / Vanilla JS（由 Node 后端静态托管在 `web-static` 目录），提供麦克风采集、屏幕捕捉与实时结果渲染。
- **AI 与算法脚本 (Python)**：
  - `asr_bridge.py`：作为 WebSocket 桥接层，对接阿里云 DashScope 流式 SDK。

## 🚀 快速开始

### 1. 环境准备
- Node.js (建议 v18 或以上版本)
- Python 3.10+ 
- 安装 Python 依赖：
  ```bash
  pip install dashscope
  ```
- 在项目根目录复制 `.env.example` 并重命名为 `.env`。由于代码层面做了高度的兼容和 Fallback 机制，你**只需要填写一个统一的 API Key**：
  ```ini
  # 填写你的阿里云灵积 (DashScope) API Key。它将同时用于 Qwen-VL 和 Paraformer 语音识别。
  QWEN_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  
  # 其他模型配置（可选，如无特殊需求可保持默认）
  QWEN_MODEL=qwen-vl-max
  ```

### 2. 安装依赖
在项目根目录运行以下命令安装 Node.js 依赖：
```bash
npm install
```

### 3. 启动服务
```bash
npm run dev
```
此命令将启动 Node.js 服务器，默认监听在 **8787** 端口。

### 4. 访问应用
打开浏览器访问：[http://localhost:8787](http://localhost:8787) 即可进入会议助手的主界面。
*注意：捕获屏幕和麦克风通常需要浏览器在 `localhost` 或 HTTPS 环境下运行以获取权限。*

## 📂 目录结构

- `/server/`：Node.js 后端服务代码，处理音视频流、路由、大模型通信。
- `/web-static/`：目前使用中的前端静态文件（HTML, CSS, JS 等），通过后端直接暴露。
- `/screen-catch/`：Python 核心 AI 脚本目录（ASR 实时桥接、离线重跑等）。
- `/History-README/`：归档项目历史版本的旧 README。
