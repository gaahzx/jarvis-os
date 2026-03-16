"use client";

/**
 * components/Orb.tsx
 *
 * Esfera 3D pulsante com React Three Fiber.
 * Cada estado do Orb tem cor, velocidade de animação e efeitos distintos.
 *
 * Estados:
 *   idle      → pulsação lenta, azul escuro
 *   listening → ondulações responsivas, azul claro
 *   thinking  → rotação + partículas orbitando, roxo
 *   speaking  → expansão rítmica, ciano
 *   error     → tremor + flash vermelho
 */

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere, MeshDistortMaterial, Float, Stars, Ring } from "@react-three/drei";
import * as THREE from "three";
import type { OrbState } from "@/hooks/useJarvisWS";

// ── Config por estado ──────────────────────────────────────────

const STATE_CONFIG: Record<OrbState, {
  color: string;
  emissive: string;
  emissiveIntensity: number;
  distort: number;
  speed: number;
  scale: number;
  ringColor: string;
  ringOpacity: number;
}> = {
  idle: {
    color: "#0a2440",
    emissive: "#003366",
    emissiveIntensity: 0.4,
    distort: 0.2,
    speed: 0.8,
    scale: 1.0,
    ringColor: "#003366",
    ringOpacity: 0.15,
  },
  listening: {
    color: "#00d4ff",
    emissive: "#00aacc",
    emissiveIntensity: 0.8,
    distort: 0.45,
    speed: 2.5,
    scale: 1.08,
    ringColor: "#00d4ff",
    ringOpacity: 0.5,
  },
  thinking: {
    color: "#5b21b6",
    emissive: "#7c3aed",
    emissiveIntensity: 1.0,
    distort: 0.55,
    speed: 4.0,
    scale: 1.05,
    ringColor: "#8b5cf6",
    ringOpacity: 0.6,
  },
  speaking: {
    color: "#00ffd4",
    emissive: "#00ccaa",
    emissiveIntensity: 1.2,
    distort: 0.65,
    speed: 5.0,
    scale: 1.12,
    ringColor: "#00ffd4",
    ringOpacity: 0.7,
  },
  error: {
    color: "#7f1d1d",
    emissive: "#ff3b3b",
    emissiveIntensity: 1.5,
    distort: 0.8,
    speed: 8.0,
    scale: 0.98,
    ringColor: "#ff3b3b",
    ringOpacity: 0.8,
  },
};

// ── Componente 3D interno ──────────────────────────────────────

function OrbMesh({ orbState }: { orbState: OrbState }) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const ring1Ref = useRef<THREE.Mesh>(null!);
  const ring2Ref = useRef<THREE.Mesh>(null!);
  const cfg = STATE_CONFIG[orbState];

  // Cor interpolada suavemente
  const targetColor = useMemo(() => new THREE.Color(cfg.color), [cfg.color]);
  const currentColor = useRef(new THREE.Color(cfg.color));

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();

    // Lerp de cor
    currentColor.current.lerp(targetColor, delta * 3);
    (meshRef.current.material as THREE.MeshStandardMaterial).color.copy(currentColor.current);

    // Escala pulsante conforme o estado
    if (orbState === "idle") {
      meshRef.current.scale.setScalar(1.0 + Math.sin(t * 0.8) * 0.03);
    } else if (orbState === "listening") {
      meshRef.current.scale.setScalar(1.08 + Math.sin(t * 4) * 0.05);
    } else if (orbState === "thinking") {
      meshRef.current.rotation.y += delta * 0.8;
      meshRef.current.scale.setScalar(1.05 + Math.sin(t * 3) * 0.04);
    } else if (orbState === "speaking") {
      meshRef.current.scale.setScalar(1.12 + Math.sin(t * 8) * 0.08);
    } else if (orbState === "error") {
      // Tremor
      meshRef.current.position.x = Math.sin(t * 30) * 0.04;
      meshRef.current.position.y = Math.cos(t * 25) * 0.02;
    }

    // Anéis orbitando (visíveis em thinking e speaking)
    if (ring1Ref.current) {
      ring1Ref.current.rotation.x = t * 0.6;
      ring1Ref.current.rotation.y = t * 0.4;
      ring1Ref.current.material.opacity = cfg.ringOpacity;
    }
    if (ring2Ref.current) {
      ring2Ref.current.rotation.x = -t * 0.5;
      ring2Ref.current.rotation.z = t * 0.3;
      ring2Ref.current.material.opacity = cfg.ringOpacity * 0.6;
    }
  });

  return (
    <group>
      {/* Anel orbital 1 */}
      <Ring
        ref={ring1Ref}
        args={[1.35, 1.45, 64]}
      >
        <meshBasicMaterial
          color={cfg.ringColor}
          transparent
          opacity={cfg.ringOpacity}
          side={THREE.DoubleSide}
        />
      </Ring>

      {/* Anel orbital 2 */}
      <Ring
        ref={ring2Ref}
        args={[1.55, 1.62, 64]}
      >
        <meshBasicMaterial
          color={cfg.ringColor}
          transparent
          opacity={cfg.ringOpacity * 0.5}
          side={THREE.DoubleSide}
        />
      </Ring>

      {/* Orb principal */}
      <Sphere ref={meshRef} args={[1, 128, 128]}>
        <MeshDistortMaterial
          color={cfg.color}
          emissive={cfg.emissive}
          emissiveIntensity={cfg.emissiveIntensity}
          distort={cfg.distort}
          speed={cfg.speed}
          roughness={0.1}
          metalness={0.3}
          transparent
          opacity={0.92}
        />
      </Sphere>

      {/* Núcleo interno (brilho) */}
      <Sphere args={[0.55, 32, 32]}>
        <meshBasicMaterial
          color={cfg.emissive}
          transparent
          opacity={0.25}
        />
      </Sphere>
    </group>
  );
}

