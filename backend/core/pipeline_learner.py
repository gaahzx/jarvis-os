"""
backend/core/pipeline_learner.py

Analisa métricas históricas para identificar pipelines eficientes
e gerar recomendações de melhoria para o sistema.

Estratégias de aprendizado:
  1. Identifica o modo com melhor taxa sucesso + feedback positivo
  2. Detecta agentes com alto tempo de execução
  3. Gera recomendações acionáveis
  4. Detecta padrões de falha recorrentes
"""

import logging
from collections import defaultdict

logger = logging.getLogger(__name__)


class PipelineLearner:
    def __init__(self, supabase_client):
        self.supabase = supabase_client

    # ── Análise principal ──────────────────────────────────────

    async def analyze_efficient_pipelines(self) -> dict:
        """
        Analisa os pipelines executados e identifica os mais eficientes.
        Retorna análise por modo + recomendações.
        """
        try:
            metrics = await self.supabase.query(
                table="task_metrics",
                order_by="created_at",
                descending=True,
                limit=500,
            )
            feedback = await self.supabase.query(
                table="task_feedback",
                order_by="created_at",
                descending=True,
                limit=500,
            )
        except Exception as e:
            logger.warning(f"[PipelineLearner] Falha ao buscar dados: {e}")
            return {"error": str(e)}

        if not metrics:
            return {"message": "Dados insuficientes para análise."}

        # Mapeia feedback por interaction_id
        feedback_map: dict[str, str] = {
            f["interaction_id"]: f["feedback"]
            for f in feedback
            if "interaction_id" in f
        }

        # Agrupa métricas por modo
        by_mode: dict[str, list[dict]] = defaultdict(list)
        for m in metrics:
            mode = m.get("mode", "unknown")
            by_mode[mode].append(m)

        # Analisa cada modo
        analysis: dict[str, dict] = {}
        for mode, records in by_mode.items():
            latencies = [r["total_latency_ms"] for r in records if r.get("total_latency_ms")]
            successes = [r for r in records if r.get("success", True)]
            positives = [
                r for r in records
                if feedback_map.get(r.get("interaction_id", "")) == "positive"
            ]
            negatives = [
                r for r in records
                if feedback_map.get(r.get("interaction_id", "")) == "negative"
            ]

            analysis[mode] = {
                "count": len(records),
                "success_rate": round(len(successes) / len(records) * 100, 1) if records else 0,
                "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else 0,
                "min_latency_ms": round(min(latencies), 1) if latencies else 0,
                "max_latency_ms": round(max(latencies), 1) if latencies else 0,
                "positive_feedback_count": len(positives),
                "negative_feedback_count": len(negatives),
                "positive_feedback_rate": round(
                    len(positives) / len(records) * 100, 1
                ) if records else 0,
                "feedback_total": len(positives) + len(negatives),
            }

        # Score de eficiência ponderado
        def efficiency_score(stats: dict) -> float:
            return (
                stats["success_rate"] * 0.40
                + stats["positive_feedback_rate"] * 0.35
                + max(0.0, 100.0 - stats["avg_latency_ms"] / 50.0) * 0.25
            )

        scored = {mode: efficiency_score(stats) for mode, stats in analysis.items()}
        best_mode = max(scored, key=scored.get) if scored else None

        return {
            "by_mode": analysis,
            "efficiency_scores": {m: round(s, 1) for m, s in scored.items()},
            "best_mode": best_mode,
            "recommendations": self._generate_recommendations(analysis),
            "total_analyzed": len(metrics),
        }

    # ── Recomendações ──────────────────────────────────────────

    def _generate_recommendations(self, analysis: dict) -> list[dict]:
        """Gera recomendações acionáveis baseadas na análise."""
        recommendations: list[dict] = []

        conv = analysis.get("conversational", {})
        planning = analysis.get("planning", {})
        execution = analysis.get("execution", {})

        # Latência alta no modo conversacional
        if conv.get("avg_latency_ms", 0) > 3000:
            recommendations.append({
                "severity": "warning",
                "area": "conversational",
                "message": "Latência média conversacional acima de 3s.",
                "action": "Reduza o histórico de contexto ou use modelo menor.",
            })

        # Taxa de sucesso baixa no planning
        if planning.get("success_rate", 100) < 80 and planning.get("count", 0) > 5:
            recommendations.append({
                "severity": "critical",
                "area": "planning",
                "message": f"Taxa de sucesso no planning: {planning.get('success_rate')}%",
                "action": "Revisar prompts do Planner e dos Agentes. Verificar logs de erro.",
            })

        # Feedback negativo alto
        if planning.get("positive_feedback_rate", 100) < 60 and planning.get("feedback_total", 0) > 5:
            recommendations.append({
                "severity": "warning",
                "area": "planning",
                "message": f"Satisfação no planning: {planning.get('positive_feedback_rate')}%",
                "action": "Adicionar etapa de revisão antes da entrega final.",
            })

        # Latência muito alta no planning
        if planning.get("avg_latency_ms", 0) > 15000:
            recommendations.append({
                "severity": "warning",
                "area": "planning",
                "message": f"Planning demorado: {planning.get('avg_latency_ms')}ms em média.",
                "action": "Limitar o número de nós no grafo ou paralelizar mais agentes.",
            })

        # Sistema saudável
        if not recommendations:
            recommendations.append({
                "severity": "info",
                "area": "system",
                "message": "Sistema operando dentro dos parâmetros ideais.",
                "action": "Nenhuma ação necessária.",
            })

        return recommendations

    # ── Análise de agentes ─────────────────────────────────────

    async def get_agent_performance(self) -> dict:
        """
        Analisa performance por agente usando a tabela tasks.
        Retorna latência média e taxa de sucesso por agente.
        """
        try:
            records = await self.supabase.query(
                table="tasks",
                order_by="created_at",
                descending=True,
                limit=500,
            )
        except Exception as e:
            return {"error": str(e)}

        by_agent: dict[str, list[dict]] = defaultdict(list)
        for r in records:
            agent = r.get("agent_name")
            if agent:
                by_agent[agent].append(r)

        result: dict[str, dict] = {}
        for agent, agent_records in by_agent.items():
            durations = [r["duration_ms"] for r in agent_records if r.get("duration_ms")]
            successes = [r for r in agent_records if r.get("status") == "success"]
            result[agent] = {
                "total_executions": len(agent_records),
                "success_count": len(successes),
                "success_rate": round(len(successes) / len(agent_records) * 100, 1) if agent_records else 0,
                "avg_duration_ms": round(sum(durations) / len(durations), 1) if durations else 0,
                "max_duration_ms": round(max(durations), 1) if durations else 0,
            }

        return result

    # ── Detecção de padrões de falha ───────────────────────────

    async def get_failure_patterns(self, limit: int = 50) -> list[dict]:
        """Identifica padrões de erro recorrentes."""
        try:
            records = await self.supabase.query(
                table="task_metrics",
                filters={"success": False},
                order_by="created_at",
                descending=True,
                limit=limit,
            )
        except Exception as e:
            return []

        # Agrupa por mensagem de erro
        error_groups: dict[str, int] = defaultdict(int)
        for r in records:
            err = r.get("error_message", "erro desconhecido")
            # Normaliza erros similares
            key = err[:80] if err else "sem mensagem"
            error_groups[key] += 1

        return [
            {"error": err, "count": count}
            for err, count in sorted(error_groups.items(), key=lambda x: -x[1])
        ]

    async def get_slow_interactions(
        self, threshold_ms: float = 5000, limit: int = 10
    ) -> list[dict]:
        """Retorna as interações mais lentas para análise."""
        try:
            records = await self.supabase.query(
                table="task_metrics",
                order_by="total_latency_ms",
                descending=True,
                limit=limit,
            )
            return [r for r in records if r.get("total_latency_ms", 0) > threshold_ms]
        except Exception as e:
            logger.warning(f"[PipelineLearner] Falha: {e}")
            return []
