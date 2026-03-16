"""
backend/voice/voice_pipeline.py

Orquestrador do pipeline completo de voz do JARVIS OS.

Fluxo:
  [Microfone] → [OpenWakeWord] → "Jarvis" detectado
      → [Whisper STT] → texto transcrito
      → [JarvisCore.process_command()] → resposta
      → [Piper TTS] → áudio sintetizado
      → [Speaker] → reprodução
      → [volta ao modo de escuta]

Estados do sistema:
  IDLE      → aguardando wake word
  LISTENING → capturando comando de voz
  THINKING  → processando (Claude + agentes)
  SPEAKING  → reproduzindo resposta
  ERROR     → falha — volta ao IDLE após 2s
"""

import asyncio
import logging
import os
import time
from enum import Enum, auto

from backend.voice.wakeword import WakeWordDetector
from backend.voice.whisper_listener import WhisperListener
from backend.voice.piper_tts import PiperTTS

logger = logging.getLogger(__name__)


class VoiceState(Enum):
    IDLE = auto()
    LISTENING = auto()
    THINKING = auto()
    SPEAKING = auto()
    ERROR = auto()
    STOPPED = auto()


class VoicePipeline:
    """
    Coordena wake word → STT → processamento → TTS em um loop contínuo.
    Projetado para rodar em paralelo com o servidor FastAPI via asyncio.
    """

    def __init__(self, jarvis_core):
        self.jarvis = jarvis_core
        self._state = VoiceState.IDLE
        self._stop_event = asyncio.Event()
        self._wake_event = asyncio.Event()

        # Componentes de voz
        wakeword_model = os.getenv("WAKEWORD_MODEL", "alexa")
        wakeword_threshold = float(os.getenv("WAKEWORD_THRESHOLD", "0.5"))

        self.wakeword = WakeWordDetector(
            model_name=wakeword_model,
            threshold=wakeword_threshold,
        )
        self.whisper = WhisperListener(
            model_name=os.getenv("WHISPER_MODEL", "base")
        )
        self.tts = PiperTTS()

        # Métricas de sessão de voz
        self._session_stats = {
            "wake_detections": 0,
            "transcriptions": 0,
            "empty_transcriptions": 0,
            "tts_syntheses": 0,
            "errors": 0,
        }

    # ── Loop principal ─────────────────────────────────────────────────────

    async def start(self):
        """
        Inicia o pipeline de voz.
        Bloqueia até que stop() seja chamado.
        """
        logger.info("[VoicePipeline] Iniciando pipeline de voz...")

        # Valida TTS
        tts_available = self.tts.validate()
        if not tts_available:
            logger.warning("[VoicePipeline] TTS indisponível — respostas serão apenas texto.")

        # Pré-carrega Whisper em background
        asyncio.create_task(self._preload_whisper())

        # Inicia detecção de wake word
        loop = asyncio.get_event_loop()
        self.wakeword.start(loop=loop, event=self._wake_event)

        logger.info("[VoicePipeline] Pronto. Aguardando wake word 'Jarvis'...")
        await self._main_loop()

    async def stop(self):
        """Para o pipeline de forma limpa."""
        logger.info("[VoicePipeline] Parando...")
        self._stop_event.set()
        self.wakeword.stop()
        self._state = VoiceState.STOPPED
        logger.info(f"[VoicePipeline] Estatísticas de sessão: {self._session_stats}")

    async def _main_loop(self):
        """Loop principal: wake → listen → process → speak → repeat."""
        while not self._stop_event.is_set():
            try:
                await self._cycle()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[VoicePipeline] Erro no ciclo: {e}", exc_info=True)
                self._session_stats["errors"] += 1
                await self._set_state(VoiceState.ERROR)
                await asyncio.sleep(2.0)
                await self._set_state(VoiceState.IDLE)

    async def _cycle(self):
        """Um ciclo completo: wake → STT → process → TTS."""

        # ── 1. Aguarda wake word ──────────────────────────────────────────
        await self._set_state(VoiceState.IDLE)
        self._wake_event.clear()

        try:
            await asyncio.wait_for(
                self._wake_event.wait(),
                timeout=None,  # espera indefinidamente
            )
        except asyncio.TimeoutError:
            return

        if self._stop_event.is_set():
            return

        self._session_stats["wake_detections"] += 1
        logger.info("[VoicePipeline] Wake word detectada!")

        # Notifica JarvisCore para mudar estado do Orb → listening
        await self.jarvis.set_listening()
        await self._set_state(VoiceState.LISTENING)

        # ── 2. STT: captura e transcreve ─────────────────────────────────
        logger.info("[VoicePipeline] Ouvindo comando...")
        t_listen = time.monotonic()

        result = await self.whisper.listen_and_transcribe_async()

        listen_ms = (time.monotonic() - t_listen) * 1000

        if result is None or not result.text.strip():
            self._session_stats["empty_transcriptions"] += 1
            logger.info("[VoicePipeline] Nenhuma fala detectada. Voltando ao idle.")
            await self.jarvis.set_idle()
            return

        self._session_stats["transcriptions"] += 1
        text = result.text.strip()
        logger.info(
            f"[VoicePipeline] Transcrito em {listen_ms:.0f}ms: '{text}'"
        )

        # ── 3. Processa o comando ─────────────────────────────────────────
        await self._set_state(VoiceState.THINKING)

        try:
            response_text = await self.jarvis.process_command(text, source="voice")
        except Exception as e:
            logger.error(f"[VoicePipeline] Erro ao processar comando: {e}", exc_info=True)
            response_text = "Desculpe, ocorreu um erro ao processar seu pedido."
            await self.jarvis.set_error(str(e))

        # ── 4. TTS: sintetiza e reproduz resposta ─────────────────────────
        if response_text:
            await self._set_state(VoiceState.SPEAKING)
            self._session_stats["tts_syntheses"] += 1

            try:
                await self.tts.speak(response_text)
            except Exception as e:
                logger.warning(f"[VoicePipeline] Falha no TTS: {e}")

        # ── 5. Retorna ao idle ────────────────────────────────────────────
        await self.jarvis.set_idle()
        logger.info("[VoicePipeline] Ciclo concluído. Aguardando próxima wake word.")

    # ── Helpers ───────────────────────────────────────────────────────────

    async def _set_state(self, state: VoiceState):
        self._state = state
        logger.debug(f"[VoicePipeline] Estado: {state.name}")

    async def _preload_whisper(self):
        """Pré-carrega o modelo Whisper em background durante o startup."""
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self.whisper.preload)
            logger.info("[VoicePipeline] Modelo Whisper pré-carregado.")
        except Exception as e:
            logger.warning(f"[VoicePipeline] Pré-carregamento do Whisper falhou: {e}")

    @property
    def state(self) -> VoiceState:
        return self._state

    @property
    def stats(self) -> dict:
        return {**self._session_stats, "state": self._state.name}


