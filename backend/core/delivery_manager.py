"""
backend/core/delivery_manager.py

Gerencia o upload e registro de arquivos gerados pelo sistema.
- Upload para Supabase Storage
- Registro na tabela 'deliveries'
- Listagem de entregas por sessão
"""

import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiofiles

logger = logging.getLogger(__name__)


class DeliveryManager:
    def __init__(self, supabase_client):
        self.supabase = supabase_client
        self.bucket_name = "jarvis-deliveries"

    async def upload_and_register(
        self,
        file_path: str,
        graph_id: str,
        node_id: str,
        agent_name: str,
        session_id: str | None = None,
    ) -> str:
        """
        Faz upload do arquivo para Supabase Storage e registra na tabela deliveries.
        Retorna a URL pública do arquivo.
        """
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"Arquivo não encontrado: {file_path}")

        # Define nome do objeto no storage
        delivery_id = str(uuid.uuid4())
        storage_path = f"{graph_id}/{delivery_id}/{path.name}"
        content_type = self._get_content_type(path.suffix)

        # Lê o arquivo
        async with aiofiles.open(file_path, "rb") as f:
            file_bytes = await f.read()

        # Upload para Supabase Storage
        try:
            upload_response = self.supabase.client.storage.from_(self.bucket_name).upload(
                path=storage_path,
                file=file_bytes,
                file_options={"content-type": content_type},
            )
        except Exception as e:
            logger.error(f"[DeliveryManager] Falha no upload: {e}")
            raise

        # Obtém URL pública
        public_url = self.supabase.client.storage.from_(self.bucket_name).get_public_url(
            storage_path
        )

        # Registra no banco
        record = {
            "id": delivery_id,
            "graph_id": graph_id,
            "node_id": node_id,
            "agent_name": agent_name,
            "filename": path.name,
            "file_type": path.suffix.lstrip("."),
            "storage_path": storage_path,
            "public_url": public_url,
            "file_size_bytes": len(file_bytes),
            "session_id": session_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        await self.supabase.insert("deliveries", record)
        logger.info(f"[DeliveryManager] Arquivo entregue: {path.name} → {public_url}")

        # Remove arquivo temporário local
        try:
            os.remove(file_path)
        except OSError:
            pass

        return public_url

    async def list_deliveries(
        self,
        session_id: str | None = None,
        limit: int = 20,
    ) -> list[dict]:
        """Lista entregas recentes, opcionalmente filtradas por sessão."""
        filters = {}
        if session_id:
            filters["session_id"] = session_id

        return await self.supabase.query(
            table="deliveries",
            filters=filters,
            order_by="created_at",
            descending=True,
            limit=limit,
        )

    async def get_delivery(self, delivery_id: str) -> dict | None:
        """Busca uma entrega específica por ID."""
        results = await self.supabase.query(
            table="deliveries",
            filters={"id": delivery_id},
            limit=1,
        )
        return results[0] if results else None

    def _get_content_type(self, suffix: str) -> str:
        types = {
            ".pdf": "application/pdf",
            ".md": "text/markdown",
            ".txt": "text/plain",
            ".json": "application/json",
            ".csv": "text/csv",
            ".html": "text/html",
            ".py": "text/x-python",
        }
        return types.get(suffix.lower(), "application/octet-stream")

    async def ensure_bucket_exists(self):
        """Cria o bucket no Supabase se não existir."""
        try:
            buckets = self.supabase.client.storage.list_buckets()
            existing = [b.name for b in buckets]
            if self.bucket_name not in existing:
                self.supabase.client.storage.create_bucket(
                    self.bucket_name,
                    options={"public": True},
                )
                logger.info(f"[DeliveryManager] Bucket '{self.bucket_name}' criado.")
        except Exception as e:
            logger.warning(f"[DeliveryManager] Não foi possível verificar/criar bucket: {e}")
