# Novel

一个面向小说创作的本地工作台，覆盖从灵感孵化、大纲生成、节点编辑，到写作润色、关系图谱、一致性分析、版本快照和项目导入导出的一整套流程。

前端使用 Next.js 16 + React 19，后端使用 FastAPI + SQLAlchemy + LangChain/LangGraph。项目默认把数据持久化到本地 `backend/data/`。

## 当前能力

- 用户登录与项目隔离
  支持注册、登录、改密码、退出全部会话；项目和共享文笔库按用户隔离。旧版本遗留的无归属项目会在首个注册用户创建后自动认领。
- Idea Lab 灵感实验室
  通过 `concept -> protagonist -> conflict -> outline` 四阶段逐步生成故事方向，最终一键落成项目，并通过 WebSocket 返回生成进度。
- AI 大纲生成与空白项目
  支持从世界观、风格标签、核心创意直接生成项目，也支持创建空白项目手动搭建结构，还可以基于已有项目派生新项目。
- 大纲工作区
  支持节点图与节点列表编辑、节点插入、叙事顺序调整、时间线排序、文本大纲导入，以及节点级自动同步。
- 冲突检测与知识图谱同步
  节点保存后会更新索引与知识图谱，并返回设定冲突、人物关系或时间线问题。
- 角色关系页
  支持手动同步图谱、增删改实体与关系、实体合并，以及把图谱角色反向同步回项目角色列表。
- 写作工作台
  支持章节创建、重命名、排序、删除，配套 AI 写作助手，可用于全文或片段润色/扩写。
- 文笔知识库
  项目内支持上传原始 `.txt/.md` 小说素材，后端先做分批清洗，再切分入库用于检索增强。
- 共享文笔库
  支持跨项目复用文笔素材，可导入已清洗的 `JSON / TXT / MD` 素材，统一管理、重命名和删除。
- 一致性分析
  `/analysis/[projectId]` 页面支持流式分析、快速提问、历史消息保存；分析范围会根据项目体量和 `analysis_profile` 自动选择全量或检索式分析。
- 版本快照
  支持手动创建快照、查看版本列表、对比差异、恢复历史版本、删除快照。
- 项目导入导出
  可导出项目本体、知识图谱、文笔知识、版本快照，并在另一环境导入恢复。
- 模型与 Prompt 配置
  支持为 drafting、sync、extraction 单独配置模型和 API Key；项目级 Prompt 覆盖与写作助手配置会随项目持久化。

## 页面与模块

- 首页 `/`
  登录、项目列表、新建项目、版本入口、模型配置、项目级 Prompt 配置、账号设置。
- 灵感实验室 `/idea-lab`
  用阶段式选择生成项目方向。
- 大纲页 `/projects/[projectId]/outline`
  管理节点、导入大纲、调整叙事结构。
- 写作页 `/projects/[projectId]/writing`
  章节写作、AI 写作助手、项目文笔库、共享文笔库。
- 关系页 `/projects/[projectId]/relations`
  查看和维护角色关系图谱。
- 分析页 `/analysis/[projectId]`
  对当前项目做一致性分析和修改建议生成。

## 技术栈

- 前端：Next.js 16、React 19、TypeScript、Tailwind CSS 4、Zustand、Radix UI、Framer Motion
- 后端：FastAPI、SQLAlchemy、Pydantic 2、Uvicorn
- AI 相关：LangChain、LangGraph、langchain-openai
- 检索与存储：SQLite、ChromaDB、sentence-transformers、BM25/关键词混合检索
- 通信：REST API + WebSocket

## 项目结构

```text
novel/
├── frontend/                # Next.js 前端
├── backend/                 # FastAPI 后端
│   ├── app/
│   ├── data/                # SQLite、图谱、向量库、版本快照等本地数据
│   ├── tests/
│   └── scripts/setup_cpu_env.sh
├── deploy/                  # Nginx 生产配置
├── docker-compose.yml       # 本地容器运行
├── docker-compose.dev.yml   # 开发热重载
├── docker-compose.prod.yml  # 生产部署
└── .env.example
```

## 环境要求

- Node.js 20 以上
- Python 3.11 或 3.12
- `pnpm`
- `uv`

## 环境变量

常用变量如下，完整示例见 [`.env.example`](/home/ubuntu/novel/.env.example) 和 [`.env.prod.example`](/home/ubuntu/novel/.env.prod.example)。

