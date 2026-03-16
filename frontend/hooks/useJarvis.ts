"use client";

/**
 * hooks/useJarvis.ts
 *
 * Hook principal do JARVIS OS — versão frontend-only.
 * Substitui useJarvisWS: usa fetch + SSE em vez de WebSocket.
 *
 * Funcionalidades:
 *  - Chat com streaming de resposta via SSE
 *  - Voice input/output via Web Speech API (browser nativo)
 *  - Estado do Orb sincronizado com o fluxo
 *  - Lista de agentes via /api/agents
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { detectAgent, AGENTS } from "@/lib/agents";

// ── Tipos ────────────────────────────────────────────────────────────────────

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "error";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  agent?: string;
  agentLabel?: string;
  partial?: boolean;
}

export interface AgentInfo {
  name: string;
  label: string;
  description: string;
  status?: "idle" | "running";
}

export interface JarvisState {
  orbState: OrbState;
  messages: Message[];
  agents: AgentInfo[];
  connected: boolean;
  sessionId: string | null;
  lastError: string | null;
  isListening: boolean;
  isSpeaking: boolean;
  activeAgent: string | null;
}

interface UseJarvis {
  state: JarvisState;
  sendCommand: (text: string, agentName?: string) => void;
  startListening: () => void;
  stopListening: () => void;
  clearMessages: () => void;
  startNewSession: () => void;
}

// ── Utilitário SSE ────────────────────────────────────────────────────────────

async function streamChat(
  text: string,
  history: { role: string; content: string }[],
  agentName: string | undefined,
  onDelta: (chunk: string) => void,
  onDone: (fullText: string, agent: string, agentLabel: string) => void,
  onError: (err: string) => void
) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, history, agentName }),
  });

  if (!res.ok || !res.body) {
    onError("Falha ao conectar à API.");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.type === "delta") onDelta(event.text);
        if (event.type === "done") onDone(event.text, event.agent, event.agentLabel);
        if (event.type === "error") onError(event.message);
      } catch {
        // linha incompleta, ignora
      }
    }
  }
}

// ── Hook principal ────────────────────────────────────────────────────────────

export function useJarvis(): UseJarvis {
  const [state, setState] = useState<JarvisState>({
    orbState: "idle",
    messages: [],
    agents: [],
    connected: true, // frontend-only sempre "conectado"
    sessionId: crypto.randomUUID(),
    lastError: null,
    isListening: false,
    isSpeaking: false,
    activeAgent: null,
  });

  const historyRef = useRef<{ role: string; content: string }[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wakeWordRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const streamingIdRef = useRef<string | null>(null);
  const isSpeakingRef = useRef(false);
  const isThinkingRef = useRef(false);

  // ── Carrega agentes na inicialização ────────────────────────────────────────
  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => {
        setState((s) => ({ ...s, agents: data.agents ?? [] }));
      })
      .catch(() => {
        // fallback: usa agentes do lib/agents.ts diretamente
        const agents = Object.values(AGENTS).map((a) => ({
          name: a.name,
          label: a.label,
          description: a.description,
        }));
        setState((s) => ({ ...s, agents }));
      });
  }, []);

  // ── TTS via Web Speech API ──────────────────────────────────────────────────

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    window.speechSynthesis.cancel();

    // Remove markdown para fala mais natural
    const clean = text
      .replace(/#{1,6}\s+/g, "")
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
      .replace(/`[^`]*`/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "link")
      .replace(/[-•]\s+/g, "")
      .replace(/\n+/g, ". ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 500); // limita para não ser muito longo

    if (!clean) return;

    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = "pt-BR";
    utter.rate = 1.05;
    utter.pitch = 1.0;

    // Tenta usar voz em português se disponível
    const voices = window.speechSynthesis.getVoices();
    const ptVoice = voices.find(
      (v) => v.lang.startsWith("pt") && v.localService
    );
    if (ptVoice) utter.voice = ptVoice;

    utter.onstart = () => { isSpeakingRef.current = true; setState((s) => ({ ...s, orbState: "speaking", isSpeaking: true })); };
    utter.onend = () => { isSpeakingRef.current = false; setState((s) => ({ ...s, orbState: "idle", isSpeaking: false })); };
    utter.onerror = () => { isSpeakingRef.current = false; setState((s) => ({ ...s, orbState: "idle", isSpeaking: false })); };

    synthRef.current = utter;
    window.speechSynthesis.speak(utter);
  }, []);

  // ── Envio de comando (texto) ────────────────────────────────────────────────

  const sendCommand = useCallback(
    async (text: string, agentName?: string) => {
      if (!text.trim()) return;

      const userMsgId = crypto.randomUUID();
      const assistantMsgId = crypto.randomUUID();
      streamingIdRef.current = assistantMsgId;

      const resolvedAgent = agentName || detectAgent(text);
      const agentDef = AGENTS[resolvedAgent];

      // Adiciona mensagem do usuário
      isThinkingRef.current = true;
      setState((s) => ({
        ...s,
        orbState: "thinking",
        activeAgent: resolvedAgent,
        lastError: null,
        messages: [
          ...s.messages,
          {
            id: userMsgId,
            role: "user",
            content: text,
            timestamp: new Date(),
          },
          {
            id: assistantMsgId,
            role: "assistant",
            content: "",
            timestamp: new Date(),
            agent: resolvedAgent,
            agentLabel: agentDef?.label,
            partial: true,
          },
        ],
      }));

      try {
        await streamChat(
          text,
          historyRef.current,
          resolvedAgent,
          // onDelta: atualiza mensagem parcial
          (chunk) => {
            setState((s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: m.content + chunk }
                  : m
              ),
            }));
          },
          // onDone: finaliza e fala
          (fullText, agent, agentLabel) => {
            isThinkingRef.current = false;
            // Atualiza histórico para próximas mensagens
            historyRef.current = [
              ...historyRef.current,
              { role: "user", content: text },
              { role: "assistant", content: fullText },
            ].slice(-20); // mantém últimas 10 trocas

            setState((s) => ({
              ...s,
              orbState: "speaking",
              activeAgent: null,
              messages: s.messages.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: fullText, partial: false, agent, agentLabel }
                  : m
              ),
            }));

            speak(fullText);
          },
          // onError
          (err) => {
            isThinkingRef.current = false;
            setState((s) => ({
              ...s,
              orbState: "error",
              activeAgent: null,
              lastError: err,
              messages: s.messages.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: "Erro ao processar. Tente novamente.", partial: false }
                  : m
              ),
            }));
            setTimeout(() => setState((s) => ({ ...s, orbState: "idle" })), 2000);
          }
        );
      } catch (err) {
        isThinkingRef.current = false;
        setState((s) => ({
          ...s,
          orbState: "error",
          activeAgent: null,
          lastError: String(err),
        }));
        setTimeout(() => setState((s) => ({ ...s, orbState: "idle" })), 2000);
      }
    },
    [speak]
  );

  // ── Wake Word + Command listener ────────────────────────────────────────────

  const listenForCommand = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SpeechRecognitionAPI = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    const cmd = new SpeechRecognitionAPI();
    cmd.lang = "pt-BR";
    cmd.continuous = false;
    cmd.interimResults = false;
    cmd.maxAlternatives = 3;

    recognitionRef.current = cmd;
    setState((s) => ({ ...s, orbState: "listening", isListening: true }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cmd.onresult = (event: any) => {
      // Pega a melhor alternativa
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        sendCommand(transcript);
      }
    };

    cmd.onerror = () => setState((s) => ({ ...s, orbState: "idle", isListening: false }));
    cmd.onend = () => setState((s) => ({ ...s, isListening: false }));

    try { cmd.start(); } catch { /* já rodando */ }
  }, [sendCommand]);

  const startWakeWordListener = useCallback(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SpeechRecognitionAPI = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    const wake = new SpeechRecognitionAPI();
    wake.lang = "pt-BR";
    wake.continuous = true;
    wake.interimResults = false; // só resultados finais = mais preciso
    wake.maxAlternatives = 5;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wake.onresult = (event: any) => {
      if (isSpeakingRef.current || isThinkingRef.current) return;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (!event.results[i].isFinal) continue;

        // Verifica todas as alternativas para melhor detecção da wake word
        let transcript = "";
        for (let j = 0; j < event.results[i].length; j++) {
          const alt = event.results[i][j].transcript.toLowerCase().trim();
          if (/\bjarvis\b|j\.?a\.?r\.?v\.?i\.?s/i.test(alt)) {
            transcript = alt;
            break;
          }
          if (!transcript) transcript = alt; // fallback: melhor alternativa
        }

        const hasWakeWord = /\bjarvis\b|j\.?a\.?r\.?v\.?i\.?s/i.test(transcript);
        if (!hasWakeWord) continue;

        // Remove wake word do transcript
        const command = transcript
          .replace(/j\.?a\.?r\.?v\.?i\.?s\.?/gi, "")
          .replace(/\bjarvis\b/gi, "")
          .trim();

        if (command.length > 3) {
          // Comando junto com wake word — processa direto
          sendCommand(command);
        } else {
          // Só "Jarvis" — abre sessão de comando dedicada
          wake.stop();
          setTimeout(() => listenForCommand(), 300);
        }
      }
    };

    wake.onerror = () => { /* ignora erros transitórios */ };

    wake.onend = () => {
      // Reinicia automaticamente (exceto se foi parado intencionalmente)
      if (wakeWordRef.current === wake && !isThinkingRef.current && !isSpeakingRef.current) {
        setTimeout(() => {
          try { wake.start(); } catch { /* já rodando */ }
        }, 500);
      }
    };

    wakeWordRef.current = wake;
    try { wake.start(); } catch { /* já rodando */ }
  }, [sendCommand, listenForCommand]);

  // Inicia wake word listener ao montar
  useEffect(() => {
    startWakeWordListener();
    return () => {
      if (wakeWordRef.current) {
        wakeWordRef.current.onend = null;
        wakeWordRef.current.stop();
        wakeWordRef.current = null;
      }
    };
  }, [startWakeWordListener]);

  // ── STT via Web Speech API ──────────────────────────────────────────────────

  const startListening = useCallback(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (!w.SpeechRecognition && !w.webkitSpeechRecognition) {
      setState((s) => ({ ...s, lastError: "Reconhecimento de voz requer Chrome." }));
      return;
    }
    window.speechSynthesis?.cancel();
    listenForCommand();
  }, [listenForCommand]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setState((s) => ({ ...s, isListening: false, orbState: "idle" }));
  }, []);

  // ── Utilidades ─────────────────────────────────────────────────────────────

  const clearMessages = useCallback(() => {
    historyRef.current = [];
    setState((s) => ({ ...s, messages: [] }));
  }, []);

  const startNewSession = useCallback(() => {
    historyRef.current = [];
    setState((s) => ({
      ...s,
      messages: [],
      sessionId: crypto.randomUUID(),
      activeGraph: null,
    } as JarvisState));
  }, []);

  return { state, sendCommand, startListening, stopListening, clearMessages, startNewSession };
}
