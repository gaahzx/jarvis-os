"""
backend/core/task_graph_engine.py

Motor de execução de grafos de tarefas (DAG).
- Ordena nós topologicamente
- Executa nós sequencialmente ou em paralelo (quando sem dependências)
- Propaga resultados de nós pai para nós filho
- Emite eventos de progresso via callback
"""

import asyncio
import logging
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine

from backend.core.claude_client import PlanningResponse, TaskNodeSchema

logger = logging.getLogger(__name__)


@dataclass
class NodeResult:
    node_id: str
    node_label: str
    agent: str | None
    status: str          # "pending" | "running" | "success" | "error"
    result: str = ""
    artifacts: list[str] = field(default_factory=list)
    error: str = ""
    duration_ms: float = 0.0
    started_at: float = field(default_factory=time.monotonic)


@dataclass
class GraphExecutionResult:
    graph_id: str
    status: str              # "success" | "partial" | "error"
    nodes: list[NodeResult]
    total_duration_ms: float
    deliveries: list[str] = field(default_factory=list)


# Tipo do callback de eventos
EventCallback = Callable[[str, dict], Coroutine[Any, Any, None]]


class TaskGraphEngine:
    """
    Executa um TaskGraph (DAG) recebido do Planner.
    Usa o AgentRouter para despachar cada nó ao agente correto.
    """

    def __init__(self, agent_router, event_callback: EventCallback | None = None):
        """
        agent_router : instância de AgentRouter
        event_callback : async def callback(event_type: str, payload: dict)
        """
        self.agent_router = agent_router
        self._emit = event_callback or self._noop_callback

    # ── Ponto de entrada ──────────────────────────────────────────────────

    async def execute(self, plan: PlanningResponse) -> GraphExecutionResult:
        """Executa o grafo completo e retorna os resultados."""
        t0 = time.monotonic()
        graph_id = plan.graph_id or str(uuid.uuid4())

        logger.info(f"[TaskGraphEngine] Iniciando execução grafo {graph_id}")
        await self._emit("graph_start", {"graph_id": graph_id, "node_count": len(plan.nodes)})

        # Indexa nós
        node_map: dict[str, TaskNodeSchema] = {n.id: n for n in plan.nodes}
        results: dict[str, NodeResult] = {
            n.id: NodeResult(
                node_id=n.id,
                node_label=n.label,
                agent=n.agent,
                status="pending",
            )
            for n in plan.nodes
        }

        # Ordena topologicamente
        execution_order = self._topological_sort(plan)
        if execution_order is None:
            logger.error("[TaskGraphEngine] Ciclo detectado no grafo!")
            return GraphExecutionResult(
                graph_id=graph_id,
                status="error",
                nodes=list(results.values()),
                total_duration_ms=(time.monotonic() - t0) * 1000,
            )

        # Identifica grupos paralelos (nós sem dependência entre si)
        parallel_groups = self._build_parallel_groups(execution_order, plan)

        # Executa grupo a grupo
        all_deliveries: list[str] = []
        for group in parallel_groups:
            group_tasks = [
                self._execute_node(
                    node_map[node_id],
                    results,
                    plan,
                    graph_id,
                )
                for node_id in group
            ]
            group_results = await asyncio.gather(*group_tasks, return_exceptions=True)

            # Processa exceções não capturadas
            for i, res in enumerate(group_results):
                if isinstance(res, Exception):
                    node_id = group[i]
                    results[node_id].status = "error"
                    results[node_id].error = str(res)
                    logger.error(f"[TaskGraphEngine] Nó {node_id} falhou: {res}")

            # Coleta deliveries
            for node_id in group:
                all_deliveries.extend(results[node_id].artifacts)

        total_ms = (time.monotonic() - t0) * 1000
        any_error = any(r.status == "error" for r in results.values())
        all_success = all(r.status == "success" for r in results.values())
        status = "success" if all_success else ("partial" if not any_error else "error")

        await self._emit("graph_complete", {
            "graph_id": graph_id,
            "status": status,
            "total_duration_ms": total_ms,
            "deliveries": all_deliveries,
        })

        logger.info(f"[TaskGraphEngine] Grafo {graph_id} concluído: {status} em {total_ms:.0f}ms")
        return GraphExecutionResult(
            graph_id=graph_id,
            status=status,
            nodes=list(results.values()),
            total_duration_ms=total_ms,
            deliveries=all_deliveries,
        )

    # ── Execução de nó individual ─────────────────────────────────────────

    async def _execute_node(
        self,
        node: TaskNodeSchema,
        results: dict[str, NodeResult],
        plan: PlanningResponse,
        graph_id: str,
    ) -> None:
        """Executa um único nó e armazena o resultado."""
        node_result = results[node.id]
        node_result.status = "running"
        node_result.started_at = time.monotonic()

        await self._emit("node_start", {
            "graph_id": graph_id,
            "node_id": node.id,
            "node_label": node.label,
            "agent": node.agent,
        })

        # Coleta resultados dos nós pai
        parent_ids = [e.source for e in plan.edges if e.target == node.id]
        parent_results = [
            {
                "node_id": pid,
                "node_label": results[pid].node_label,
                "result": results[pid].result,
                "artifacts": results[pid].artifacts,
            }
            for pid in parent_ids
            if results.get(pid) and results[pid].status == "success"
        ]

        try:
            agent_result = await self.agent_router.dispatch(
                node_id=node.id,
                agent_name=node.agent or "writer",
                task_description=node.label,
                params=node.params,
                parent_results=parent_results,
                graph_id=graph_id,
            )
            node_result.status = "success"
            node_result.result = agent_result.get("result", "")
            node_result.artifacts = agent_result.get("artifacts", [])
            node_result.duration_ms = (time.monotonic() - node_result.started_at) * 1000

            await self._emit("node_complete", {
                "graph_id": graph_id,
                "node_id": node.id,
                "node_label": node.label,
                "status": "success",
                "duration_ms": node_result.duration_ms,
                "has_artifacts": len(node_result.artifacts) > 0,
            })
            logger.info(
                f"[TaskGraphEngine] Nó '{node.label}' concluído em {node_result.duration_ms:.0f}ms"
            )

        except Exception as e:
            node_result.status = "error"
            node_result.error = str(e)
            node_result.duration_ms = (time.monotonic() - node_result.started_at) * 1000
            await self._emit("node_error", {
                "graph_id": graph_id,
                "node_id": node.id,
                "node_label": node.label,
                "error": str(e),
            })
            logger.error(f"[TaskGraphEngine] Nó '{node.label}' falhou: {e}", exc_info=True)

    # ── Ordenação topológica (Kahn's algorithm) ───────────────────────────

    def _topological_sort(self, plan: PlanningResponse) -> list[str] | None:
        """Retorna lista de IDs de nós em ordem topológica. None se houver ciclo."""
        in_degree: dict[str, int] = defaultdict(int)
        adjacency: dict[str, list[str]] = defaultdict(list)

        node_ids = {n.id for n in plan.nodes}
        for edge in plan.edges:
            if edge.source in node_ids and edge.target in node_ids:
                adjacency[edge.source].append(edge.target)
                in_degree[edge.target] += 1

        # Nós sem dependências
        queue = deque([nid for nid in node_ids if in_degree[nid] == 0])
        order = []

        while queue:
            node = queue.popleft()
            order.append(node)
            for neighbor in adjacency[node]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if len(order) != len(node_ids):
            return None  # Ciclo detectado

        return order

    def _build_parallel_groups(
        self, order: list[str], plan: PlanningResponse
    ) -> list[list[str]]:
        """
        Agrupa nós que podem executar em paralelo (mesmo nível no DAG).
        Nós com as mesmas dependências já satisfeitas ficam no mesmo grupo.
        """
        in_degree: dict[str, int] = defaultdict(int)
        adjacency: dict[str, list[str]] = defaultdict(list)
        node_ids = {n.id for n in plan.nodes}

        for edge in plan.edges:
            if edge.source in node_ids and edge.target in node_ids:
                adjacency[edge.source].append(edge.target)
                in_degree[edge.target] += 1

        groups: list[list[str]] = []
        remaining = set(node_ids)
        completed: set[str] = set()

        while remaining:
            # Nós prontos: todos os pais já concluídos
            ready = [
                nid for nid in remaining
                if all(
                    e.source in completed
                    for e in plan.edges
                    if e.target == nid and e.source in node_ids
                )
            ]
            if not ready:
                # Fallback: executa um por vez para evitar deadlock
                ready = [next(iter(remaining))]
            groups.append(ready)
            for nid in ready:
                remaining.discard(nid)
                completed.add(nid)

        return groups

    # ── Helpers ───────────────────────────────────────────────────────────

    @staticmethod
    async def _noop_callback(event_type: str, payload: dict) -> None:
        pass
