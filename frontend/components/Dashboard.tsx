"use client";

/**
 * components/Dashboard.tsx
 *
 * Shell principal do JARVIS OS HUD.
 * Gerencia as 5 views: HUB | CONSOLE | AGENTS | DELIVERIES | VISUAL BRAIN
 *
 * Layout:
 *   ┌──────────────────────────────────────────┐
 *   │  NAVBAR: logo | tabs | status            │
 *   ├──────────────────────────────────────────┤
 *   │  VIEW CONTENT (ocupa tela restante)      │
 *   └──────────────────────────────────────────┘
 */

import dynamic from "next/dynamic";
import { useState, useRef } from "react";
import { Cpu, MessageSquare, Bot, FolderOpen, Network, Wifi, WifiOff, Plus, SendHorizontal, Mic } from "lucide-react";
import { useJarvis } from "@/hooks/useJarvis";
import Console from "@/components/Console";
import AgentsPanel from "@/components/AgentsPanel";
import DeliveriesPanel from "@/components/DeliveriesPanel";

// Imports dinâmicos (pesados — evita SSR)
const Orb = dynamic(() => import("@/components/Orb"), { ssr: false });
const VisualBrain = dynamic(() => import("@/components/VisualBrain"), { ssr: false });

// ── Tipos e config de tabs ─────────────────────────────────────

type Tab = "hub" | "console" | "agents" | "deliveries" | "brain";

const TABS: { id: Tab; label: string; icon: React.ReactNode; shortcut: string }[] = [
  { id: "hub",        label: "HUB",          icon: <Cpu size={12} />,           shortcut: "1" },
  { id: "console",    label: "CONSOLE",      icon: <MessageSquare size={12} />, shortcut: "2" },
  { id: "agents",     label: "AGENTES",      icon: <Bot size={12} />,           shortcut: "3" },
  { id: "deliveries", label: "ENTREGAS",     icon: <FolderOpen size={12} />,    shortcut: "4" },
  { id: "brain",      label: "VISUAL BRAIN", icon: <Network size={12} />,       shortcut: "5" },
];

// ── View HUB ──────────────────────────────────────────────────

