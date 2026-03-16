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
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const streamingIdRef = useRef<string | null>(null);

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

    utter.onstart = () => setState((s) => ({ ...s, orbState: "speaking", isSpeaking: true }));
    utter.onend = () => setState((s) => ({ ...s, orbState: "idle", isSpeaking: false }));
    utter.onerror = () => setState((s) => ({ ...s, orbState: "idle", isSpeaking: false }));

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

  // ── STT via Web Speech API ──────────────────────────────────────────────────

  const startListening = useCallback(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognitionAPI =
      (window as unknown as { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition })
        .webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setState((s) => ({
        ...s,
        lastError: "Seu navegador não suporta reconhecimento de voz. Use Chrome.",
      }));
      return;
    }

    window.speechSynthesis?.cancel();

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = "pt-BR";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () =>
      setState((s) => ({ ...s, orbState: "listening", isListening: true }));

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        sendCommand(transcript);
      }
    };

    recognition.onerror = () =>
      setState((s) => ({ ...s, orbState: "idle", isListening: false }));

    recognition.onend = () =>
      setState((s) => ({ ...s, isListening: false }));

    recognitionRef.current = recognition;
    recognition.start();
  }, [sendCommand]);

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