| 变量 | 说明 |
| --- | --- |
| `OPENAI_API_KEY` | 默认模型 API Key |
| `OPENAI_BASE_URL` | OpenAI 兼容接口地址 |
| `MODEL_NAME` | 默认模型名 |
| `OPENAI_API_KEY_DRAFTING` | 大纲生成专用 Key，可选 |
| `OPENAI_API_KEY_SYNC` | 同步/分析专用 Key，可选 |
| `OPENAI_API_KEY_EXTRACTION` | 实体抽取专用 Key，可选 |
| `MODEL_NAME_DRAFTING` | 大纲生成模型名，可选 |
| `MODEL_NAME_SYNC` | 同步/分析模型名，可选 |
| `MODEL_NAME_EXTRACTION` | 实体抽取模型名，可选 |
| `EMBEDDING_MODEL` | 嵌入模型名或本地路径 |
| `CHROMA_PERSIST_PATH` | Chroma 持久化目录 |
| `CORS_ALLOW_ORIGINS` | 允许的前端来源，逗号分隔 |
| `AUTH_SECRET_KEY` | 登录态签名密钥，生产环境必须设置 |
| `NOVEL_DATABASE_URL` | 可选，覆盖默认 SQLite 地址 |
| `NEXT_PUBLIC_API_URL` | 前端请求后端的基地址 |

说明：

- 根目录 `.env` 会被前后端共同读取。
- `/api/health`、`/api/auth/register`、`/api/auth/login` 之外的 API 默认都要求 Bearer Token。
- 系统设置页里修改的模型/Base URL/API Key 是按用户保存在当前后端进程内存中的，重启后会回退到 `.env`；项目级 `prompt_overrides` 和 `writer_config` 会持久化到项目数据。

## 本地开发

### 1. 准备环境变量

```bash
cd /home/ubuntu/novel
cp .env.example .env
```

至少补齐：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `MODEL_NAME`
- `AUTH_SECRET_KEY`

### 2. 安装前端依赖

```bash
cd /home/ubuntu/novel/frontend
corepack enable
pnpm install
```

### 3. 安装后端依赖

推荐使用仓库自带脚本，按 CPU-only 方式安装 PyTorch，避免在纯 CPU 环境误拉 CUDA 依赖：

```bash
cd /home/ubuntu/novel/backend
bash scripts/setup_cpu_env.sh
```

如果 `uv` 不在默认位置，可通过 `UV_BIN` 指定；如需换镜像，可通过 `UV_DEFAULT_INDEX` 覆盖。

### 4. 启动后端

```bash
cd /home/ubuntu/novel/backend
.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 5. 启动前端

```bash
cd /home/ubuntu/novel/frontend
pnpm dev -H 0.0.0.0 -p 3000
```

### 6. 访问项目

- 前端：`http://localhost:3000`
- 后端健康检查：`http://localhost:8000/api/health`
- 后端 OpenAPI：`http://localhost:8000/docs`

## Docker

### 本地容器模式

```bash
cd /home/ubuntu/novel
docker compose up --build
```

访问：

- 前端：`http://localhost:3000`
- 后端：`http://localhost:8000`

停止：

```bash
docker compose down
```

### 开发热重载模式

```bash
cd /home/ubuntu/novel
docker compose -f docker-compose.dev.yml up --build
```

这个模式下：

- 后端使用 `uvicorn --reload`
- 前端容器执行 `pnpm dev`
- 代码目录直接挂载，适合本地调试

### 生产模式

```bash
cd /home/ubuntu/novel
cp .env.prod.example .env
docker compose -f docker-compose.prod.yml up -d --build
```

生产模式使用 `nginx` 对外暴露 `80` 端口：

- `/` 转发到前端
- `/api/*` 与 `/ws/*` 转发到后端
- `NEXT_PUBLIC_API_URL` 为空字符串，前端走同域名相对路径

建议至少放行：

- `80/tcp`
- `443/tcp`（如需 HTTPS）

查看状态与日志：

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f
```

## 推荐使用流程

1. 注册并登录账号。
2. 在首页或 Idea Lab 新建项目。
3. 在大纲页补充节点、导入文本大纲并调整时间线。
4. 在关系页同步或修正角色实体与关系。
5. 在写作页创建章节，导入项目内素材或接入共享文笔库。
6. 在分析页检查一致性、节奏和设定冲突。
7. 在关键阶段创建版本快照，必要时回滚。
8. 需要迁移时导出项目 JSON，到新环境再导入。

## 数据与持久化

默认本地数据位于 [backend/data](/home/ubuntu/novel/backend/data)：

- `stories.db`：SQLite 主库
- `chroma_db/`：向量索引
- 图谱与分析历史：项目级本地文件
- 版本快照：版本管理存储

建议定期备份整个 [backend/data](/home/ubuntu/novel/backend/data) 目录。

## 测试

后端当前包含基础测试，覆盖 CORS、LLM 输出归一化、冲突检测、鉴权权限等。

运行方式：

```bash
cd /home/ubuntu/novel/backend
.venv/bin/pytest
```

## 已知实现约束

- 当前版本快照默认只创建手动快照。
- 项目导入会保留原项目 ID；如果目标环境已存在相同 ID，会返回冲突。
- 共享文笔库与项目数据都依赖用户登录态访问。
- 前端默认通过 `NEXT_PUBLIC_API_URL` 指向后端；生产模式下应保持为空字符串并通过反向代理转发。
