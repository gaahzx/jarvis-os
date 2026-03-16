"""
backend/memory/memory_manager.py

Gerência a memória contextual do JARVIS:
- Histórico de conversas (tabela: conversations)
- Memória vetorial com pgvector (tabela: memory)
- Busca semântica por contexto relevante
"""

import logging
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 384  # all-MiniLM-L6-v2


class MemoryManager:
    def __init__(self, supabase_client):
        self.supabase = supabase_client
        self._embedder = None  # lazy-loaded

    async def initialize(self):
        """Inicializa o modelo de embeddings (lazy, não bloqueia o startup)."""
        try:
            from sentence_transformers import SentenceTransformer
            import os
            model_name = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
            self._embedder = SentenceTransformer(model_name)
            logger.info(f"[MemoryManager] Embedder carregado: {model_name}")
        except ImportError:
            logger.warning(
                "[MemoryManager] sentence-transformers não instalado. "
                "Busca semântica desabilitada."
            )
        except Exception as e:
            logger.warning(f"[MemoryManager] Falha ao carregar embedder: {e}")

    # ── Embeddings ────────────────────────────────────────────────────────

    def _embed(self, text: str) -> list[float] | None:
        if self._embedder is None:
            return None
        try:
            embedding = self._embedder.encode(text, normalize_embeddings=True)
            return embedding.tolist()
        except Exception as e:
            logger.warning(f"[MemoryManager] Falha ao gerar embedding: {e}")
            return None

    # ── Armazenamento de conversa ─────────────────────────────────────────

    async def store_conversation(
        self,
        session_id: str,
        user_input: str,
        assistant_response: str,
        mode: str,
        graph_id: str | None = None,
    ) -> str:
        """Salva uma troca de conversa na tabela conversations."""
        record_id = str(uuid.uuid4())
        record = {
            "id": record_id,
            "session_id": session_id,
            "user_input": user_input,
            "assistant_response": assistant_response,
            "mode": mode,
            "graph_id": graph_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await self.supabase.insert("conversations", record)
        return record_id

    async def get_conversation_history(
        self,
        session_id: str,
        limit: int = 20,
    ) -> list[dict]:
        """Retorna histórico de conversas de uma sessão."""
        records = await self.supabase.query(
            table="conversations",
            filters={"session_id": session_id},
            order_by="created_at",
            descending=False,
            limit=limit,
        )
        # Converte para formato de histórico Claude
        history = []
        for r in records:
            history.append({"role": "user", "content": r["user_input"]})
            history.append({"role": "assistant", "content": r["assistant_response"]})
        return history

    # ── Memória vetorial ──────────────────────────────────────────────────

    async def embed_and_store(self, text: str, metadata: dict) -> str | None:
        """Gera embedding e armazena na memória vetorial."""
        embedding = self._embed(text)
        if embedding is None:
            return None

        record_id = str(uuid.uuid4())
        record = {
            "id": record_id,
            "text": text,
            "embedding": embedding,
            "metadata": metadata,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await self.supabase.insert("memory", record)
        return record_id

    async def search(self, query: str, limit: int = 5) -> list[dict]:
        """
        Busca semântica na memória.
        Retorna lista de {"text": ..., "metadata": ..., "similarity": ...}
        """
        embedding = self._embed(query)
        if embedding is None:
            # Fallback: retorna memórias recentes
            records = await self.supabase.query(
                table="memory",
                order_by="created_at",
                descending=True,
                limit=limit,
            )
            return [{"text": r.get("text", ""), "metadata": r.get("metadata", {})} for r in records]

        results = await self.supabase.vector_search(
            table="memory",
            embedding_column="embedding",
            query_embedding=embedding,
            limit=limit,
            match_threshold=0.6,
        )
        return results

    async def clear_session_memory(self, session_id: str):
        """Remove memórias de uma sessão específica."""
        records = await self.supabase.query(
            table="memory",
            filters={},
            limit=1000,
        )
        for r in records:
            meta = r.get("metadata", {})
            if meta.get("session_id") == session_id:
                await self.supabase.delete("memory", r["id"])
