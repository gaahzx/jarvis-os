"""
backend/core/planner.py

Planejador de tarefas: decide se usa Claude diretamente
ou decompõe em um TaskGraph para o motor de execução.
"""

import logging
import time
from typing import Literal

from backend.core.claude_client import ClaudeClient, PlanningResponse

logger = logging.getLogger(__name__)


# Palavras-chave que indicam tarefas complexas → planning mode
COMPLEXITY_SIGNALS = [
    "relatório", "análise", "pesquisa", "pesquise", "analise",
    "gere", "crie", "escreva", "documento", "pdf", "markdown",
    "compare", "estude", "investigue", "implemente", "programe",
    "resume", "resuma", "liste os passos", "passo a passo",
    "report", "analyze", "research", "generate", "create", "write",
    "document", "compare", "study", "implement",
]


class PlanResult:
    """Resultado do planejamento."""
    def __init__(
        self,
        mode: Literal["conversational", "planning", "execution"],
        response_text: str | None = None,
        plan: PlanningResponse | None = None,
        reasoning: str = "",
        latency_ms: float = 0,
    ):
        self.mode = mode
        self.response_text = response_text  # preenchido se mode=conversational
        self.plan = plan                    # preenchido se mode=planning
        self.reasoning = reasoning
        self.latency_ms = latency_ms


class Planner:
    def __init__(self, claude: ClaudeClient):
        self.claude = claude

    def _estimate_complexity(self, text: str) -> bool:
        """
        Heurística rápida (local, sem chamada de API) para pré-classificar
        como complexo. Se True, provavelmente precisa de planning.
        """
        lower = text.lower()
        return any(signal in lower for signal in COMPLEXITY_SIGNALS)

    async def plan(
        self,
        user_input: str,
        history: list[dict],
        memory_context: list[dict] | None = None,
        force_mode: Literal["conversational", "planning", "execution"] | None = None,
    ) -> PlanResult:
        """
        Ponto de entrada principal do planejador.

        1. Pré-filtra por heurística local (rápida)
        2. Se necessário, consulta Claude para decisão de modo
        3. Executa o modo adequado
        """
        t0 = time.monotonic()

        # ── Modo forçado (para testes / subtarefas internas) ──────────────
        if force_mode:
            mode = force_mode
            reasoning = f"Modo forçado externamente: {force_mode}"
            logger.debug(f"[Planner] Modo forçado: {mode}")
        else:
            # ── Decisão de modo via Claude (se input é complexo) ──────────
            if self._estimate_complexity(user_input):
                decision = await self.claude.decide_mode(user_input, history)
                mode = decision.get("mode", "conversational")
                reasoning = decision.get("reasoning", "")
                logger.info(f"[Planner] Claude decidiu modo: {mode} — {reasoning}")
            else:
                mode = "conversational"
                reasoning = "Heurística local: tarefa simples, sem agentes."
                logger.debug(f"[Planner] Heurística: conversacional direto.")

        # ── Executa conforme o modo ───────────────────────────────────────
        if mode == "planning":
            plan = await self.claude.plan(user_input, history, memory_context)
            latency = (time.monotonic() - t0) * 1000
            logger.info(
                f"[Planner] Plano gerado: {len(plan.nodes)} nós, "
                f"{len(plan.edges)} arestas. Latência: {latency:.0f}ms"
            )
            return PlanResult(
                mode="planning",
                plan=plan,
                reasoning=reasoning,
                latency_ms=latency,
            )

        elif mode == "execution":
            result = await self.claude.execute_task(
                user_input, context={}, parent_results=[]
            )
            latency = (time.monotonic() - t0) * 1000
            return PlanResult(
                mode="execution",
                response_text=result.result,
                reasoning=reasoning,
                latency_ms=latency,
            )

        else:  # conversational
            text = await self.claude.conversational(user_input, history, memory_context)
            latency = (time.monotonic() - t0) * 1000
            return PlanResult(
                mode="conversational",
                response_text=text,
                reasoning=reasoning,
                latency_ms=latency,
            )
