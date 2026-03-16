"use client";

/**
 * components/Orb.tsx
 *
 * Orb central do JARVIS — idêntico ao design do PROJETO JARVIS.
 * Canvas com waveform, anéis giratórios, padrão arc-reactor e glow dinâmico.
 */

import { useEffect, useRef } from "react";
import type { OrbState } from "@/hooks/useJarvis";

interface OrbProps {
  orbState: OrbState;
  size?: number;
  analyserRef?: React.RefObject<AnalyserNode | null>;
}

// ── Configuração por estado ────────────────────────────────────────────────────

const STATE_LABELS: Record<OrbState, string> = {
  idle:      "STANDBY",
  listening: "LISTENING",
  thinking:  "PROCESSING",
  speaking:  "RESPONDING",
  error:     "ERROR",
};

const STATE_COLORS: Record<OrbState, string> = {
  idle:      "#00d4ff",
  listening: "#00ffff",
  thinking:  "#ff8c00",
  speaking:  "#00ffff",
  error:     "#ff3b3b",
};

const STATE_ANIMATIONS: Record<OrbState, string> = {
  idle:      "animate-orb-pulse",
  listening: "animate-orb-pulse",
  thinking:  "animate-orb-think",
  speaking:  "animate-orb-speak",
  error:     "animate-orb-think",
};

// ── Componente ─────────────────────────────────────────────────────────────────

export default function Orb({ orbState, size = 280, analyserRef }: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const color = STATE_COLORS[orbState];
  const anim = STATE_ANIMATIONS[orbState];
  const label = STATE_LABELS[orbState];

  // Escala relativa ao tamanho padrão 280px
  const scale = size / 280;
  const ring3 = Math.round(320 * scale);
  const ring2 = Math.round(280 * scale);
  const ring1 = Math.round(240 * scale);
  const orbD  = Math.round(200 * scale);
  const arc1  = Math.round(140 * scale);
  const arc2  = Math.round(100 * scale);
  const dot   = Math.round(16  * scale);
  const cvW   = Math.round(120 * scale);
  const cvH   = Math.round(60  * scale);

  // ── Canvas waveform ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const analyser = analyserRef?.current;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (!analyser || (orbState !== "speaking" && orbState !== "listening")) {
        // Onda suave estática
        ctx.beginPath();
        ctx.strokeStyle = color + "80";
        ctx.lineWidth = 1.5;
        const amp = orbState === "thinking" ? 6 : orbState === "error" ? 8 : 3;
        for (let x = 0; x < w; x++) {
          const y = h / 2 + Math.sin((x / w) * Math.PI * 4 + Date.now() / 500) * amp;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        // Barras de frequência
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        const barW = (w / dataArray.length) * 2.5;
        let x = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const barH = (dataArray[i] / 255) * h * 0.8;
          const alpha = dataArray[i] / 255;
          ctx.fillStyle = `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
          ctx.fillRect(x, h - barH, barW - 1, barH);
          x += barW;
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [orbState, color, analyserRef]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "24px" }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>

        {/* Ring 3 */}
        <div style={{
          position: "absolute", width: ring3, height: ring3, borderRadius: "50%",
          border: `1px solid ${color}10`,
          animation: "ring-spin 14s linear infinite reverse",
        }} />

        {/* Ring 2 */}
        <div style={{
          position: "absolute", width: ring2, height: ring2, borderRadius: "50%",
          border: `1px dashed ${color}20`,
          animation: "ring-spin 10s linear infinite",
        }} />

        {/* Ring 1 */}
        <div style={{
          position: "absolute", width: ring1, height: ring1, borderRadius: "50%",
          border: `1px solid ${color}30`,
          animation: "ring-spin 6s linear infinite reverse",
        }} />

        {/* Orb principal */}
        <div className={anim} style={{
          position: "relative", width: orbD, height: orbD, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: `radial-gradient(ellipse at center, ${color}20 0%, ${color}08 50%, transparent 80%)`,
          border: `1px solid ${color}60`,
          boxShadow: `0 0 30px ${color}40, 0 0 60px ${color}20, inset 0 0 30px ${color}10`,
        }}>

          {/* Arc reactor — anel externo */}
          <div style={{
            position: "absolute", width: arc1, height: arc1, borderRadius: "50%",
            border: "1px solid transparent",
            borderTopColor: color,
            borderRightColor: `${color}40`,
            borderBottomColor: `${color}40`,
            borderLeftColor: `${color}40`,
            animation: "ring-spin 3s linear infinite",
          }} />

          {/* Arc reactor — anel interno */}
          <div style={{
            position: "absolute", width: arc2, height: arc2, borderRadius: "50%",
            border: "1px solid transparent",
            borderTopColor: `${color}30`,
            borderBottomColor: `${color}80`,
            borderLeftColor: `${color}30`,
            borderRightColor: `${color}30`,
            animation: "ring-spin 2s linear infinite reverse",
          }} />

          {/* Canvas waveform */}
          <canvas ref={canvasRef} width={cvW} height={cvH}
            style={{ position: "absolute", borderRadius: "50%", mixBlendMode: "screen" }}
          />

          {/* Ponto central */}
          <div style={{
            width: dot, height: dot, borderRadius: "50%",
            background: color,
            boxShadow: `0 0 10px ${color}, 0 0 20px ${color}`,
            zIndex: 10,
          }} />
        </div>
      </div>

      {/* Status label */}
      <div style={{ textAlign: "center" }}>
        <p style={{
          fontFamily: "'Orbitron', monospace",
          fontSize: "14px",
          letterSpacing: "0.3em",
          fontWeight: 700,
          color,
          textShadow: `0 0 10px ${color}`,
          margin: 0,
        }}>
          {label}
        </p>
        <p style={{
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          color: "#00d4ff80",
          letterSpacing: "0.15em",
          marginTop: "4px",
        }}>
          {orbState === "idle" ? 'SAY "JARVIS" TO ACTIVATE' : "J.A.R.V.I.S ACTIVE"}
        </p>
      </div>

      <style>{`
        @keyframes ring-spin {
          0%   { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .animate-orb-pulse {
          animation: orb-pulse 2s ease-in-out infinite;
        }
        .animate-orb-think {
          animation: orb-think 0.6s ease-in-out infinite;
        }
        .animate-orb-speak {
          animation: orb-speak 0.25s ease-in-out infinite;
        }
        @keyframes orb-pulse {
          0%, 100% { transform: scale(1);    box-shadow: 0 0 30px #00d4ff, 0 0 60px #0080ff40; }
          50%       { transform: scale(1.07); box-shadow: 0 0 60px #00d4ff, 0 0 120px #0080ff, 0 0 180px #00408080; }
        }
        @keyframes orb-think {
          0%, 100% { transform: scale(1);    box-shadow: 0 0 30px #ff8c00, 0 0 60px #ff6b0040; }
          50%       { transform: scale(1.05); box-shadow: 0 0 60px #ff8c00, 0 0 120px #ff6b00; }
        }
        @keyframes orb-speak {
          0%, 100% { transform: scale(1);   box-shadow: 0 0 40px #00ffff, 0 0 80px #00d4ff; }
          50%       { transform: scale(1.1); box-shadow: 0 0 80px #00ffff, 0 0 160px #00d4ff, 0 0 240px #0080ff; }
        }
      `}</style>
    </div>
  );
}
