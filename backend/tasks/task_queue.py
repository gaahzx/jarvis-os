"""
backend/tasks/task_queue.py

Fila assíncrona de tarefas para processamento em background.
Permite enfileirar tarefas longas sem bloquear o loop de voz ou o WebSocket.
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Coroutine

logger = logging.getLogger(__name__)


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"
    CANCELLED = "cancelled"


@dataclass
class QueuedTask:
    task_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""
    coroutine: Any = None
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: datetime | None = None
    completed_at: datetime | None = None
    result: Any = None
    error: str | None = None


class TaskQueue:
    """
    Fila FIFO assíncrona com capacidade configurável.
    Usa asyncio.Queue internamente.
    """

    def __init__(self, max_workers: int = 3, max_queue_size: int = 50):
        self._queue: asyncio.Queue[QueuedTask] = asyncio.Queue(maxsize=max_queue_size)
        self._tasks: dict[str, QueuedTask] = {}
        self._max_workers = max_workers
        self._workers: list[asyncio.Task] = []
        self._running = False

    async def start(self):
        """Inicia os workers da fila."""
        if self._running:
            return
        self._running = True
        for i in range(self._max_workers):
            worker = asyncio.create_task(self._worker(f"worker-{i}"))
            self._workers.append(worker)
        logger.info(f"[TaskQueue] Iniciado com {self._max_workers} workers.")

    async def stop(self):
        """Aguarda tarefas em execução e para os workers."""
        self._running = False
        for worker in self._workers:
            worker.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()
        logger.info("[TaskQueue] Parado.")

    async def enqueue(
        self,
        coro: Coroutine,
        name: str = "task",
    ) -> QueuedTask:
        """Enfileira uma coroutine para execução."""
        task = QueuedTask(name=name, coroutine=coro)
        self._tasks[task.task_id] = task
        await self._queue.put(task)
        logger.debug(f"[TaskQueue] Enfileirado: {name} ({task.task_id})")
        return task

    def get_task(self, task_id: str) -> QueuedTask | None:
        return self._tasks.get(task_id)

    def list_tasks(self, status: TaskStatus | None = None) -> list[QueuedTask]:
        tasks = list(self._tasks.values())
        if status:
            tasks = [t for t in tasks if t.status == status]
        return sorted(tasks, key=lambda t: t.created_at, reverse=True)

    async def _worker(self, worker_id: str):
        """Loop de processamento de um worker."""
        while self._running:
            try:
                task = await asyncio.wait_for(self._queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            task.status = TaskStatus.RUNNING
            task.started_at = datetime.now(timezone.utc)
            logger.info(f"[TaskQueue] [{worker_id}] Executando: {task.name}")

            try:
                task.result = await task.coroutine
                task.status = TaskStatus.SUCCESS
            except asyncio.CancelledError:
                task.status = TaskStatus.CANCELLED
            except Exception as e:
                task.status = TaskStatus.ERROR
                task.error = str(e)
                logger.error(f"[TaskQueue] [{worker_id}] Erro em '{task.name}': {e}")
            finally:
                task.completed_at = datetime.now(timezone.utc)
                self._queue.task_done()

    @property
    def size(self) -> int:
        return self._queue.qsize()

    @property
    def is_running(self) -> bool:
        return self._running
