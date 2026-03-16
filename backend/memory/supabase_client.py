"""
backend/memory/supabase_client.py

Cliente Supabase com operações genéricas reutilizadas por todos os módulos.
Inclui fallback em memória quando Supabase não está configurado (dev local).
"""

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


class SupabaseClient:
    def __init__(self):
        self.url = os.getenv("SUPABASE_URL", "")
        self.anon_key = os.getenv("SUPABASE_ANON_KEY", "")
        self.service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        self.client = None
        self._in_memory_store: dict[str, list[dict]] = {}
        self._use_memory_fallback = False

        self._connect()

    def _connect(self):
        if not self.url or not self.anon_key:
            logger.warning(
                "[SupabaseClient] Credenciais não configuradas. "
                "Usando armazenamento em memória (dados não persistidos)."
            )
            self._use_memory_fallback = True
            return

        try:
            from supabase import create_client, Client
            key = self.service_key or self.anon_key
            self.client = create_client(self.url, key)
            logger.info("[SupabaseClient] Conectado ao Supabase.")
        except ImportError:
            logger.warning("[SupabaseClient] Pacote 'supabase' não instalado. Usando fallback em memória.")
            self._use_memory_fallback = True
        except Exception as e:
            logger.error(f"[SupabaseClient] Falha na conexão: {e}. Usando fallback em memória.")
            self._use_memory_fallback = True

    # ── Operações genéricas ───────────────────────────────────────────────

    async def insert(self, table: str, record: dict) -> dict:
        if self._use_memory_fallback:
            self._in_memory_store.setdefault(table, []).append(record)
            return record
        try:
            response = self.client.table(table).insert(record).execute()
            return response.data[0] if response.data else record
        except Exception as e:
            logger.error(f"[SupabaseClient] insert({table}): {e}")
            raise

    async def query(
        self,
        table: str,
        filters: dict | None = None,
        order_by: str | None = None,
        descending: bool = False,
        limit: int = 100,
    ) -> list[dict]:
        if self._use_memory_fallback:
            data = self._in_memory_store.get(table, [])
            if filters:
                data = [r for r in data if all(r.get(k) == v for k, v in filters.items())]
            if order_by:
                data = sorted(data, key=lambda r: r.get(order_by, ""), reverse=descending)
            return data[:limit]

        try:
            query = self.client.table(table).select("*")
            if filters:
                for key, value in filters.items():
                    query = query.eq(key, value)
            if order_by:
                query = query.order(order_by, desc=descending)
            query = query.limit(limit)
            response = query.execute()
            return response.data or []
        except Exception as e:
            logger.error(f"[SupabaseClient] query({table}): {e}")
            return []

    async def update(self, table: str, record_id: str, updates: dict) -> dict:
        if self._use_memory_fallback:
            data = self._in_memory_store.get(table, [])
            for r in data:
                if r.get("id") == record_id:
                    r.update(updates)
                    return r
            return updates

        try:
            response = (
                self.client.table(table).update(updates).eq("id", record_id).execute()
            )
            return response.data[0] if response.data else updates
        except Exception as e:
            logger.error(f"[SupabaseClient] update({table}, {record_id}): {e}")
            raise

    async def delete(self, table: str, record_id: str) -> bool:
        if self._use_memory_fallback:
            data = self._in_memory_store.get(table, [])
            original_len = len(data)
            self._in_memory_store[table] = [r for r in data if r.get("id") != record_id]
            return len(self._in_memory_store[table]) < original_len

        try:
            self.client.table(table).delete().eq("id", record_id).execute()
            return True
        except Exception as e:
            logger.error(f"[SupabaseClient] delete({table}, {record_id}): {e}")
            return False

    async def vector_search(
        self,
        table: str,
        embedding_column: str,
        query_embedding: list[float],
        limit: int = 5,
        match_threshold: float = 0.7,
    ) -> list[dict]:
        """Busca semântica via pgvector (requer função RPC no Supabase)."""
        if self._use_memory_fallback:
            # Sem pgvector em modo fallback: retorna os mais recentes
            return (self._in_memory_store.get(table, []))[:limit]

        try:
            response = self.client.rpc(
                "match_memory",
                {
                    "query_embedding": query_embedding,
                    "match_threshold": match_threshold,
                    "match_count": limit,
                },
            ).execute()
            return response.data or []
        except Exception as e:
            logger.warning(f"[SupabaseClient] vector_search: {e}")
            return []

    @property
    def is_connected(self) -> bool:
        return not self._use_memory_fallback and self.client is not None
