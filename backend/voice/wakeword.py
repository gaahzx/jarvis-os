"""
backend/voice/wakeword.py

Detecção de wake word usando OpenWakeWord.
- Escuta o microfone continuamente em thread dedicada
- Detecta a palavra "Jarvis" (mapeada sobre o modelo "alexa" ou "hey_jarvis")
- Emite evento via asyncio.Event quando detectado
- Latência alvo: < 50ms

Dependências:
  pip install openwakeword pyaudio numpy

Modelos disponíveis no OpenWakeWord (pré-treinados):
  - alexa, hey_mycroft, hey_rhasspy, current_year, etc.
  Para "Jarvis": usar "alexa" como proxy ou treinar modelo customizado.
  O threshold alto (>0.7) reduz falsos positivos.
"""

import asyncio
import logging
import os
import queue
import threading
import time
from typing import Callable

import numpy as np

logger = logging.getLogger(__name__)

# Configurações de áudio
SAMPLE_RATE = 16000       # Hz — OpenWakeWord requer 16kHz
CHUNK_DURATION_MS = 80    # ms por chunk (equilibra latência e CPU)
CHUNK_SIZE = int(SAMPLE_RATE * CHUNK_DURATION_MS / 1000)  # = 1280 samples
CHANNELS = 1
FORMAT_BYTES = 2          # int16 = 2 bytes

# Configurações de detecção
DEFAULT_THRESHOLD = float(os.getenv("WAKEWORD_THRESHOLD", "0.5"))
DEFAULT_MODEL = os.getenv("WAKEWORD_MODEL", "alexa")


class WakeWordDetector:
    """
    Detector de wake word baseado em OpenWakeWord.
    Roda em thread separada para não bloquear o event loop asyncio.
    """

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL,
        threshold: float = DEFAULT_THRESHOLD,
        on_detected: Callable | None = None,
    ):
        self.model_name = model_name
        self.threshold = threshold
        self._on_detected = on_detected  # callback síncrono ou None

        self._oww = None          # modelo OpenWakeWord
        self._audio_stream = None
        self._pa = None           # PyAudio instance
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._detection_queue: queue.Queue = queue.Queue()

        # asyncio Event para integração com o pipeline assíncrono
        self._loop: asyncio.AbstractEventLoop | None = None
        self._async_event: asyncio.Event | None = None

    # ── Inicialização ──────────────────────────────────────────────────────

    def _load_model(self):
        """Carrega o modelo OpenWakeWord (executado na thread de detecção)."""
        try:
            from openwakeword.model import Model
            self._oww = Model(
                wakeword_models=[self.model_name],
                inference_framework="onnx",
            )
            logger.info(f"[WakeWord] Modelo '{self.model_name}' carregado. Threshold: {self.threshold}")
        except ImportError:
            raise RuntimeError(
                "OpenWakeWord não instalado. Execute: pip install openwakeword"
            )
        except Exception as e:
            raise RuntimeError(f"Falha ao carregar modelo OpenWakeWord '{self.model_name}': {e}")

    def _open_audio_stream(self):
        """Abre o stream de áudio do microfone."""
        try:
            import pyaudio
            self._pa = pyaudio.PyAudio()
            self._audio_stream = self._pa.open(
                format=pyaudio.paInt16,
                channels=CHANNELS,
                rate=SAMPLE_RATE,
                input=True,
                frames_per_buffer=CHUNK_SIZE,
            )
            logger.info(f"[WakeWord] Stream de áudio aberto ({SAMPLE_RATE}Hz, chunk={CHUNK_SIZE})")
        except ImportError:
            raise RuntimeError("PyAudio não instalado. Execute: pip install pyaudio")
        except OSError as e:
            raise RuntimeError(f"Falha ao abrir microfone: {e}")

    # ── Loop de detecção (roda em thread separada) ─────────────────────────

    def _detection_loop(self):
        """Thread principal de detecção."""
        try:
            self._load_model()
            self._open_audio_stream()
        except RuntimeError as e:
            logger.error(f"[WakeWord] Inicialização falhou: {e}")
            return

        logger.info("[WakeWord] Aguardando wake word...")
        cooldown_until = 0.0  # evita detecções repetidas

        while not self._stop_event.is_set():
            try:
                # Lê chunk de áudio
                raw_bytes = self._audio_stream.read(
                    CHUNK_SIZE, exception_on_overflow=False
                )
                # Converte para float32 normalizado [-1.0, 1.0]
                audio_data = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0

                # Inferência OpenWakeWord
                prediction = self._oww.predict(audio_data)

                # Verifica scores de cada modelo carregado
                now = time.monotonic()
                for model_key, score in prediction.items():
                    if score >= self.threshold and now > cooldown_until:
                        logger.info(
                            f"[WakeWord] DETECTADO! modelo='{model_key}' "
                            f"score={score:.3f} threshold={self.threshold}"
                        )
                        cooldown_until = now + 2.0  # 2s de cooldown

                        # Notifica o loop asyncio
                        if self._loop and self._async_event:
                            self._loop.call_soon_threadsafe(self._async_event.set)

                        # Callback síncrono opcional
                        if self._on_detected:
                            self._on_detected(score)

                        self._detection_queue.put({"score": score, "model": model_key})
                        break

            except OSError:
                # Stream fechado externamente
                break
            except Exception as e:
                logger.warning(f"[WakeWord] Erro no loop de detecção: {e}")
                time.sleep(0.05)

        self._cleanup()
        logger.info("[WakeWord] Thread de detecção encerrada.")

    # ── API pública ────────────────────────────────────────────────────────

    def start(self, loop: asyncio.AbstractEventLoop, event: asyncio.Event):
        """
        Inicia a detecção em thread separada.
        loop  : event loop do asyncio principal
        event : asyncio.Event que será setado ao detectar
        """
        self._loop = loop
        self._async_event = event
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._detection_loop,
            daemon=True,
            name="jarvis-wakeword",
        )
        self._thread.start()
        logger.info("[WakeWord] Thread iniciada.")

    def stop(self):
        """Para a detecção e libera recursos."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3.0)
        logger.info("[WakeWord] Parado.")

    def _cleanup(self):
        """Fecha stream de áudio e PyAudio."""
        if self._audio_stream:
            try:
                self._audio_stream.stop_stream()
                self._audio_stream.close()
            except Exception:
                pass
        if self._pa:
            try:
                self._pa.terminate()
            except Exception:
                pass

    @property
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()


# ── Utilitário: lista dispositivos de áudio disponíveis ──────────────────────

def list_audio_devices() -> list[dict]:
    """Lista microfones disponíveis no sistema."""
    try:
        import pyaudio
        pa = pyaudio.PyAudio()
        devices = []
        for i in range(pa.get_device_count()):
            info = pa.get_device_info_by_index(i)
            if info.get("maxInputChannels", 0) > 0:
                devices.append({
                    "index": i,
                    "name": info["name"],
                    "channels": info["maxInputChannels"],
                    "sample_rate": int(info["defaultSampleRate"]),
                })
        pa.terminate()
        return devices
    except Exception as e:
        logger.warning(f"[WakeWord] Falha ao listar dispositivos: {e}")
        return []
