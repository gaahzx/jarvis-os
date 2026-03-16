"use client";

/**
 * components/Console.tsx
 *
 * Histórico de conversas em tempo real com suporte a:
 * - Mensagens do usuário e do assistente
 * - Indicador de digitação (thinking)
 * - Botões de feedback por mensagem (👍/👎)
 * - Auto-scroll para a mensagem mais recente
 * - Input de texto para envio de comandos
 */

import { useEffect, useRef, useState } from "react";
import { SendHorizontal, Mic, Trash2 } from "lucide-react";
import type { Message, OrbState } from "@/hooks/useJarvisWS";
import FeedbackButtons from "@/components/FeedbackButtons";

interface ConsoleProps {
  messages: Message[];
  orbState: OrbState;
  onSendCommand: (text: string) => void;
  onFeedback: (interactionId: string, feedback: "positive" | "negative") => void;
  onClear: () => void;
}

// ── Helpers ────────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ModeTag({ mode }: { mode?: string }) {
  if (!mode || mode === "conversational") return null;
  const colors: Record<string, string> = {
    planning: "#8b5cf6",
    execution: "#f59e0b",
  };
  const labels: Record<string, string> = {
    planning: "PLANNING",
    execution: "EXECUTION",
  };
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: "9px",
        fontFamily: "'Orbitron', monospace",
        letterSpacing: "0.1em",
        color: colors[mode] ?? "#888",
        border: `1px solid ${colors[mode] ?? "#888"}`,
        borderRadius: "3px",
        padding: "1px 5px",
        marginBottom: "4px",
        opacity: 0.8,
      }}
    >
      {labels[mode] ?? mode.toUpperCase()}
    </span>
  );
}

function TypingIndicator() {
  return (
    <div className="console-msg-assistant animate-fade-in" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ fontSize: "10px", color: "var(--color-text-dim)", fontFamily: "var(--font-mono)" }}>
        JARVIS
      </span>
      <div className="typing-dots">
        <span /><span /><span />
      </div>
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────

export default function Console({ messages, orbState, onSendCommand, onFeedback, onClear }: ConsoleProps) {
  const [inputText, setInputText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, orbState]);

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;
    onSendCommand(text);
    setInputText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isThinking = orbState === "thinking";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--color-bg-card)",
        borderRadius: "8px",
        border: "1px solid var(--color-border)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Decorator */}
      <div className="corner-tl" /><div className="corner-tr" />
      <div className="corner-bl" /><div className="corner-br" />

      {/* Header */}
      <div className="panel-header" style={{ justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div className={`pulse-dot ${messages.length > 0 ? "active" : ""}`} />
          CONSOLE — LOG DE INTERAÇÕES
        </span>
        <button
          className="btn btn-ghost"
          onClick={onClear}
          title="Limpar console"
          style={{ padding: "2px 6px", opacity: 0.5 }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Mensagens */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-text-dim)",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              letterSpacing: "0.1em",
              opacity: 0.5,
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div>[ AGUARDANDO COMANDO ]</div>
            <div style={{ fontSize: "9px" }}>Diga "Jarvis" ou digite abaixo</div>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isUser = msg.role === "user";
          return (
            <div key={msg.id} className="animate-fade-in-up">
              {/* Timestamp + role */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "3px",
                  marginTop: idx > 0 ? "6px" : 0,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "9px",
                    color: isUser ? "var(--color-primary-dim)" : "var(--color-thinking)",
                    letterSpacing: "0.05em",
                  }}
                >
                  {isUser ? "USUÁRIO" : "JARVIS"}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "9px",
                    color: "var(--color-text-dim)",
                    opacity: 0.5,
                  }}
                >
                  {formatTime(msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp))}
                </span>
                {!isUser && msg.latencyMs && (
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "9px",
                      color: msg.latencyMs < 2000 ? "#00c853" : msg.latencyMs < 4000 ? "#f59e0b" : "#ff3b3b",
                      opacity: 0.7,
                    }}
                  >
                    {Math.round(msg.latencyMs)}ms
                  </span>
                )}
              </div>

              {/* Tag de modo */}
              {!isUser && <ModeTag mode={msg.mode} />}

              {/* Conteúdo */}
              <div className={isUser ? "console-msg-user" : "console-msg-assistant"}>
                <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {msg.content}
                </span>
              </div>

              {/* Feedback */}
              {!isUser && msg.interactionId && (
                <div style={{ marginTop: "4px", marginBottom: "4px" }}>
                  <FeedbackButtons
                    interactionId={msg.interactionId}
                    onFeedback={onFeedback}
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Indicador de digitação */}
        {isThinking && <TypingIndicator />}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        style={{
          padding: "10px 12px",
          borderTop: "1px solid var(--color-border)",
          background: "var(--color-bg-elevated)",
          display: "flex",
          gap: "8px",
          alignItems: "center",
        }}
      >
        <input
          ref={inputRef}
          className="hud-input"
          placeholder={
            orbState === "thinking" ? "Processando..." :
            orbState === "speaking" ? "JARVIS está respondendo..." :
            "Digite um comando ou pergunta..."
          }
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isThinking || orbState === "speaking"}
          style={{ flex: 1 }}
        />

        <button
          className="btn btn-primary"
          onClick={handleSend}
          disabled={!inputText.trim() || isThinking}
          style={{ padding: "8px 12px", flexShrink: 0 }}
          title="Enviar (Enter)"
        >
          <SendHorizontal size={14} />
        </button>

        <button
          className="btn btn-ghost"
          style={{ padding: "8px", flexShrink: 0, opacity: 0.5 }}
          title="Voz (requer hardware)"
        >
          <Mic size={14} />
        </button>
      </div>
    </div>
  );
}
