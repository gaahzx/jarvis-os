"use client";

/**
 * components/DeliveriesPanel.tsx
 *
 * Painel de arquivos gerados e entregues ao usuário.
 * Mostra URL pública, tipo de arquivo e botão de download.
 */

import { useState, useEffect } from "react";
import { Download, FileText, FileCode, File } from "lucide-react";
import type { Delivery } from "@/hooks/useJarvisWS";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface DeliveriesPanelProps {
  deliveries: Delivery[];
}

const FILE_ICONS: Record<string, React.ReactNode> = {
  pdf:  <FileText size={14} color="#f59e0b" />,
  md:   <FileCode size={14} color="#00d4ff" />,
  txt:  <File size={14} color="#8b5cf6" />,
  json: <FileCode size={14} color="#00c853" />,
  py:   <FileCode size={14} color="#f59e0b" />,
};

function FileIcon({ type }: { type?: string }) {
  return <>{FILE_ICONS[type ?? ""] ?? <File size={14} color="var(--color-text-dim)" />}</>;
}

function formatFilename(url: string, filename?: string): string {
  if (filename) return filename;
  try {
    const parts = new URL(url).pathname.split("/");
    return parts[parts.length - 1] || "arquivo";
  } catch {
    return "arquivo";
  }
}

export default function DeliveriesPanel({ deliveries: wsPropDeliveries }: DeliveriesPanelProps) {
  const [deliveries, setDeliveries] = useState<Delivery[]>(wsPropDeliveries);
  const [loading, setLoading] = useState(false);

  // Carrega entregas do backend ao montar
  useEffect(() => {
    const fetch_deliveries = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/deliveries?limit=30`);
        if (res.ok) {
          const data = await res.json();
          setDeliveries(data.deliveries ?? []);
        }
      } catch {
        // fallback para props do WS
      } finally {
        setLoading(false);
      }
    };
    fetch_deliveries();
  }, []);

  // Mescla novas entregas vindas via WS
  useEffect(() => {
    if (wsPropDeliveries.length > 0) {
      setDeliveries((prev) => {
        const existingUrls = new Set(prev.map((d) => d.url));
        const newOnes = wsPropDeliveries.filter((d) => !existingUrls.has(d.url));
        return [...newOnes, ...prev].slice(0, 50);
      });
    }
  }, [wsPropDeliveries]);

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
      <div className="panel-header" style={{ justifyContent: "space-between" }}>
        <span>◆ ARQUIVOS ENTREGUES</span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: "9px",
            color: "var(--color-agent-result)",
            opacity: 0.7,
          }}
        >
          {deliveries.length} ARQUIVO{deliveries.length !== 1 ? "S" : ""}
        </span>
      </div>

      {/* Lista */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {loading && (
          <div style={{ padding: "16px" }}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="skeleton"
                style={{ height: "42px", borderRadius: "6px", marginBottom: "6px" }}
              />
            ))}
          </div>
        )}

        {!loading && deliveries.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: "var(--color-text-dim)",
              fontSize: "11px",
              padding: "30px 16px",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.05em",
            }}
          >
            <div style={{ fontSize: "24px", marginBottom: "8px", opacity: 0.3 }}>📁</div>
            <div>Nenhum arquivo gerado ainda</div>
            <div style={{ fontSize: "9px", marginTop: "4px", opacity: 0.5 }}>
              Peça ao Jarvis para gerar um relatório
            </div>
          </div>
        )}

        {deliveries.map((delivery, idx) => {
          const ext = delivery.file_type ??
            delivery.url.split(".").pop()?.toLowerCase() ?? "";
          const name = formatFilename(delivery.url, delivery.filename);

          return (
            <div
              key={delivery.url + idx}
              className="animate-fade-in-up"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "8px 10px",
                marginBottom: "4px",
                borderRadius: "6px",
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
                transition: "border-color 0.2s ease",
                cursor: "default",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.borderColor = "rgba(0,212,255,0.3)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.borderColor = "var(--color-border)")
              }
            >
              {/* Ícone */}
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "6px",
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <FileIcon type={ext} />
              </div>

              {/* Nome */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    color: "var(--color-text)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {name}
                </div>
                {delivery.created_at && (
                  <div
                    style={{
                      fontSize: "9px",
                      color: "var(--color-text-dim)",
                      marginTop: "2px",
                    }}
                  >
                    {new Date(delivery.created_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                )}
              </div>

              {/* Badge de tipo */}
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "8px",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color:
                    ext === "pdf" ? "#f59e0b" :
                    ext === "md"  ? "#00d4ff" :
                    ext === "py"  ? "#f59e0b" :
                    "var(--color-text-dim)",
                  border: "1px solid",
                  borderColor:
                    ext === "pdf" ? "rgba(245,158,11,0.3)" :
                    ext === "md"  ? "rgba(0,212,255,0.3)" :
                    "rgba(255,255,255,0.1)",
                  borderRadius: "3px",
                  padding: "1px 5px",
                  flexShrink: 0,
                }}
              >
                {ext || "FILE"}
              </span>

              {/* Download */}
              <a
                href={delivery.url}
                target="_blank"
                rel="noopener noreferrer"
                title="Baixar arquivo"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "28px",
                  height: "28px",
                  borderRadius: "4px",
                  background: "rgba(0,212,255,0.05)",
                  border: "1px solid rgba(0,212,255,0.15)",
                  color: "var(--color-primary-dim)",
                  textDecoration: "none",
                  transition: "all 0.15s ease",
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(0,212,255,0.15)";
                  e.currentTarget.style.color = "var(--color-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(0,212,255,0.05)";
                  e.currentTarget.style.color = "var(--color-primary-dim)";
                }}
              >
                <Download size={12} />
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
