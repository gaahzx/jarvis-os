"""
backend/core/self_improvement.py

Coleta e persiste métricas de desempenho de cada interação.
Tabela: task_metrics

Métricas coletadas por interação:
  - Latência total e por etapa (planner, graph, tts)
  - Modo de operação (conversational / planning / execution)
  - Número de agentes acionados
  - Sucesso / falha
  - Quantidade de entregas geradas
"""

import logging
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


class SelfImprovement:
    def __init__(self, supabase_client):
        self.supabase = supabase_client

    # ── Registro de métricas ───────────────────────────────────

    async def record_metric(
        self,
        interaction_id: str,
        session_id: str,
        user_input: str,
        mode: str,
        planner_latency_ms: float,
        total_latency_ms: float,
        graph_id: str | None = None,
        success: bool = True,
        deliveries_count: int = 0,
        agent_count: int = 0,
        error_message: str | None = None,
    ):
        """Registra métricas de uma interação no banco."""
        record = {
            "id": str(uuid.uuid4()),
            "interaction_id": interaction_id,
            "session_id": session_id,
            "user_input_length": len(user_input),
            "mode": mode,
            "planner_latency_ms": round(planner_latency_ms, 2),
            "total_latency_ms": round(total_latency_ms, 2),
            "graph_id": graph_id,
            "success": success,
            "deliveries_count": deliveries_count,
            "agent_count": agent_count,
            "error_message": error_message,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            await self.supabase.insert("task_metrics", record)
            logger.debug(
                f"[SelfImprovement] Métrica registrada: {interaction_id} "
                f"({mode}, {total_latency_ms:.0f}ms, sucesso={success})"
            )
        except Exception as e:
            logger.warning(f"[SelfImprovement] Falha ao registrar métrica: {e}")

    # ── Registro de feedback ───────────────────────────────────

    async def record_feedback(
        self,
        interaction_id: str,
        session_id: str,
        feedback: str,           # "positive" | "negative"
        comment: str | None = None,
    ):
        """Registra feedback do usuário (👍/👎)."""
        if feedback not in ("positive", "negative"):
            logger.warning(f"[SelfImprovement] Feedback inválido: {feedback}")
            return

        record = {
            "id": str(uuid.uuid4()),
            "interaction_id": interaction_id,
            "session_id": session_id,
            "feedback": feedback,
            "comment": comment,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            await self.supabase.insert("task_feedback", record)
            logger.info(
                f"[SelfImprovement] Feedback '{feedback}' registrado "
                f"para interação {interaction_id}"
            )
        except Exception as e:
            logger.warning(f"[SelfImprovement] Falha ao registrar feedback: {e}")

    # ── Resumo de performance ──────────────────────────────────

    async def get_performance_summary(self, limit: int = 200) -> dict:
        """
        Retorna resumo estatístico das últimas interações.
        Usado pelo endpoint /api/metrics.
        """
        try:
            records = await self.supabase.query(
                table="task_metrics",
                order_by="created_at",
                descending=True,
                limit=limit,
            )
        except Exception as e:
            logger.warning(f"[SelfImprovement] Falha ao buscar métricas: {e}")
            return {"total": 0, "error": str(e)}

        if not records:
            return {"total": 0}

        total = len(records)
        success_count = sum(1 for r in records if r.get("success", True))
        latencies = [r["total_latency_ms"] for r in records if r.get("total_latency_ms")]
        planner_latencies = [r["planner_latency_ms"] for r in records if r.get("planner_latency_ms")]

        # Distribuição por modo
        mode_counts: dict[str, int] = {}
        for r in records:
            m = r.get("mode", "unknown")
            mode_counts[m] = mode_counts.get(m, 0) + 1

        # Interações mais recentes
        recent = records[:5]

        return {
            "total": total,
            "success_rate": round(success_count / total * 100, 1),
            "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else 0,
            "min_latency_ms": round(min(latencies), 1) if latencies else 0,
            "max_latency_ms": round(max(latencies), 1) if latencies else 0,
            "p95_latency_ms": round(sorted(latencies)[int(len(latencies) * 0.95)], 1) if len(latencies) >= 20 else None,
            "avg_planner_latency_ms": round(sum(planner_latencies) / len(planner_latencies), 1) if planner_latencies else 0,
            "mode_distribution": mode_counts,
            "total_deliveries": sum(r.get("deliveries_count", 0) for r in records),
            "recent_interactions": [
                {
                    "interaction_id": r.get("interaction_id"),
                    "mode": r.get("mode"),
                    "total_latency_ms": r.get("total_latency_ms"),
                    "success": r.get("success"),
                    "created_at": r.get("created_at"),
                }
                for r in recent
            ],
        }

    async def get_feedback_summary(self) -> dict:
        """Retorna sumário do feedback dos usuários."""
        try:
            records = await self.supabase.query(
                table="task_feedback",
                order_by="created_at",
                descending=True,
                limit=500,
            )
        except Exception as e:
            return {"total": 0, "error": str(e)}

        if not records:
            return {"total": 0, "positive": 0, "negative": 0, "satisfaction_rate": None}

        total = len(records)
        positive = sum(1 for r in records if r.get("feedback") == "positive")
        negative = total - positive

        return {
            "total": total,
            "positive": positive,
            "negative": negative,
            "satisfaction_rate": round(positive / total * 100, 1),
        }

    async def get_slow_interactions(
        self, threshold_ms: float = 5000, limit: int = 10
    ) -> list[dict]:
        """Retorna interações acima do threshold para debugging."""
        try:
            records = await self.supabase.query(
                table="task_metrics",
                order_by="total_latency_ms",
                descending=True,
                limit=limit,
            )
            return [r for r in records if r.get("total_latency_ms", 0) > threshold_ms]
        except Exception as e:
            logger.warning(f"[SelfImprovement] Falha ao buscar interações lentas: {e}")
            return []

    async def get_error_rate_by_mode(self) -> dict:
        """Retorna taxa de erro por modo de operação."""
        try:
            records = await self.supabase.query(
                table="task_metrics",
                order_by="created_at",
                descending=True,
                limit=500,
            )
        except Exception:
            return {}

        by_mode: dict[str, dict] = {}
        for r in records:
            mode = r.get("mode", "unknown")
            if mode not in by_mode:
                by_mode[mode] = {"total": 0, "errors": 0}
            by_mode[mode]["total"] += 1
            if not r.get("success", True):
                by_mode[mode]["errors"] += 1

        return {
            mode: {
                "total": v["total"],
                "error_count": v["errors"],
                "error_rate": round(v["errors"] / v["total"] * 100, 1) if v["total"] else 0,
            }
            for mode, v in by_mode.items()
        }
