# ============================================================
# JARVIS OS — Dockerfile do Backend
# Deploy: Railway (suporta Docker, WebSockets, Piper, Whisper)
# ============================================================

FROM python:3.11-slim

LABEL maintainer="JARVIS OS"
LABEL description="JARVIS OS Backend — FastAPI + Claude API + Piper TTS + Whisper STT"

ARG DEBIAN_FRONTEND=noninteractive

# ── Dependências de sistema ──────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    build-essential \
    gcc \
    curl \
    ca-certificates \
    tar \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── Diretório de trabalho ────────────────────────────────────
WORKDIR /app

# ── Dependências Python (cache layer) ───────────────────────
COPY backend/requirements.txt /app/backend/requirements.txt

RUN pip install --upgrade pip --no-cache-dir && \
    pip install --no-cache-dir \
        fastapi uvicorn[standard] websockets anthropic supabase \
        faster-whisper sentence-transformers \
        soundfile numpy python-dotenv pydantic \
        httpx aiofiles reportlab markdown openwakeword

# ── Código da aplicação ──────────────────────────────────────
COPY . /app

# ── Download do Piper TTS (binário Linux x86_64) ────────────
RUN mkdir -p /app/models/piper && \
    curl -L "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz" \
        -o /tmp/piper.tar.gz && \
    tar -xzf /tmp/piper.tar.gz -C /app/models/piper --strip-components=1 && \
    chmod +x /app/models/piper/piper && \
    rm /tmp/piper.tar.gz

# ── Download da voz pt_BR-faber-medium ──────────────────────
RUN curl -L "https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx" \
        -o /app/models/piper/pt_BR-faber-medium.onnx && \
    curl -L "https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx.json" \
        -o /app/models/piper/pt_BR-faber-medium.onnx.json

# ── Diretórios temporários ───────────────────────────────────
RUN mkdir -p /app/models/whisper /tmp/jarvis_deliveries

# ── Variáveis de ambiente para caminhos dos modelos ──────────
ENV PIPER_BINARY=/app/models/piper/piper
ENV PIPER_MODEL_PATH=/app/models/piper/pt_BR-faber-medium.onnx
ENV PIPER_MODEL_CONFIG=/app/models/piper/pt_BR-faber-medium.onnx.json
ENV WHISPER_MODEL_PATH=/app/models/whisper

# ── Usuário não-root (segurança) ─────────────────────────────
RUN useradd -m -u 1000 jarvis && \
    chown -R jarvis:jarvis /app /tmp/jarvis_deliveries
USER jarvis

# ── Porta exposta (Railway injeta PORT automaticamente) ───────
EXPOSE 8000

# ── Health check ─────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/health || exit 1

# ── Entrypoint ───────────────────────────────────────────────
# --no-voice: desabilita pipeline local de mic/speaker (sem hardware no servidor)
# A voz do browser funciona via WebSocket independentemente
CMD ["sh", "-c", "python main.py --no-voice --host 0.0.0.0 --port ${PORT:-8000}"]
