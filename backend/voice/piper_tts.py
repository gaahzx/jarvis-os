"""
backend/voice/piper_tts.py

Síntese de voz (Text-to-Speech) usando Piper TTS.
- Piper é um binário nativo (não pip) — chamado via subprocess
- Latência alvo: 200-500ms para frases curtas em CPU
- Voz em português brasileiro: pt_BR-faber-medium

Instalação do Piper:
  Linux/Mac: baixado automaticamente pelo scripts/setup.sh
  Windows:   baixado pelo scripts/setup.ps1

Estrutura esperada:
  models/piper/
    piper                           ← binário (Linux) ou piper.exe (Windows)
    pt_BR-faber-medium.onnx
    pt_BR-faber-medium.onnx.json

Download manual:
  https://github.com/rhasspy/piper/releases
  Voz: https://huggingface.co/rhasspy/piper-voices (pt_BR/faber)
"""

import asyncio
import logging
import os
import platform
import subprocess
import tempfile
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Caminhos padrão ───────────────────────────────────────────────────────
_BASE = Path(__file__).parent.parent.parent  # raiz do projeto

PIPER_BINARY = os.getenv(
    "PIPER_BINARY",
    str(_BASE / "models" / "piper" / ("piper.exe" if platform.system() == "Windows" else "piper")),
)
PIPER_MODEL = os.getenv(
    "PIPER_MODEL_PATH",
    str(_BASE / "models" / "piper" / "pt_BR-faber-medium.onnx"),
)
PIPER_CONFIG = os.getenv(
    "PIPER_MODEL_CONFIG",
    str(_BASE / "models" / "piper" / "pt_BR-faber-medium.onnx.json"),
)

# Configurações de saída de áudio
OUTPUT_SAMPLE_RATE = 22050   # Hz — padrão do Piper
OUTPUT_CHANNELS = 1


