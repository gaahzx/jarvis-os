"""
backend/core/jarvis_core.py

Núcleo orquestrador do JARVIS OS.
State machine central que coordena todos os módulos:
  - VoicePipeline (STT/TTS/WakeWord)
  - Planner (decisão de modo)
  - TaskGraphEngine (execução de grafos)
  - MemoryManager (memória persistente)
  - DeliveryManager (arquivos gerados)
  - SelfImprovement (métricas)
  - WebSocket broadcaster (eventos para o frontend)
"""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine, Literal

logger = logging.getLogger(__name__)

# Tipo dos estados do Orb
OrbState = Literal["idle", "listening", "thinking", "speaking", "error"]

# Tipo do callback de eventos WebSocket
WSEventCallback = Callable[[str, dict], Coroutine[Any, Any, None]]


@dataclass
class JarvisSession:
    """Representa uma sessão de interação com o usuário."""
    session_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    history: list[dict] = field(default_factory=list)
    orb_state: OrbState = "idle"
    active_graph_id: str | None = None


class JarvisCore:
    """
    Orquestrador principal do JARVIS OS.
    Recebe comandos de texto (vindos do pipeline de voz ou do frontend)
    e coordena toda a execução.
    """

    def __init__(
        self,
        claude_client,
        planner,
        task_graph_engine,
        memory_manager,
        delivery_manager,
        self_improvement,
        ws_broadcaster: WSEventCallback | None = None,
    ):
        self.claude = claude_client
        self.planner = planner
        self.graph_engine = task_graph_engine
        self.memory = memory_manager
        self.delivery = delivery_manager
        self.improvement = self_improvement
        self._broadcast = ws_broadcaster or self._noop

        # Sessão atual
        self.session = JarvisSession()

        # Lock para evitar processamento concorrente de comandos
        self._processing_lock = asyncio.Lock()

    # ── Ponto de entrada principal ─────────────────────────────────────────

    async def process_command(self, user_input: str, source: str = "voice") -> str:
        """
        Processa um comando do usuário (texto transcrito ou digitado).
        Retorna a resposta final em texto (que será sintetizada em voz ou exibida no console).

        source: "voice" | "text" | "api"
        """
        if self._processing_lock.locked():
            return "Ainda processando o comando anterior. Aguarde um momento."

        async with self._processing_lock:
            return await self._run_pipeline(user_input, source)

    async def _run_pipeline(self, user_input: str, source: str) -> str:
        """Pipeline completo de processamento."""
        t0 = time.monotonic()
        interaction_id = str(uuid.uuid4())

        logger.info(f"[JarvisCore] [{interaction_id}] Input: {user_input[:100]}")

        # ── 1. Estado: thinking ───────────────────────────────────────────
        await self._set_orb_state("thinking")

        # Registra input no histórico
        self.session.history.append({"role": "user", "content": user_input})

        # ── 2. Busca contexto de memória relevante ────────────────────────
        memory_context = []
        try:
            memory_context = await self.memory.search(user_input, limit=5)
        except Exception as e:
            logger.warning(f"[JarvisCore] Falha ao buscar memória: {e}")

        # ── 3. Planejamento ───────────────────────────────────────────────
        await self._broadcast("transcript", {
            "text": user_input,
            "source": source,
            "interaction_id": interaction_id,
        })

        try:
            plan_result = await self.planner.plan(
                user_input=user_input,
                history=self.session.history[:-1],  # sem o input atual
                memory_context=memory_context,
            )
        except Exception as e:
            logger.error(f"[JarvisCore] Erro no planejador: {e}", exc_info=True)
            await self._set_orb_state("error")
            return "Desculpe, ocorreu um erro ao processar seu pedido. Tente novamente."

        # ── 4. Execução conforme o modo ───────────────────────────────────
        final_response = ""
        graph_data = None
        deliveries = []

        if plan_result.mode == "conversational":
            final_response = plan_result.response_text or ""

        elif plan_result.mode == "execution":
            final_response = plan_result.response_text or ""

        elif plan_result.mode == "planning":
            plan = plan_result.plan
            self.session.active_graph_id = plan.graph_id

            # Emite o grafo para o Visual Brain
            await self._broadcast("graph_update", {
                "graph_id": plan.graph_id,
                "nodes": [n.model_dump() for n in plan.nodes],
                "edges": [e.model_dump() for e in plan.edges],
                "status": "executing",
            })

            # Executa o grafo
            try:
                exec_result = await self.graph_engine.execute(plan)
                deliveries = exec_result.deliveries

                # Sintetiza resposta final
                node_results = [
                    {
                        "node_label": nr.node_label,
                        "result": nr.result,
                        "status": nr.status,
                    }
                    for nr in exec_result.nodes
                ]
                final_response = await self.claude.synthesize_final_response(
                    original_request=user_input,
                    execution_results=node_results,
                    deliveries=deliveries,
                )

                # Atualiza grafo no Visual Brain com resultados
                await self._broadcast("graph_update", {
                    "graph_id": plan.graph_id,
                    "nodes": [
                        {
                            **n.model_dump(),
                            "status": exec_result.nodes[i].status,
                            "duration_ms": exec_result.nodes[i].duration_ms,
                            "result_preview": exec_result.nodes[i].result[:200],
                        }
                        for i, n in enumerate(plan.nodes)
                    ],
                    "edges": [e.model_dump() for e in plan.edges],
                    "status": exec_result.status,
                })

            except Exception as e:
                logger.error(f"[JarvisCore] Erro na execução do grafo: {e}", exc_info=True)
                await self._set_orb_state("error")
                final_response = (
                    "Encontrei um erro durante a execução da tarefa. "
                    "Por favor, tente reformular o pedido."
                )

        # ── 5. Estado: speaking ───────────────────────────────────────────
        await self._set_orb_state("speaking")

        # ── 6. Persiste no histórico e memória ───────────────────────────
        self.session.history.append({"role": "assistant", "content": final_response})

        try:
            # Salva a conversa no banco
            await self.memory.store_conversation(
                session_id=self.session.session_id,
                user_input=user_input,
                assistant_response=final_response,
                mode=plan_result.mode,
                graph_id=self.session.active_graph_id,
            )
            # Armazena embeddings para busca futura
            await self.memory.embed_and_store(
                text=f"Usuário: {user_input}\nJarvis: {final_response}",
                metadata={
                    "session_id": self.session.session_id,
                    "mode": plan_result.mode,
                    "interaction_id": interaction_id,
                },
            )
        except Exception as e:
            logger.warning(f"[JarvisCore] Falha ao persistir memória: {e}")

        # ── 7. Métricas de auto-melhoria ──────────────────────────────────
        total_ms = (time.monotonic() - t0) * 1000
        try:
            await self.improvement.record_metric(
                interaction_id=interaction_id,
                session_id=self.session.session_id,
                user_input=user_input,
                mode=plan_result.mode,
                planner_latency_ms=plan_result.latency_ms,
                total_latency_ms=total_ms,
                graph_id=self.session.active_graph_id,
                success=True,
                deliveries_count=len(deliveries),
            )
        except Exception as e:
            logger.warning(f"[JarvisCore] Falha ao registrar métricas: {e}")

        # ── 8. Emite resposta para o frontend ─────────────────────────────
        await self._broadcast("response", {
            "text": final_response,
            "partial": False,
            "interaction_id": interaction_id,
            "mode": plan_result.mode,
            "total_latency_ms": total_ms,
        })

        if deliveries:
            for delivery_url in deliveries:
                await self._broadcast("delivery", {
                    "url": delivery_url,
                    "graph_id": self.session.active_graph_id,
                })

        logger.info(
            f"[JarvisCore] [{interaction_id}] Concluído em {total_ms:.0f}ms "
            f"(modo: {plan_result.mode})"
        )

        return final_response

    # ── Estado do Orb ─────────────────────────────────────────────────────

    async def _set_orb_state(self, state: OrbState):
        if self.session.orb_state != state:
            self.session.orb_state = state
            await self._broadcast("orb_state", {"state": state})
            logger.debug(f"[JarvisCore] Orb → {state}")

    async def set_listening(self):
        await self._set_orb_state("listening")

    async def set_idle(self):
        await self._set_orb_state("idle")

    async def set_error(self, message: str = ""):
        await self._set_orb_state("error")
        if message:
            await self._broadcast("error", {"message": message})

    # ── Gerenciamento de sessão ───────────────────────────────────────────

    def new_session(self) -> str:
        """Inicia uma nova sessão de interação."""
        self.session = JarvisSession()
        logger.info(f"[JarvisCore] Nova sessão: {self.session.session_id}")
        return self.session.session_id

    def get_session_info(self) -> dict:
        return {
            "session_id": self.session.session_id,
            "started_at": self.session.started_at.isoformat(),
            "message_count": len(self.session.history),
            "orb_state": self.session.orb_state,
            "active_graph_id": self.session.active_graph_id,
        }

    # ── Registro de broadcaster de WS ────────────────────────────────────

    def set_ws_broadcaster(self, broadcaster: WSEventCallback):
        """Atualiza o callback de eventos WebSocket em runtime."""
        self._broadcast = broadcaster
        # Propaga para o task graph engine também
        if hasattr(self.graph_engine, "_emit"):
            self.graph_engine._emit = broadcaster

    # ── Helpers ───────────────────────────────────────────────────────────

    @staticmethod
    async def _noop(event_type: str, payload: dict) -> None:
        pass