// ── Componente raiz exportado ──────────────────────────────────

interface OrbProps {
  orbState: OrbState;
  size?: number;        // tamanho em px do canvas
}

export default function Orb({ orbState, size = 320 }: OrbProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        position: "relative",
        filter: orbState === "error"
          ? "drop-shadow(0 0 20px rgba(255,59,59,0.6))"
          : orbState === "speaking"
          ? "drop-shadow(0 0 25px rgba(0,255,212,0.5))"
          : orbState === "thinking"
          ? "drop-shadow(0 0 25px rgba(139,92,246,0.5))"
          : orbState === "listening"
          ? "drop-shadow(0 0 20px rgba(0,212,255,0.5))"
          : "drop-shadow(0 0 12px rgba(0,100,180,0.3))",
        transition: "filter 0.6s ease",
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 3.5], fov: 50 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
      >
        {/* Iluminação */}
        <ambientLight intensity={0.3} />
        <pointLight position={[5, 5, 5]} intensity={1.5} color="#00d4ff" />
        <pointLight position={[-5, -3, -5]} intensity={0.8} color="#7c3aed" />
        <pointLight position={[0, -5, 2]} intensity={0.5} color="#ffffff" />

        {/* Estrelas de fundo */}
        <Stars
          radius={15}
          depth={5}
          count={300}
          factor={2}
          saturation={0.3}
          fade
        />

        {/* Orb com Float para movimento suave */}
        <Float
          speed={orbState === "idle" ? 1.5 : 3}
          rotationIntensity={orbState === "thinking" ? 0.3 : 0.1}
          floatIntensity={orbState === "idle" ? 0.8 : 0.4}
        >
          <OrbMesh orbState={orbState} />
        </Float>
      </Canvas>

      {/* Label de estado abaixo do Orb */}
      <div
        style={{
          position: "absolute",
          bottom: -28,
          left: "50%",
          transform: "translateX(-50%)",
          fontFamily: "'Orbitron', monospace",
          fontSize: "9px",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color:
            orbState === "idle"      ? "rgba(0,100,180,0.6)" :
            orbState === "listening" ? "#00d4ff" :
            orbState === "thinking"  ? "#8b5cf6" :
            orbState === "speaking"  ? "#00ffd4" :
                                       "#ff3b3b",
          whiteSpace: "nowrap",
          transition: "color 0.3s ease",
        }}
      >
        {orbState === "idle"      && "◆ STANDBY"}
        {orbState === "listening" && "◉ OUVINDO"}
        {orbState === "thinking"  && "◈ PROCESSANDO"}
        {orbState === "speaking"  && "◎ FALANDO"}
        {orbState === "error"     && "⚠ ERRO"}
      </div>
    </div>
  );
}