function HubView({ state, sendCommand, startListening, stopListening, isListening, clearMessages }: {
  state: ReturnType<typeof useJarvis>["state"];
  sendCommand: (t: string) => void;
  startListening: () => void;
  stopListening: () => void;
  isListening: boolean;
  clearMessages: () => void;
}) {
  const [inputText, setInputText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const isThinking = state.orbState === "thinking";

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;
    sendCommand(text);
    setInputText("");
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1.2fr",
        gap: "16px",
        height: "100%",
        padding: "16px",
      }}
    >
      {/* Coluna esquerda: Orb + métricas */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", minHeight: 0 }}>
        {/* Orb */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: "16px",
            flex: "0 0 auto",
            paddingTop: "8px",
          }}
        >
          <Orb orbState={state.orbState} size={220} />
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: "'Orbitron', monospace",
                fontSize: "15px",
                fontWeight: 700,
                letterSpacing: "0.3em",
                color: "rgba(0,212,255,0.9)",
                marginBottom: "4px",
              }}
            >
              J.A.R.V.I.S.
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--color-text-dim)", letterSpacing: "0.1em" }}>
              {state.sessionId ? `SESSION: ${state.sessionId.slice(0, 8).toUpperCase()}` : "INICIALIZANDO..."}
            </div>
          </div>
        </div>

        {/* Métricas compactas */}
        <div className="panel" style={{ padding: "10px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "6px" }}>
            {[
              { label: "MSG", value: state.messages.length, color: "var(--color-primary)" },
              { label: "AGENTE", value: state.activeAgent?.slice(0, 4).toUpperCase() ?? "—", color: "var(--color-agent-result)" },
              { label: "AGENTS", value: state.agents.length, color: "#00c853" },
              { label: "STATUS", value: state.orbState.slice(0, 4).toUpperCase(), color: "var(--color-text-dim)" },
            ].map((m) => (
              <div key={m.label} style={{ background: "var(--color-bg-elevated)", borderRadius: "4px", padding: "6px", textAlign: "center" }}>
                <div style={{ fontFamily: "'Orbitron', monospace", fontSize: "14px", fontWeight: 700, color: m.color, lineHeight: 1, marginBottom: "3px" }}>
                  {m.value}
                </div>
                <div style={{ fontSize: "7px", letterSpacing: "0.1em", color: "var(--color-text-dim)" }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Coluna direita: Console integrado */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: "var(--color-bg-card)",
          borderRadius: "8px",
          border: "1px solid var(--color-border)",
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        {/* Header do console */}
        <div className="panel-header" style={{ justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div className={`pulse-dot ${state.messages.length > 0 ? "active" : ""}`} />
            CONSOLE — LOG DE INTERAÇÕES
          </span>
        </div>

        {/* Mensagens */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px", display: "flex", flexDirection: "column", gap: "4px" }}>
          {state.messages.length === 0 && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-dim)", fontFamily: "var(--font-mono)", fontSize: "11px", letterSpacing: "0.1em", opacity: 0.5, flexDirection: "column", gap: "6px" }}>
              <div>[ AGUARDANDO COMANDO ]</div>
              <div style={{ fontSize: "9px" }}>Diga &quot;Jarvis&quot; ou digite abaixo</div>
            </div>
          )}
          {state.messages.map((msg, idx) => {
            const isUser = msg.role === "user";
            return (
              <div key={msg.id} style={{ marginTop: idx > 0 ? "4px" : 0 }}>
                <div style={{ fontSize: "9px", fontFamily: "var(--font-mono)", color: isUser ? "var(--color-primary-dim)" : "var(--color-thinking)", marginBottom: "2px" }}>
                  {isUser ? "USUÁRIO" : "JARVIS"}
                </div>
                <div className={isUser ? "console-msg-user" : "console-msg-assistant"}>
                  <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{msg.content}</span>
                </div>
              </div>
            );
          })}
          {isThinking && (
            <div className="console-msg-assistant" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div className="typing-dots"><span /><span /><span /></div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", background: "var(--color-bg-elevated)", display: "flex", gap: "6px", alignItems: "center" }}>
          <input
            className="hud-input"
            placeholder={isThinking ? "Processando..." : "Digite um comando..."}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={isThinking || state.orbState === "speaking"}
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" onClick={handleSend} disabled={!inputText.trim() || isThinking} style={{ padding: "8px 10px", flexShrink: 0 }} title="Enviar">
            <SendHorizontal size={13} />
          </button>
          <button
            className="btn btn-ghost"
            style={{ padding: "8px", flexShrink: 0, opacity: isListening ? 1 : 0.6, color: isListening ? "#ff3b3b" : undefined, border: isListening ? "1px solid #ff3b3b" : undefined }}
            title={isListening ? "Parar" : "Falar com JARVIS"}
            onClick={isListening ? stopListening : startListening}
          >
            <Mic size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard principal ────────────────────────────────────────

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("hub");
  const { state, sendCommand, startListening, stopListening, startNewSession, clearMessages } = useJarvis();

  const orbColorForBadge = {
    idle:      "badge-idle",
    listening: "badge-listening",
    thinking:  "badge-thinking",
    speaking:  "badge-speaking",
    error:     "badge-error",
  }[state.orbState] ?? "badge-idle";

  return (
    <div className="hud-grid">
      {/* ── Navbar ──────────────────────────────────────────── */}
      <nav className="hud-navbar">
        {/* Logo */}
        <div
          style={{
            fontFamily: "'Orbitron', monospace",
            fontSize: "13px",
            fontWeight: 700,
            letterSpacing: "0.3em",
            color: "var(--color-primary)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexShrink: 0,
          }}
        >
          <span style={{ opacity: 0.6 }}>◆</span>
          JARVIS OS
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", alignItems: "stretch", flex: 1, justifyContent: "center" }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`nav-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
              title={`${tab.label} (${tab.shortcut})`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Status bar */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
          {/* Estado do Orb */}
          <span className={`badge ${orbColorForBadge}`}>
            <div className={`pulse-dot ${state.orbState !== "idle" ? "active" : ""}`} />
            {state.orbState.toUpperCase()}
          </span>

          {/* Conexão */}
          <span
            title={state.connected ? "Conectado ao backend" : "Desconectado"}
            style={{ color: state.connected ? "#00c853" : "#ff3b3b" }}
          >
            {state.connected ? <Wifi size={13} /> : <WifiOff size={13} />}
          </span>

          {/* Nova sessão */}
          <button
            className="btn btn-ghost"
            onClick={startNewSession}
            title="Nova sessão"
            style={{ padding: "4px 6px" }}
          >
            <Plus size={12} />
          </button>
        </div>
      </nav>

      {/* ── Conteúdo das views ───────────────────────────────── */}
      <main style={{ overflow: "hidden", position: "relative" }}>
        {activeTab === "hub" && (
          <HubView
            state={state}
            sendCommand={sendCommand}
            startListening={startListening}
            stopListening={stopListening}
            isListening={state.isListening}
            clearMessages={clearMessages}
          />
        )}

        {activeTab === "console" && (
          <div style={{ height: "100%", padding: "12px" }}>
            <Console
              messages={state.messages}
              orbState={state.orbState}
              onSendCommand={sendCommand}
              onStartListening={startListening}
              onStopListening={stopListening}
              isListening={state.isListening}
              onClear={clearMessages}
            />
          </div>
        )}

        {activeTab === "agents" && (
          <div style={{ height: "100%", padding: "12px" }}>
            <AgentsPanel agents={state.agents} />
          </div>
        )}

        {activeTab === "deliveries" && (
          <div style={{ height: "100%", padding: "12px" }}>
            <DeliveriesPanel deliveries={[]} />
          </div>
        )}

        {activeTab === "brain" && (
          <div style={{ height: "100%", padding: "12px" }}>
            <div
              style={{
                height: "100%",
                background: "var(--color-bg-card)",
                borderRadius: "8px",
                border: "1px solid var(--color-border)",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div className="panel-header" style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 20 }}>
                <span>◈ VISUAL BRAIN — MAPA COGNITIVO</span>
              </div>
              <div style={{ height: "100%", paddingTop: "38px" }}>
                <VisualBrain graph={null} />
              </div>
            </div>
          </div>
        )}

        {/* Notificação de erro */}
        {state.lastError && (
          <div
            className="animate-fade-in"
            style={{
              position: "absolute",
              bottom: "16px",
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(127,29,29,0.9)",
              border: "1px solid #ff3b3b",
              borderRadius: "6px",
              padding: "8px 16px",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "#fca5a5",
              backdropFilter: "blur(8px)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              maxWidth: "400px",
              zIndex: 200,
            }}
          >
            <span style={{ color: "#ff3b3b" }}>⚠</span>
            {state.lastError}
          </div>
        )}
      </main>
    </div>
  );
}
