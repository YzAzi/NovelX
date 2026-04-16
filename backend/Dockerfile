FROM python:3.12-slim

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DEFAULT_TIMEOUT=300 \
    PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple \
    PYTORCH_CPU_INDEX_URL=https://download.pytorch.org/whl/cpu \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install CPU-only PyTorch first so sentence-transformers does not pull CUDA wheels.
RUN pip install --no-cache-dir \
    --index-url "${PYTORCH_CPU_INDEX_URL}" \
    --trusted-host download.pytorch.org \
    "torch"

RUN pip install --no-cache-dir \
    --index-url "${PIP_INDEX_URL}" \
    --trusted-host pypi.tuna.tsinghua.edu.cn \
    "fastapi>=0.111.0,<0.112.0" \
    "uvicorn[standard]>=0.40.0,<0.41.0" \
    "pydantic>=2.7.0,<3.0.0" \
    "pydantic-settings>=2.3.0,<3.0.0" \
    "langchain>=0.2.0,<0.3.0" \
    "langchain-openai>=0.1.0,<0.2.0" \
    "langgraph>=0.2.0" \
    "python-dotenv>=1.0.0,<2.0.0" \
    "sqlalchemy>=2.0.32,<3.0.0" \
    "aiosqlite>=0.21.0,<0.22.0" \
    "chromadb>=0.6.3,<0.7.0" \
    "langchain-chroma>=0.2.0,<0.3.0" \
    "sentence-transformers>=3.0.1,<4.0.0"

COPY backend /app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
