"use client";

/**
 * components/AgentsPanel.tsx
 *
 * Painel de agentes ativos — lista todos os agentes registrados
 * e mostra status em tempo real (idle / running).
 */

import type { AgentInfo } from "@/hooks/useJarvisWS";

const AGENT_ICONS: Record<string, string> = {
  research:   "🔍",
  writer:     "✍️",
  analyst:    "📊",
  coder:      "💻",
  summarizer: "📝",
  file_gen:   "📄",
};

const AGENT_DESCRIPTIONS_PT: Record<string, string> = {
  research:   "Pesquisa e coleta de informações",
  writer:     "Redação de textos e documentos",
  analyst:    "Análise de dados e tendências",
  coder:      "Geração e revisão de código",
  summarizer: "Síntese e resumo de conteúdo",
  file_gen:   "Geração de arquivos PDF/MD",
};

interface AgentsPanelProps {
  agents: AgentInfo[];
}

export default function AgentsPanel({ agents }: AgentsPanelProps) {
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
      <div className="corner-tl" /><div className="corner-tr" />
      <div className="corner-bl" /><div className="corner-br" />

      {/* Header */}
      <div className="panel-header">
        <span>◆ AGENTES DO SISTEMA</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: "9px",
            color: "#00c853",
            opacity: 0.7,
          }}
        >
          {agents.length} ONLINE
        </span>
      </div>

      {/* Lista */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {agents.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: "var(--color-text-dim)",
              fontSize: "11px",
              padding: "20px",
              fontFamily: "var(--font-mono)",
            }}
          >
            Carregando agentes...
          </div>
        )}

        {agents.map((agent) => {
          const isRunning = agent.status === "running";
          return (
            <div key={agent.name} className="agent-item animate-fade-in">
              {/* Ícone */}
              <div
                className="agent-icon"
                style={{
                  borderColor: isRunning
                    ? "rgba(0,200,83,0.5)"
                    : "rgba(0,212,255,0.2)",
                  boxShadow: isRunning
                    ? "0 0 8px rgba(0,200,83,0.3)"
                    : "none",
                  transition: "all 0.3s ease",
                }}
              >
                {AGENT_ICONS[agent.name] ?? "🤖"}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "var(--font-hud)",
                    fontSize: "10px",
                    letterSpacing: "0.08em",
                    color: isRunning ? "#00c853" : "var(--color-text)",
                    textTransform: "uppercase",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  {agent.name}
                  {isRunning && (
                    <div className="pulse-dot active" />
                  )}
                </div>
                <div
                  style={{
                    fontSize: "10px",
                    color: "var(--color-text-dim)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {AGENT_DESCRIPTIONS_PT[agent.name] ?? agent.description}
                </div>
              </div>

              {/* Status badge */}
              <span
                className={isRunning ? "badge badge-listening" : "badge badge-idle"}
                style={{ flexShrink: 0, fontSize: "8px" }}
              >
                {isRunning ? "EM USO" : "PRONTO"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Footer com info */}
      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid var(--color-border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "9px",
            color: "var(--color-text-dim)",
            letterSpacing: "0.05em",
          }}
        >
          ENGINE: CLAUDE SONNET
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "9px",
            color: "#00c853",
            opacity: 0.7,
          }}
        >
          ◉ SISTEMA OPERACIONAL
        </span>
      </div>
    </div>
  );
}