# ──────────────────────────────────────────────
# Modo de entrada de voz via WebSocket (frontend mic)
# ──────────────────────────────────────────────

class WebVoiceHandler:
    """
    Processa áudio enviado pelo frontend via WebSocket.
    O frontend captura o microfone via WebAudio API e envia chunks PCM.
    Não requer hardware no servidor — ideal para deploy em nuvem.
    """

    def __init__(self, jarvis_core, tts: PiperTTS, ws_broadcast):
        self.jarvis = jarvis_core
        self.tts = tts
        self._broadcast = ws_broadcast
        self.whisper = WhisperListener(model_name=os.getenv("WHISPER_MODEL", "base"))
        self._buffer: bytearray = bytearray()
        self._recording = False

    async def handle_audio_chunk(self, audio_bytes: bytes):
        """
        Recebe chunk de áudio PCM do frontend e acumula no buffer.
        O frontend sinaliza início/fim de gravação via eventos JSON.
        """
        if self._recording:
            self._buffer.extend(audio_bytes)

    async def start_recording(self):
        """Inicia gravação (sinalizado pelo frontend após wake word local)."""
        self._buffer = bytearray()
        self._recording = True
        await self.jarvis.set_listening()
        await self._broadcast("orb_state", {"state": "listening"})
        logger.info("[WebVoice] Gravação iniciada.")

    async def stop_recording_and_process(self):
        """Para gravação, transcreve e processa o comando."""
        self._recording = False
        audio_bytes = bytes(self._buffer)
        self._buffer = bytearray()

        if len(audio_bytes) < 1600:  # < 0.05s de áudio @ 16kHz int16
            logger.info("[WebVoice] Áudio muito curto. Ignorando.")
            await self.jarvis.set_idle()
            return

        # Transcrição
        result = self.whisper.transcribe_bytes(audio_bytes, sample_rate=16000)
        if not result or not result.text.strip():
            logger.info("[WebVoice] Transcrição vazia.")
            await self.jarvis.set_idle()
            return

        text = result.text.strip()
        logger.info(f"[WebVoice] Transcrito: '{text}'")

        # Processamento
        response = await self.jarvis.process_command(text, source="web_voice")

        # TTS → envia áudio de volta ao frontend
        if response:
            audio = await self.tts.synthesize_for_stream(response)
            if audio:
                await self._broadcast("audio_response", {
                    "audio_base64": __import__("base64").b64encode(audio).decode(),
                    "format": "wav",
                    "text": response,
                })
