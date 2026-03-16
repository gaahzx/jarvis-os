"use client";

/**
 * hooks/useJarvisWS.ts
 *
 * Hook WebSocket com reconexão automática exponential backoff.
 * Gerencia o estado global do JARVIS no frontend:
 *   - Estado do Orb
 *   - Histórico de mensagens
 *   - Grafo ativo (Visual Brain)
 *   - Agentes ativos
 *   - Entregas
 */

import { useCallback, useEffect, useRef, useState } from "react";

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws";

// ── Tipos ──────────────────────────────────────────────────────────────────

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "error";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  mode?: string;
  interactionId?: string;
  latencyMs?: number;
  partial?: boolean;
}

export interface GraphNode {
  id: string;
  type: "task" | "agent" | "memory" | "result";
  label: string;
  agent?: string;
  params?: Record<string, unknown>;
  status?: "pending" | "running" | "success" | "error";
  duration_ms?: number;
  result_preview?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  condition?: string;
}

export interface TaskGraph {
  graph_id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  status?: string;
}

export interface AgentInfo {
  name: string;
  description: string;
  status?: "idle" | "running";
}

export interface Delivery {
  id?: string;
  url: string;
  filename?: string;
  file_type?: string;
  graph_id?: string;
  created_at?: string;
}

export interface JarvisState {
  orbState: OrbState;
  messages: Message[];
  activeGraph: TaskGraph | null;
  agents: AgentInfo[];
  deliveries: Delivery[];
  connected: boolean;
  sessionId: string | null;
  lastError: string | null;
}

type SendCommand = (text: string) => void;
type SendFeedback = (interactionId: string, feedback: "positive" | "negative") => void;
type StartNewSession = () => void;

interface UseJarvisWS {
  state: JarvisState;
  sendCommand: SendCommand;
  sendFeedback: SendFeedback;
  startNewSession: StartNewSession;
  clearMessages: () => void;
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useJarvisWS(): UseJarvisWS {
  const [state, setState] = useState<JarvisState>({
    orbState: "idle",
    messages: [],
    activeGraph: null,
    agents: [],
    deliveries: [],
    connected: false,
    sessionId: null,
    lastError: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout>>();
  const retryCount = useRef(0);
  const mountedRef = useRef(true);

  // ── Conexão ──────────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      retryCount.current = 0;
      setState((s) => ({ ...s, connected: true, lastError: null }));
    };

    ws.onclose = () => {
      setState((s) => ({ ...s, connected: false, orbState: "idle" }));
      if (!mountedRef.current) return;
      // Exponential backoff: 1s, 2s, 4s, 8s, máx 30s
      const delay = Math.min(1000 * 2 ** retryCount.current, 30000);
      retryCount.current++;
      retryRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      setState((s) => ({ ...s, lastError: "Falha na conexão WebSocket." }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleEvent(data);
      } catch {
        console.warn("[WS] Mensagem inválida:", event.data);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handler de eventos ────────────────────────────────────────────────────

  const handleEvent = useCallback((data: Record<string, unknown>) => {
    const type = data.type as string;

    setState((s) => {
      switch (type) {
        case "connected":
          return {
            ...s,
            connected: true,
            sessionId: (data.session as { session_id?: string })?.session_id ?? s.sessionId,
            agents: (data.agents as AgentInfo[]) ?? s.agents,
          };

        case "orb_state":
          return { ...s, orbState: data.state as OrbState };

        case "transcript":
          return {
            ...s,
            messages: [
              ...s.messages,
              {
                id: crypto.randomUUID(),
                role: "user",
                content: data.text as string,
                timestamp: new Date(),
                interactionId: data.interaction_id as string,
              },
            ],
          };

        case "response":
          if (data.partial) {
            // Atualiza a última mensagem do assistente se for streaming
            const msgs = [...s.messages];
            const lastIdx = msgs.length - 1;
            if (lastIdx >= 0 && msgs[lastIdx].role === "assistant" && msgs[lastIdx].partial) {
              msgs[lastIdx] = {
                ...msgs[lastIdx],
                content: msgs[lastIdx].content + (data.text as string),
              };
              return { ...s, messages: msgs };
            }
            return {
              ...s,
              messages: [
                ...s.messages,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: data.text as string,
                  timestamp: new Date(),
                  mode: data.mode as string,
                  interactionId: data.interaction_id as string,
                  latencyMs: data.total_latency_ms as number,
                  partial: true,
                },
              ],
            };
          }
          // Mensagem completa
          return {
            ...s,
            messages: [
              ...s.messages,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: data.text as string,
                timestamp: new Date(),
                mode: data.mode as string,
                interactionId: data.interaction_id as string,
                latencyMs: data.total_latency_ms as number,
              },
            ],
          };

        case "graph_update":
          return {
            ...s,
            activeGraph: {
              graph_id: data.graph_id as string,
              nodes: data.nodes as GraphNode[],
              edges: data.edges as GraphEdge[],
              status: data.status as string,
            },
          };

        case "delivery":
          return {
            ...s,
            deliveries: [
              { url: data.url as string, graph_id: data.graph_id as string },
              ...s.deliveries,
            ].slice(0, 50), // mantém últimas 50
          };

        case "agent_status":
          return {
            ...s,
            agents: s.agents.map((a) =>
              a.name === data.agent
                ? { ...a, status: data.status as "idle" | "running" }
                : a
            ),
          };

        case "session_started":
          return { ...s, sessionId: data.session_id as string, messages: [] };

        case "error":
          return { ...s, lastError: data.message as string, orbState: "error" };

        default:
          return s;
      }
    });
  }, []);

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // ── API pública ────────────────────────────────────────────────────────────

  const sendCommand: SendCommand = useCallback((text: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "command", text }));
  }, []);

  const sendFeedback: SendFeedback = useCallback((interactionId, feedback) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "feedback", interaction_id: interactionId, feedback }));
  }, []);

  const startNewSession: StartNewSession = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "new_session" }));
  }, []);

  const clearMessages = useCallback(() => {
    setState((s) => ({ ...s, messages: [] }));
  }, []);

  return { state, sendCommand, sendFeedback, startNewSession, clearMessages };
}