class PiperTTS:
    """
    Wrapper assíncrono para o binário Piper TTS.
    Converte texto em áudio WAV via subprocess.
    """

    def __init__(
        self,
        binary_path: str = PIPER_BINARY,
        model_path: str = PIPER_MODEL,
        config_path: str = PIPER_CONFIG,
    ):
        self.binary = binary_path
        self.model = model_path
        self.config = config_path
        self._validated = False

    # ── Validação ──────────────────────────────────────────────────────────

    def validate(self) -> bool:
        """Verifica se o Piper e o modelo de voz estão disponíveis."""
        errors = []
        if not Path(self.binary).exists():
            errors.append(f"Binário Piper não encontrado: {self.binary}")
        if not Path(self.model).exists():
            errors.append(f"Modelo de voz não encontrado: {self.model}")
        if not Path(self.config).exists():
            errors.append(f"Config do modelo não encontrada: {self.config}")

        if errors:
            for e in errors:
                logger.warning(f"[PiperTTS] {e}")
            logger.warning(
                "[PiperTTS] TTS desabilitado. Execute scripts/setup.sh (ou setup.ps1) "
                "para baixar o Piper e os modelos de voz."
            )
            return False

        self._validated = True
        logger.info(f"[PiperTTS] Piper disponível: {self.binary}")
        return True

    # ── Síntese ────────────────────────────────────────────────────────────

    async def synthesize(self, text: str) -> bytes | None:
        """
        Converte texto em áudio WAV (bytes).
        Retorna None se Piper não estiver disponível.
        """
        if not self._validated and not self.validate():
            return None

        if not text.strip():
            return None

        # Limpa o texto para síntese (remove markdown, emojis pesados)
        clean = self._clean_text(text)
        if not clean:
            return None

        t0 = time.monotonic()

        try:
            audio_bytes = await self._run_piper(clean)
            elapsed = (time.monotonic() - t0) * 1000
            logger.info(f"[PiperTTS] Sintetizado em {elapsed:.0f}ms ({len(clean)} chars)")
            return audio_bytes
        except Exception as e:
            logger.error(f"[PiperTTS] Erro na síntese: {e}")
            return None

    async def _run_piper(self, text: str) -> bytes:
        """Executa o Piper via subprocess e retorna os bytes WAV."""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            output_path = tmp.name

        # Piper precisa rodar no seu próprio diretório (DLLs co-localizadas)
        piper_dir = str(Path(self.binary).parent)

        cmd = [
            str(Path(self.binary).resolve()),
            "--model",      str(Path(self.model).resolve()),
            "--config",     str(Path(self.config).resolve()),
            "--output_file", output_path,
        ]

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=piper_dir,          # ← executa no diretório do binário
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(input=text.encode("utf-8")),
                timeout=30.0,
            )

            if proc.returncode != 0:
                err = stderr.decode("utf-8", errors="replace")
                raise RuntimeError(f"Piper retornou código {proc.returncode}: {err}")

            with open(output_path, "rb") as f:
                audio_bytes = f.read()

            return audio_bytes

        finally:
            try:
                os.unlink(output_path)
            except OSError:
                pass

    # ── Reprodução de áudio ────────────────────────────────────────────────

    async def speak(self, text: str) -> bool:
        """
        Sintetiza e reproduz o áudio diretamente no speaker.
        Retorna True se a reprodução foi bem-sucedida.
        """
        audio_bytes = await self.synthesize(text)
        if not audio_bytes:
            return False

        return await self._play_audio(audio_bytes)

    async def _play_audio(self, wav_bytes: bytes) -> bool:
        """Reproduz bytes WAV no speaker via sounddevice."""
        try:
            import sounddevice as sd
            import soundfile as sf
            import io

            with io.BytesIO(wav_bytes) as buf:
                data, samplerate = sf.read(buf, dtype="float32")

            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: (sd.play(data, samplerate), sd.wait()),
            )
            return True

        except ImportError:
            # Fallback: reproduz com playsound ou aplay (Linux)
            return await self._play_audio_fallback(wav_bytes)
        except Exception as e:
            logger.error(f"[PiperTTS] Falha na reprodução: {e}")
            return False

    async def _play_audio_fallback(self, wav_bytes: bytes) -> bool:
        """Fallback de reprodução via aplay (Linux) ou ffplay."""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(wav_bytes)
            tmp_path = tmp.name

        try:
            if platform.system() == "Linux":
                player = ["aplay", "-q", tmp_path]
            elif platform.system() == "Darwin":
                player = ["afplay", tmp_path]
            elif platform.system() == "Windows":
                player = ["powershell", "-c", f"(New-Object Media.SoundPlayer '{tmp_path}').PlaySync()"]
            else:
                logger.warning("[PiperTTS] Plataforma sem player de áudio configurado.")
                return False

            proc = await asyncio.create_subprocess_exec(*player)
            await proc.wait()
            return proc.returncode == 0

        except Exception as e:
            logger.error(f"[PiperTTS] Fallback de reprodução falhou: {e}")
            return False
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    # ── Streaming para WebSocket ──────────────────────────────────────────

    async def synthesize_for_stream(self, text: str) -> bytes | None:
        """
        Sintetiza o áudio e retorna os bytes WAV para envio via WebSocket.
        O frontend recebe e reproduz via WebAudio API.
        """
        return await self.synthesize(text)

    # ── Helpers ────────────────────────────────────────────────────────────

    def _clean_text(self, text: str) -> str:
        """
        Limpa o texto para síntese de voz:
        - Remove markdown (**, *, #, `, -)
        - Remove URLs
        - Trunca textos muito longos (TTS tem limite prático ~500 chars/chamada)
        """
        import re

        # Remove markdown
        text = re.sub(r"\*{1,2}([^*]+)\*{1,2}", r"\1", text)  # negrito/itálico
        text = re.sub(r"#{1,6}\s+", "", text)                   # headings
        text = re.sub(r"`{1,3}[^`]*`{1,3}", "", text)          # código
        text = re.sub(r"!\[.*?\]\(.*?\)", "", text)             # imagens
        text = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", text)   # links → texto
        text = re.sub(r"https?://\S+", "link", text)            # URLs simples
        text = re.sub(r"[-•]\s+", "", text)                     # bullets
        text = re.sub(r"\n+", ". ", text)                       # quebras de linha
        text = re.sub(r"\s{2,}", " ", text)                     # espaços múltiplos
        text = text.strip()

        # Trunca se necessário (evita TTS muito longo)
        MAX_CHARS = 600
        if len(text) > MAX_CHARS:
            # Corta na última frase completa antes do limite
            truncated = text[:MAX_CHARS]
            last_period = max(
                truncated.rfind("."),
                truncated.rfind("!"),
                truncated.rfind("?"),
            )
            if last_period > MAX_CHARS // 2:
                text = truncated[:last_period + 1] + " ..."
            else:
                text = truncated + " ..."

        return text

    async def synthesize_chunked(self, text: str, chunk_size: int = 300):
        """
        Sintetiza texto longo em chunks para reduzir latência percebida.
        Yields bytes WAV de cada chunk conforme são gerados.
        """
        import re
        # Divide em sentenças
        sentences = re.split(r"(?<=[.!?])\s+", self._clean_text(text))
        current_chunk = ""

        for sentence in sentences:
            if len(current_chunk) + len(sentence) <= chunk_size:
                current_chunk += sentence + " "
            else:
                if current_chunk.strip():
                    audio = await self.synthesize(current_chunk.strip())
                    if audio:
                        yield audio
                current_chunk = sentence + " "

        if current_chunk.strip():
            audio = await self.synthesize(current_chunk.strip())
            if audio:
                yield audio
