"use client";

/**
 * components/VisualBrain.tsx
 *
 * Mapa cognitivo interativo usando ReactFlow (grafo 2D).
 * Cada execução do Task Graph Engine gera um grafo visual.
 *
 * Tipos de nós:
 *   task   → azul  (#1e88e5)
 *   agent  → verde (#00c853)
 *   memory → roxo  (#7c3aed)
 *   result → dourado (#f59e0b)
 *
 * Clique em um nó → painel lateral com detalhes
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type NodeTypes,
  type Connection,
  BackgroundVariant,
  MarkerType,
  Handle,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import { X, Clock, User, CheckCircle, AlertCircle } from "lucide-react";
import type { TaskGraph, GraphNode } from "@/hooks/useJarvisWS";

// ── Configurações de cor por tipo ──────────────────────────────

const NODE_COLORS: Record<string, { bg: string; border: string; glow: string; text: string }> = {
  task:   { bg: "#0a1f3d", border: "#1e88e5", glow: "rgba(30,136,229,0.4)",  text: "#64b5f6" },
  agent:  { bg: "#0a2010", border: "#00c853", glow: "rgba(0,200,83,0.4)",    text: "#69f0ae" },
  memory: { bg: "#1a0a40", border: "#7c3aed", glow: "rgba(124,58,237,0.4)",  text: "#a78bfa" },
  result: { bg: "#2a1a00", border: "#f59e0b", glow: "rgba(245,158,11,0.4)",  text: "#fbbf24" },
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#5a8aa0",
  running: "#00d4ff",
  success: "#00c853",
  error:   "#ff3b3b",
};

const TYPE_ICONS: Record<string, string> = {
  task:   "⬡",
  agent:  "◈",
  memory: "◎",
  result: "★",
};

// ── Nó customizado ─────────────────────────────────────────────

interface CustomNodeData {
  label: string;
  nodeType: string;
  agent?: string;
  status?: string;
  duration_ms?: number;
  result_preview?: string;
  selected?: boolean;
}

function CustomNode({ data, selected }: { data: CustomNodeData; selected: boolean }) {
  const colors = NODE_COLORS[data.nodeType] ?? NODE_COLORS.task;
  const statusColor = data.status ? STATUS_COLORS[data.status] ?? colors.border : colors.border;

  return (
    <div
      style={{
        background: colors.bg,
        border: `1.5px solid ${selected ? colors.glow.replace("0.4", "1") : statusColor}`,
        borderRadius: "8px",
        padding: "10px 14px",
        minWidth: "130px",
        maxWidth: "180px",
        boxShadow: selected
          ? `0 0 20px ${colors.glow}`
          : `0 0 8px ${colors.glow.replace("0.4", "0.2")}`,
        transition: "all 0.2s ease",
        cursor: "pointer",
        position: "relative",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: colors.border, border: "none", width: 8, height: 8 }}
      />

      {/* Tipo + status */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
        <span
          style={{
            fontFamily: "'Orbitron', monospace",
            fontSize: "14px",
            color: colors.text,
          }}
        >
          {TYPE_ICONS[data.nodeType]}
        </span>
        {data.status && (
          <div
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              background: statusColor,
              boxShadow: `0 0 6px ${statusColor}`,
            }}
          />
        )}
      </div>

      {/* Label */}
      <div
        style={{
          fontFamily: "var(--font-mono, 'Share Tech Mono', monospace)",
          fontSize: "10px",
          color: "rgba(255,255,255,0.9)",
          lineHeight: 1.4,
          wordBreak: "break-word",
          marginBottom: data.agent ? "4px" : 0,
        }}
      >
        {data.label}
      </div>

      {/* Agente responsável */}
      {data.agent && (
        <div
          style={{
            fontFamily: "'Orbitron', monospace",
            fontSize: "8px",
            color: colors.text,
            opacity: 0.7,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          /{data.agent}
        </div>
      )}

      {/* Duração */}
      {data.duration_ms !== undefined && (
        <div
          style={{
            fontSize: "9px",
            color: "rgba(255,255,255,0.4)",
            marginTop: "4px",
            fontFamily: "var(--font-mono, monospace)",
          }}
        >
          {Math.round(data.duration_ms)}ms
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: colors.border, border: "none", width: 8, height: 8 }}
      />
    </div>
  );
}

const nodeTypes: NodeTypes = { custom: CustomNode };

// ── Painel de detalhes do nó ───────────────────────────────────

