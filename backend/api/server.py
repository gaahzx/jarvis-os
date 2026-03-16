"""
backend/api/server.py

Servidor FastAPI com REST + WebSocket.
- WebSocket /ws : canal bidirecional de eventos em tempo real
- REST /api/*   : endpoints para o frontend

WebSocket Protocol:
  → Cliente envia: {"type": "command", "text": "..."}
  ← Servidor emite: {"type": "orb_state"|"transcript"|"response"|"graph_update"|...}
"""

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Módulos do JARVIS
from backend.core.claude_client import ClaudeClient
from backend.core.planner import Planner
from backend.core.agent_router import AgentRouter
from backend.core.task_graph_engine import TaskGraphEngine
from backend.core.delivery_manager import DeliveryManager
from backend.core.self_improvement import SelfImprovement
from backend.core.pipeline_learner import PipelineLearner
from backend.core.jarvis_core import JarvisCore
from backend.memory.supabase_client import SupabaseClient
from backend.memory.memory_manager import MemoryManager

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────
# Gerenciador de conexões WebSocket
# ──────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active_connections.append(ws)
        logger.info(f"[WS] Cliente conectado. Total: {len(self.active_connections)}")

    def disconnect(self, ws: WebSocket):
        self.active_connections.remove(ws)
        logger.info(f"[WS] Cliente desconectado. Total: {len(self.active_connections)}")

    async def broadcast(self, event_type: str, payload: dict):
        """Envia evento para todos os clientes conectados."""
        message = json.dumps({"type": event_type, **payload})
        disconnected = []
        for ws in self.active_connections:
            try:
                await ws.send_text(message)
            except Exception:
                disconnected.append(ws)
        for ws in disconnected:
            self.active_connections.remove(ws)

    async def send_to(self, ws: WebSocket, event_type: str, payload: dict):
        """Envia evento para um cliente específico."""
        message = json.dumps({"type": event_type, **payload})
        await ws.send_text(message)


ws_manager = ConnectionManager()

# ──────────────────────────────────────────────
# Container de dependências (singleton)
# ──────────────────────────────────────────────

class AppState:
    supabase: SupabaseClient | None = None
    memory: MemoryManager | None = None
    claude: ClaudeClient | None = None
    planner: Planner | None = None
    agent_router: AgentRouter | None = None
    delivery: DeliveryManager | None = None
    self_improvement: SelfImprovement | None = None
    pipeline_learner: PipelineLearner | None = None
    graph_engine: TaskGraphEngine | None = None
    jarvis: JarvisCore | None = None
    web_voice: Any | None = None  # WebVoiceHandler (inicializado no lifespan)


app_state = AppState()


# ──────────────────────────────────────────────
# Lifespan (startup / shutdown)
# ──────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Inicializa todos os serviços na startup."""
    logger.info("[Server] Iniciando JARVIS OS...")

    # Supabase
    app_state.supabase = SupabaseClient()

    # Memória
    app_state.memory = MemoryManager(app_state.supabase)
    await app_state.memory.initialize()

    # Claude
    app_state.claude = ClaudeClient()

    # Delivery Manager
    app_state.delivery = DeliveryManager(app_state.supabase)
    await app_state.delivery.ensure_bucket_exists()

    # Agentes
    app_state.agent_router = AgentRouter(delivery_manager=app_state.delivery)

    # Self-improvement
    app_state.self_improvement = SelfImprovement(app_state.supabase)
    app_state.pipeline_learner = PipelineLearner(app_state.supabase)

    # Broadcaster assíncrono
    async def broadcaster(event_type: str, payload: dict):
        await ws_manager.broadcast(event_type, payload)

    # Graph Engine
    app_state.graph_engine = TaskGraphEngine(
        agent_router=app_state.agent_router,
        event_callback=broadcaster,
    )

    # Planner
    app_state.planner = Planner(app_state.claude)

    # JARVIS Core
    app_state.jarvis = JarvisCore(
        claude_client=app_state.claude,
        planner=app_state.planner,
        task_graph_engine=app_state.graph_engine,
        memory_manager=app_state.memory,
        delivery_manager=app_state.delivery,
        self_improvement=app_state.self_improvement,
        ws_broadcaster=broadcaster,
    )

    # WebVoiceHandler — speech-to-speech pelo browser (sem hardware no servidor)
    try:
        from backend.voice.voice_pipeline import WebVoiceHandler
        from backend.voice.piper_tts import PiperTTS
        tts = PiperTTS()
        app_state.web_voice = WebVoiceHandler(
            jarvis_core=app_state.jarvis,
            tts=tts,
            ws_broadcast=broadcaster,
        )
        logger.info("[Server] WebVoiceHandler iniciado (speech-to-speech via browser).")
    except Exception as e:
        logger.warning(f"[Server] WebVoiceHandler indisponível: {e}")

    logger.info("[Server] JARVIS OS iniciado com sucesso!")
    yield
    logger.info("[Server] Encerrando JARVIS OS...")


# ──────────────────────────────────────────────
# Aplicação FastAPI
# ──────────────────────────────────────────────

