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
import { useState } from "react";
import { Cpu, MessageSquare, Bot, FolderOpen, Network, Wifi, WifiOff, Plus } from "lucide-react";
import { useJarvisWS } from "@/hooks/useJarvisWS";
import Console from "@/components/Console";
import AgentsPanel from "@/components/AgentsPanel";
import DeliveriesPanel from "@/components/DeliveriesPanel";
import FeedbackButtons from "@/components/FeedbackButtons";

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

function HubView({ state, sendCommand, onFeedback }: {
  state: ReturnType<typeof useJarvisWS>["state"];
  sendCommand: (t: string) => void;
  onFeedback: (id: string, f: "positive" | "negative") => void;
}) {
  const [quickInput, setQuickInput] = useState("");

  const quickCommands = [
    "Qual é o seu status atual?",
    "Analise tendências de IA em 2024",
    "Gere um relatório de produtividade",
    "Resuma as últimas notícias de tecnologia",
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr auto",
        gap: "16px",
        height: "100%",
        padding: "16px",
      }}
    >
      {/* Orb central */}
      <div
        style={{
          gridColumn: "1",
          gridRow: "1",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: "40px",
        }}
      >
        <Orb orbState={state.orbState} size={280} />

        {/* Status info */}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: "'Orbitron', monospace",
              fontSize: "18px",
              fontWeight: 700,
              letterSpacing: "0.3em",
              color: "rgba(0,212,255,0.9)",
              marginBottom: "6px",
            }}
          >
            J.A.R.V.I.S.
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              color: "var(--color-text-dim)",
              letterSpacing: "0.1em",
            }}
          >
            {state.sessionId
              ? `SESSION: ${state.sessionId.slice(0, 8).toUpperCase()}`
              : "INICIALIZANDO..."}
          </div>
        </div>
      </div>

      {/* Painel direito: stats + comandos rápidos */}
      <div
        style={{
          gridColumn: "2",
          gridRow: "1",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {/* Métricas */}
        <div className="panel" style={{ padding: "14px" }}>
          <div className="panel-header" style={{ marginBottom: "12px", padding: 0, border: "none" }}>
            MÉTRICAS DA SESSÃO
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            {[
              { label: "MENSAGENS", value: state.messages.length, color: "var(--color-primary)" },
              { label: "ENTREGAS",  value: state.deliveries.length, color: "var(--color-agent-result)" },
              { label: "AGENTES",   value: state.agents.length, color: "#00c853" },
              { label: "STATUS",    value: state.orbState.toUpperCase(), color: "var(--color-text-dim)" },
            ].map((m) => (
              <div
                key={m.label}
                style={{
                  background: "var(--color-bg-elevated)",
                  borderRadius: "6px",
                  padding: "10px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontFamily: "'Orbitron', monospace",
                    fontSize: "18px",
                    fontWeight: 700,
                    color: m.color,
                    lineHeight: 1,
                    marginBottom: "4px",
                  }}
                >
                  {m.value}
                </div>
                <div style={{ fontSize: "8px", letterSpacing: "0.1em", color: "var(--color-text-dim)" }}>
                  {m.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Comandos rápidos */}
        <div className="panel" style={{ flex: 1, overflow: "hidden" }}>
          <div className="panel-header">COMANDOS RÁPIDOS</div>
          <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
            {quickCommands.map((cmd) => (
              <button
                key={cmd}
                onClick={() => sendCommand(cmd)}
                style={{
                  background: "var(--color-bg-elevated)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "4px",
                  padding: "8px 12px",
                  color: "var(--color-text)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(0,212,255,0.3)";
                  e.currentTarget.style.background = "rgba(0,212,255,0.05)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-border)";
                  e.currentTarget.style.background = "var(--color-bg-elevated)";
                }}
              >
                › {cmd}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Última mensagem no rodapé */}
      {state.messages.length > 0 && (
        <div
          style={{
            gridColumn: "1 / -1",
            gridRow: "2",
            background: "var(--color-bg-card)",
            borderRadius: "6px",
            padding: "10px 14px",
            border: "1px solid var(--color-border)",
            display: "flex",
            gap: "12px",
            alignItems: "flex-start",
            maxHeight: "80px",
            overflow: "hidden",
          }}
        >
          <span style={{ fontFamily: "'Orbitron', monospace", fontSize: "9px", color: "var(--color-thinking)", flexShrink: 0 }}>
            ÚLTIMA RESPOSTA
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-dim)", lineHeight: 1.5, overflow: "hidden" }}>
            {state.messages.filter((m) => m.role === "assistant").slice(-1)[0]?.content.slice(0, 200)}
            {(state.messages.filter((m) => m.role === "assistant").slice(-1)[0]?.content.length ?? 0) > 200 && "..."}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Dashboard principal ────────────────────────────────────────

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("hub");
  const { state, sendCommand, sendFeedback, startNewSession, clearMessages } = useJarvisWS();

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
          <HubView state={state} sendCommand={sendCommand} onFeedback={sendFeedback} />
        )}

        {activeTab === "console" && (
          <div style={{ height: "100%", padding: "12px" }}>
            <Console
              messages={state.messages}
              orbState={state.orbState}
              onSendCommand={sendCommand}
              onFeedback={sendFeedback}
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
            <DeliveriesPanel deliveries={state.deliveries} />
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
              {/* Header do Visual Brain */}
              <div className="panel-header" style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 20 }}>
                <span>◈ VISUAL BRAIN — MAPA COGNITIVO</span>
                {state.activeGraph && (
                  <span style={{ marginLeft: "auto", fontSize: "9px", color: "var(--color-primary-dim)" }}>
                    {state.activeGraph.nodes.length} NÓS ATIVOS
                  </span>
                )}
              </div>
              <div style={{ height: "100%", paddingTop: "38px" }}>
                <VisualBrain graph={state.activeGraph} />
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
