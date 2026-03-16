"""
backend/voice/whisper_listener.py

Transcrição de fala para texto usando faster-whisper (CPU-optimized).
- Captura áudio após wake word ser detectada
- Para de gravar ao detectar silêncio prolongado
- Retorna o texto transcrito

Dependências:
  pip install faster-whisper pyaudio numpy soundfile

Modelos disponíveis (tradeoff velocidade x precisão em CPU):
  tiny   → ~1s  latência, precisão básica
  base   → ~1.5s latência, bom equilíbrio  ← recomendado
  small  → ~2.5s latência, boa precisão
  medium → ~5s  latência, excelente precisão (requer 8GB RAM)
"""

import asyncio
import io
import logging
import os
import queue
import threading
import time
import wave
from dataclasses import dataclass

import numpy as np

logger = logging.getLogger(__name__)

# ── Configurações de áudio ─────────────────────────────────────────────────
SAMPLE_RATE = 16000
CHANNELS = 1
CHUNK_SIZE = 1024               # samples por chunk de captura
SILENCE_THRESHOLD = 0.015       # RMS abaixo disto = silêncio
SILENCE_DURATION_S = 1.8        # segundos de silêncio para parar gravação
MIN_RECORDING_S = 0.5           # gravação mínima antes de analisar silêncio
MAX_RECORDING_S = 30.0          # limite máximo de gravação (evita loop infinito)

# ── Configurações do modelo ────────────────────────────────────────────────
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")
MODEL_PATH = os.getenv("WHISPER_MODEL_PATH", None)  # None = download automático
LANGUAGE = "pt"  # Força português; None = auto-detect


@dataclass
class TranscriptionResult:
    text: str
    language: str
    duration_s: float
    transcription_ms: float
    confidence: float = 1.0


