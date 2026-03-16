"""
main.py

Entry point do JARVIS OS.
Inicia o servidor FastAPI + o pipeline de voz em paralelo.

Uso:
  python main.py                    → inicia tudo (API + voz)
  python main.py --no-voice         → inicia apenas a API (sem hardware de áudio)
  python main.py --port 8080        → porta customizada
"""

import argparse
import asyncio
import logging
import os
import platform
import sys
from pathlib import Path

# Windows: necessário para asyncio.create_subprocess_exec funcionar com Piper TTS
if platform.system() == "Windows":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

# ── Carrega variáveis de ambiente ──────────────────────────────────────────
from dotenv import load_dotenv

# Procura .env na raiz do projeto
env_path = Path(__file__).parent / ".env"
if env_path.exists():
    load_dotenv(env_path)
else:
    load_dotenv()  # tenta carregar de qualquer .env no cwd

# ── Configuração de logging ────────────────────────────────────────────────
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, log_level, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("jarvis.main")

# Silencia loggers verbosos de dependências
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("anthropic").setLevel(logging.WARNING)
logging.getLogger("faster_whisper").setLevel(logging.WARNING)


def parse_args():
    parser = argparse.ArgumentParser(description="JARVIS OS — AI Personal Assistant")
    parser.add_argument(
        "--no-voice",
        action="store_true",
        help="Inicia sem o pipeline de voz (somente API REST + WebSocket)",
    )
    parser.add_argument(
        "--host",
        default=os.getenv("BACKEND_HOST", "0.0.0.0"),
        help="Host do servidor (padrão: 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("BACKEND_PORT", "8000")),
        help="Porta do servidor (padrão: 8000)",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        default=os.getenv("BACKEND_RELOAD", "false").lower() == "true",
        help="Ativa hot-reload (desenvolvimento)",
    )
    return parser.parse_args()


async def start_voice_pipeline(jarvis_core):
    """Inicia o pipeline de voz em background."""
    try:
        from backend.voice.voice_pipeline import VoicePipeline
        pipeline = VoicePipeline(jarvis_core=jarvis_core)
        logger.info("[Main] Pipeline de voz iniciado.")
        await pipeline.start()
    except ImportError as e:
        logger.warning(f"[Main] Pipeline de voz não disponível: {e}")
    except Exception as e:
        logger.error(f"[Main] Erro no pipeline de voz: {e}", exc_info=True)


def validate_environment():
    """Valida variáveis de ambiente obrigatórias."""
    required = ["ANTHROPIC_API_KEY"]
    missing = [key for key in required if not os.getenv(key)]
    if missing:
        logger.error(f"[Main] Variáveis obrigatórias não definidas: {', '.join(missing)}")
        logger.error("[Main] Copie config/.env.example para .env e preencha os valores.")
        sys.exit(1)

    optional_warnings = {
        "SUPABASE_URL": "Memória persistente desabilitada.",
        "SUPABASE_ANON_KEY": "Memória persistente desabilitada.",
    }
    for key, warning in optional_warnings.items():
        if not os.getenv(key):
            logger.warning(f"[Main] {key} não definida. {warning}")


def main():
    args = parse_args()

    logger.info("=" * 60)
    logger.info("  J.A.R.V.I.S. OS — Iniciando sistema...")
    logger.info("=" * 60)

    validate_environment()

    import uvicorn
    from backend.api.server import app

    uvicorn_config = uvicorn.Config(
        app=app,
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level=log_level.lower(),
        ws_ping_interval=30,
        ws_ping_timeout=10,
    )
    server = uvicorn.Server(uvicorn_config)

    logger.info(f"[Main] Servidor iniciando em http://{args.host}:{args.port}")
    logger.info(f"[Main] WebSocket disponível em ws://{args.host}:{args.port}/ws")

    if args.no_voice:
        logger.info("[Main] Modo sem voz ativado (--no-voice).")
        server.run()
    else:
        logger.info("[Main] Pipeline de voz será iniciado após o servidor.")
        # Uvicorn gerencia seu próprio loop; o pipeline de voz roda após startup
        # via lifespan hook ou em thread separada
        server.run()


if __name__ == "__main__":
    main()