function NodeDetailPanel({
  node,
  onClose,
}: {
  node: GraphNode;
  onClose: () => void;
}) {
  const colors = NODE_COLORS[node.type] ?? NODE_COLORS.task;

  return (
    <div
      className="animate-slide-right"
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        width: "260px",
        background: "var(--color-bg-card)",
        border: `1px solid ${colors.border}`,
        borderRadius: "8px",
        boxShadow: `0 0 20px ${colors.glow}`,
        zIndex: 100,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          borderBottom: "1px solid var(--color-border)",
          background: colors.bg,
        }}
      >
        <span
          style={{
            fontFamily: "'Orbitron', monospace",
            fontSize: "9px",
            letterSpacing: "0.12em",
            color: colors.text,
            textTransform: "uppercase",
          }}
        >
          {TYPE_ICONS[node.type]} {node.type}
        </span>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-text-dim)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          <X size={12} />
        </button>
      </div>

      {/* Conteúdo */}
      <div style={{ padding: "12px", fontSize: "12px" }}>
        {/* Label */}
        <div
          style={{
            fontFamily: "var(--font-mono, monospace)",
            color: "rgba(255,255,255,0.9)",
            marginBottom: "10px",
            lineHeight: 1.5,
          }}
        >
          {node.label}
        </div>

        {/* Agente */}
        {node.agent && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
            <User size={11} color="var(--color-text-dim)" />
            <span style={{ fontFamily: "monospace", fontSize: "11px", color: colors.text }}>
              /{node.agent}
            </span>
          </div>
        )}

        {/* Status */}
        {node.status && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
            {node.status === "success"
              ? <CheckCircle size={11} color="#00c853" />
              : node.status === "error"
              ? <AlertCircle size={11} color="#ff3b3b" />
              : <div className="pulse-dot active" />
            }
            <span
              style={{
                fontFamily: "monospace",
                fontSize: "11px",
                color: STATUS_COLORS[node.status] ?? "var(--color-text)",
                textTransform: "uppercase",
              }}
            >
              {node.status}
            </span>
          </div>
        )}

        {/* Duração */}
        {node.duration_ms !== undefined && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
            <Clock size={11} color="var(--color-text-dim)" />
            <span style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--color-text-dim)" }}>
              {Math.round(node.duration_ms)}ms
            </span>
          </div>
        )}

        {/* Preview do resultado */}
        {node.result_preview && (
          <div
            style={{
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
              padding: "8px",
              fontSize: "10px",
              fontFamily: "monospace",
              color: "var(--color-text-dim)",
              maxHeight: "100px",
              overflowY: "auto",
              lineHeight: 1.5,
            }}
          >
            {node.result_preview}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────

interface VisualBrainProps {
  graph: TaskGraph | null;
}

export default function VisualBrain({ graph }: VisualBrainProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  // Converte o grafo do backend para o formato ReactFlow
  useEffect(() => {
    if (!graph || !graph.nodes?.length) return;

    const cols = Math.ceil(Math.sqrt(graph.nodes.length));
    const rfNodes: Node[] = graph.nodes.map((n, idx) => ({
      id: n.id,
      type: "custom",
      position: {
        x: (idx % cols) * 220 + 40,
        y: Math.floor(idx / cols) * 140 + 40,
      },
      data: {
        label: n.label,
        nodeType: n.type,
        agent: n.agent,
        status: n.status,
        duration_ms: n.duration_ms,
        result_preview: n.result_preview,
      },
    }));

    const rfEdges: Edge[] = graph.edges.map((e, idx) => ({
      id: `e-${idx}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      animated: graph.status === "executing",
      style: { stroke: "rgba(0,212,255,0.4)", strokeWidth: 1.5 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "rgba(0,212,255,0.6)",
      },
      label: e.condition,
      labelStyle: {
        fontSize: 9,
        fill: "rgba(0,212,255,0.6)",
        fontFamily: "monospace",
      },
    }));

    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [graph, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (!graph) return;
      const original = graph.nodes.find((n) => n.id === node.id);
      setSelectedNode(original ?? null);
    },
    [graph]
  );

  if (!graph || !graph.nodes?.length) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--color-bg-surface)",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <div
          style={{
            fontFamily: "'Orbitron', monospace",
            fontSize: "11px",
            letterSpacing: "0.15em",
            color: "var(--color-text-dim)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "32px", marginBottom: "12px", opacity: 0.2 }}>◈</div>
          <div>VISUAL BRAIN</div>
          <div style={{ fontSize: "9px", marginTop: "6px", opacity: 0.5 }}>
            O mapa cognitivo aparece durante execuções complexas
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        attributionPosition="bottom-right"
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="rgba(0,212,255,0.06)"
        />
        <Controls
          style={{
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
          }}
        />
        <MiniMap
          nodeColor={(node) => {
            const colors = NODE_COLORS[(node.data as CustomNodeData).nodeType] ?? NODE_COLORS.task;
            return colors.border;
          }}
          style={{
            background: "var(--color-bg-surface)",
            border: "1px solid var(--color-border)",
          }}
        />
      </ReactFlow>

      {/* Painel de status do grafo */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          background: "rgba(6,15,28,0.85)",
          border: "1px solid var(--color-border)",
          borderRadius: "6px",
          padding: "6px 12px",
          fontFamily: "'Orbitron', monospace",
          fontSize: "9px",
          letterSpacing: "0.1em",
          color: "var(--color-text-dim)",
          backdropFilter: "blur(8px)",
          zIndex: 10,
          display: "flex",
          gap: "14px",
        }}
      >
        <span>GRAPH: <span style={{ color: "var(--color-primary)" }}>{graph.graph_id.slice(0, 8)}</span></span>
        <span>NODOS: <span style={{ color: "var(--color-primary)" }}>{graph.nodes.length}</span></span>
        <span style={{
          color:
            graph.status === "success"   ? "#00c853" :
            graph.status === "error"     ? "#ff3b3b" :
            graph.status === "executing" ? "#00d4ff" :
            "var(--color-text-dim)",
        }}>
          {graph.status?.toUpperCase() ?? "PRONTO"}
        </span>
      </div>

      {/* Detalhe do nó selecionado */}
      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}
