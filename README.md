# 项目简介

## 环境要求
- Node.js >= 18
- Python >= 3.11
- pnpm
- Poetry

## 环境变量
- OPENAI_API_KEY：LLM 调用密钥
- OPENAI_BASE_URL：LLM 接口地址（默认 OpenAI）
- MODEL_NAME：模型名称
- OPENAI_API_KEY_DRAFTING：大纲生成专用 key（可选，未填则回退 OPENAI_API_KEY）
- OPENAI_API_KEY_SYNC：同步分析专用 key（可选，未填则回退 OPENAI_API_KEY）
- OPENAI_API_KEY_EXTRACTION：实体抽取专用 key（可选，未填则回退 OPENAI_API_KEY）
- MODEL_NAME_DRAFTING：大纲生成模型名（可选，未填则回退 MODEL_NAME）
- MODEL_NAME_SYNC：同步分析模型名（可选，未填则回退 MODEL_NAME）
- MODEL_NAME_EXTRACTION：实体抽取模型名（可选，未填则回退 MODEL_NAME）
- CHROMA_PERSIST_PATH：向量库持久化目录（默认 backend/data/chroma_db）

## 项目结构
- 前端：`frontend/`（Next.js、React）
- 后端：`backend/`（FastAPI、LangGraph、向量检索）
- 数据：`backend/data/`（SQLite、向量库、知识图谱、版本快照）
- 配置：`.env.example`、`.gitignore`

## 启动方式
1. 安装依赖（前端）：`pnpm install`
2. 安装依赖（后端）：`poetry install`
3. 根据 `.env.example` 创建本地 `.env`
4. 启动后端：
   - `cd backend`
   - `poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000`
5. 启动前端：
   - `cd frontend`
   - `pnpm dev -H 0.0.0.0 -p 3000`

## Docker 启动
生产模式（构建镜像并运行）：
1. 创建 .env（至少包含 OPENAI_API_KEY，如果需要）
2. 启动：`docker compose up --build`
3. 停止：`docker compose down`
4. 访问：
   - 后端：`http://localhost:8000`
   - 前端：`http://localhost:3000`

开发模式（热重载）：
1. 启动：`docker compose -f docker-compose.dev.yml up --build`
2. 停止：`docker compose -f docker-compose.dev.yml down`
3. 前端会在容器内执行 `pnpm dev`，后端使用 `uvicorn --reload`

## 导出/导入项目
在左侧项目列表中：
- 点击“导出”可下载项目 JSON（包含大纲、知识图谱、世界观文档与版本快照）。
- 点击“导入”选择导出的 JSON 文件，可恢复为一个同 ID 的项目。

注意：导入会使用导出时的项目 ID，如已存在同 ID 项目会导入失败。您可先删除或改名后再导入。

## RAG 检索改进（当前实现）
已接入混合检索与结构化证据：
- 向量检索 + 关键词检索 + BM25 混合召回
- 查询改写（基于命中实体与关键词扩展）
- 世界观检索结果以结构化证据注入（标题/分类/片段）

## 本地部署指南
- 仅建议本地/内网使用：当前默认无鉴权与权限隔离。
- 数据目录：默认使用 `backend/data/` 保存数据库、向量库、知识图谱与版本快照。
- 备份建议：定期备份 `backend/data/`，包含 `stories.db` 与向量库数据。
- 版本恢复：会回滚世界观文档并重建向量索引，项目大时耗时更长。