app = FastAPI(
    title="JARVIS OS API",
    description="Backend do assistente pessoal JARVIS OS",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.getenv("FRONTEND_URL", "http://localhost:3000"),
        "http://localhost:3000",
        "https://*.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────
# WebSocket
# ──────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws_manager.connect(ws)
    jarvis = app_state.jarvis

    # Envia estado inicial
    await ws_manager.send_to(ws, "connected", {
        "session": jarvis.get_session_info(),
        "agents": app_state.agent_router.list_agents(),
    })
    await ws_manager.send_to(ws, "orb_state", {"state": "idle"})

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await ws_manager.send_to(ws, "error", {"message": "JSON inválido."})
                continue

            msg_type = data.get("type", "command")

            if msg_type == "command":
                text = data.get("text", "").strip()
                if not text:
                    continue
                # Processa em background para não bloquear o WS loop
                asyncio.create_task(
                    jarvis.process_command(text, source="text")
                )

            elif msg_type == "feedback":
                asyncio.create_task(
                    app_state.self_improvement.record_feedback(
                        interaction_id=data.get("interaction_id", ""),
                        session_id=jarvis.session.session_id,
                        feedback=data.get("feedback", "positive"),
                        comment=data.get("comment"),
                    )
                )

            elif msg_type == "new_session":
                session_id = jarvis.new_session()
                await ws_manager.send_to(ws, "session_started", {"session_id": session_id})

            elif msg_type == "ping":
                await ws_manager.send_to(ws, "pong", {"ts": time.time()})

            # ── Speech-to-Speech (browser mic → Whisper → Claude → Piper → browser) ──
            elif msg_type == "audio_start":
                if app_state.web_voice:
                    await app_state.web_voice.start_recording()

            elif msg_type == "audio_chunk":
                if app_state.web_voice:
                    import base64
                    audio_b64 = data.get("audio_base64", "")
                    if audio_b64:
                        audio_bytes = base64.b64decode(audio_b64)
                        await app_state.web_voice.handle_audio_chunk(audio_bytes)

            elif msg_type == "audio_end":
                if app_state.web_voice:
                    asyncio.create_task(app_state.web_voice.stop_recording_and_process())

            else:
                await ws_manager.send_to(ws, "error", {"message": f"Tipo desconhecido: {msg_type}"})

    except WebSocketDisconnect:
        ws_manager.disconnect(ws)


# ──────────────────────────────────────────────
# REST Endpoints
# ──────────────────────────────────────────────

class ChatRequest(BaseModel):
    text: str
    session_id: str | None = None

class FeedbackRequest(BaseModel):
    interaction_id: str
    feedback: str   # "positive" | "negative"
    comment: str | None = None


@app.get("/")
async def root():
    return {"status": "online", "system": "JARVIS OS", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "services": {
            "claude": app_state.claude is not None,
            "supabase": app_state.supabase is not None,
            "memory": app_state.memory is not None,
        },
    }


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Endpoint REST alternativo ao WebSocket (para integração com outros sistemas)."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Texto não pode ser vazio.")
    response = await app_state.jarvis.process_command(req.text, source="api")
    return {
        "response": response,
        "session": app_state.jarvis.get_session_info(),
    }


@app.post("/api/feedback")
async def feedback(req: FeedbackRequest):
    """Registra feedback do usuário."""
    await app_state.self_improvement.record_feedback(
        interaction_id=req.interaction_id,
        session_id=app_state.jarvis.session.session_id,
        feedback=req.feedback,
        comment=req.comment,
    )
    return {"status": "ok"}


@app.get("/api/deliveries")
async def list_deliveries(limit: int = 20):
    """Lista arquivos entregues."""
    session_id = app_state.jarvis.session.session_id if app_state.jarvis else None
    deliveries = await app_state.delivery.list_deliveries(session_id=session_id, limit=limit)
    return {"deliveries": deliveries}


@app.get("/api/agents")
async def list_agents():
    """Lista agentes disponíveis."""
    return {"agents": app_state.agent_router.list_agents()}


@app.get("/api/metrics")
async def get_metrics():
    """Resumo completo de performance, feedback e análise de pipelines (Fase 6)."""
    summary = await app_state.self_improvement.get_performance_summary()
    feedback_summary = await app_state.self_improvement.get_feedback_summary()
    error_rates = await app_state.self_improvement.get_error_rate_by_mode()
    analysis = await app_state.pipeline_learner.analyze_efficient_pipelines()
    agent_perf = await app_state.pipeline_learner.get_agent_performance()
    failure_patterns = await app_state.pipeline_learner.get_failure_patterns()
    slow = await app_state.pipeline_learner.get_slow_interactions()
    return {
        "performance": summary,
        "feedback": feedback_summary,
        "error_rates_by_mode": error_rates,
        "pipeline_analysis": analysis,
        "agent_performance": agent_perf,
        "failure_patterns": failure_patterns,
        "slow_interactions": slow,
    }


@app.get("/api/session")
async def get_session():
    """Informações da sessão atual."""
    return app_state.jarvis.get_session_info()


@app.post("/api/session/new")
async def new_session():
    """Inicia uma nova sessão."""
    session_id = app_state.jarvis.new_session()
    return {"session_id": session_id}