class WhisperListener:
    """
    Captura áudio do microfone e transcreve com faster-whisper.
    Opera de forma síncrona em thread para não bloquear asyncio.
    """

    def __init__(self, model_name: str = WHISPER_MODEL):
        self.model_name = model_name
        self._model = None
        self._pa = None
        self._model_lock = threading.Lock()

    # ── Carregamento do modelo ─────────────────────────────────────────────

    def _ensure_model(self):
        """Carrega o modelo faster-whisper na primeira chamada (lazy loading)."""
        if self._model is not None:
            return
        with self._model_lock:
            if self._model is not None:
                return
            try:
                from faster_whisper import WhisperModel
                logger.info(f"[Whisper] Carregando modelo '{self.model_name}' (CPU)...")
                t0 = time.monotonic()
                self._model = WhisperModel(
                    self.model_name,
                    device="cpu",
                    compute_type="int8",  # mais rápido em CPU
                    download_root=MODEL_PATH,
                )
                elapsed = (time.monotonic() - t0) * 1000
                logger.info(f"[Whisper] Modelo carregado em {elapsed:.0f}ms.")
            except ImportError:
                raise RuntimeError(
                    "faster-whisper não instalado. Execute: pip install faster-whisper"
                )
            except Exception as e:
                raise RuntimeError(f"Falha ao carregar modelo Whisper: {e}")

    # ── Captura de áudio ───────────────────────────────────────────────────

    def _record_until_silence(self) -> np.ndarray | None:
        """
        Grava até detectar silêncio prolongado ou atingir o limite máximo.
        Retorna array numpy float32 com o áudio capturado.
        """
        try:
            import pyaudio
            pa = pyaudio.PyAudio()
            stream = pa.open(
                format=pyaudio.paInt16,
                channels=CHANNELS,
                rate=SAMPLE_RATE,
                input=True,
                frames_per_buffer=CHUNK_SIZE,
            )
        except Exception as e:
            logger.error(f"[Whisper] Falha ao abrir microfone: {e}")
            return None

        logger.info("[Whisper] Gravando...")
        frames: list[bytes] = []
        silence_chunks = 0
        silence_limit = int(SILENCE_DURATION_S * SAMPLE_RATE / CHUNK_SIZE)
        min_chunks = int(MIN_RECORDING_S * SAMPLE_RATE / CHUNK_SIZE)
        max_chunks = int(MAX_RECORDING_S * SAMPLE_RATE / CHUNK_SIZE)
        total_chunks = 0

        try:
            while total_chunks < max_chunks:
                data = stream.read(CHUNK_SIZE, exception_on_overflow=False)
                frames.append(data)
                total_chunks += 1

                # Calcula RMS do chunk para detectar silêncio
                chunk_array = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
                rms = float(np.sqrt(np.mean(chunk_array ** 2)))

                if rms < SILENCE_THRESHOLD:
                    silence_chunks += 1
                else:
                    silence_chunks = 0  # reset ao detectar som

                # Só verifica silêncio após a gravação mínima
                if total_chunks > min_chunks and silence_chunks >= silence_limit:
                    logger.debug(f"[Whisper] Silêncio detectado após {total_chunks} chunks.")
                    break
        finally:
            stream.stop_stream()
            stream.close()
            pa.terminate()

        if not frames:
            return None

        # Combina frames em array numpy
        raw_bytes = b"".join(frames)
        audio_array = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        duration = len(audio_array) / SAMPLE_RATE
        logger.info(f"[Whisper] Gravação concluída: {duration:.1f}s")
        return audio_array

    # ── Transcrição ────────────────────────────────────────────────────────

    def _transcribe(self, audio: np.ndarray) -> TranscriptionResult:
        """Transcreve o áudio usando faster-whisper."""
        self._ensure_model()
        t0 = time.monotonic()

        segments, info = self._model.transcribe(
            audio,
            language=LANGUAGE,
            beam_size=5,
            vad_filter=True,             # filtra partes sem voz
            vad_parameters={
                "min_silence_duration_ms": 500,
                "threshold": 0.5,
            },
        )

        # Materializa o gerador de segmentos
        text_parts = [segment.text.strip() for segment in segments]
        text = " ".join(text_parts).strip()

        transcription_ms = (time.monotonic() - t0) * 1000
        duration_s = len(audio) / SAMPLE_RATE

        logger.info(
            f"[Whisper] Transcrito em {transcription_ms:.0f}ms: '{text[:80]}'"
        )
        return TranscriptionResult(
            text=text,
            language=info.language,
            duration_s=duration_s,
            transcription_ms=transcription_ms,
        )

    # ── API pública ────────────────────────────────────────────────────────

    def listen_and_transcribe(self) -> TranscriptionResult | None:
        """
        Grava áudio do microfone e transcreve.
        Chamada síncrona — use em thread separada.
        Retorna None se a gravação estiver vazia ou ocorrer erro.
        """
        audio = self._record_until_silence()
        if audio is None or len(audio) < SAMPLE_RATE * 0.3:
            logger.warning("[Whisper] Áudio muito curto ou vazio. Ignorando.")
            return None
        return self._transcribe(audio)

    async def listen_and_transcribe_async(self) -> TranscriptionResult | None:
        """
        Versão assíncrona: roda em executor para não bloquear o event loop.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.listen_and_transcribe)

    def transcribe_file(self, file_path: str) -> TranscriptionResult | None:
        """Transcreve um arquivo de áudio existente (para testes)."""
        try:
            import soundfile as sf
            audio, sr = sf.read(file_path, dtype="float32")
            if sr != SAMPLE_RATE:
                # Reamostrar se necessário
                import librosa
                audio = librosa.resample(audio, orig_sr=sr, target_sr=SAMPLE_RATE)
            if len(audio.shape) > 1:
                audio = audio.mean(axis=1)  # mono
            return self._transcribe(audio)
        except Exception as e:
            logger.error(f"[Whisper] Falha ao transcrever arquivo: {e}")
            return None

    def transcribe_bytes(self, audio_bytes: bytes, sample_rate: int = 16000) -> TranscriptionResult | None:
        """
        Transcreve áudio recebido como bytes (ex: do frontend via WebSocket).
        Espera PCM int16.
        """
        try:
            self._ensure_model()
            audio = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
            if sample_rate != SAMPLE_RATE:
                # Resample simples (interpolação linear)
                ratio = SAMPLE_RATE / sample_rate
                new_length = int(len(audio) * ratio)
                audio = np.interp(
                    np.linspace(0, len(audio), new_length),
                    np.arange(len(audio)),
                    audio,
                )
            return self._transcribe(audio)
        except Exception as e:
            logger.error(f"[Whisper] Falha ao transcrever bytes: {e}")
            return None

    def preload(self):
        """
        Pré-carrega o modelo em background.
        Chame durante o startup para evitar latência na primeira transcrição.
        """
        try:
            self._ensure_model()
        except Exception as e:
            logger.warning(f"[Whisper] Pré-carregamento falhou: {e}")
