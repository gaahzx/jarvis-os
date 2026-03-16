"use client";

/**
 * components/FeedbackButtons.tsx
 *
 * Botões 👍/👎 por interação.
 * Enviados ao backend via WebSocket para o sistema de auto-melhoria.
 */

import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";

interface FeedbackButtonsProps {
  interactionId: string;
  onFeedback: (interactionId: string, feedback: "positive" | "negative") => void;
}

export default function FeedbackButtons({ interactionId, onFeedback }: FeedbackButtonsProps) {
  const [voted, setVoted] = useState<"positive" | "negative" | null>(null);

  const handle = (feedback: "positive" | "negative") => {
    if (voted) return; // uma vez apenas
    setVoted(feedback);
    onFeedback(interactionId, feedback);
  };

  return (
    <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
      <button
        onClick={() => handle("positive")}
        disabled={!!voted}
        title="Útil"
        style={{
          background: "transparent",
          border: "none",
          cursor: voted ? "default" : "pointer",
          padding: "3px 6px",
          borderRadius: "4px",
          color:
            voted === "positive" ? "#00c853" :
            voted === "negative" ? "var(--color-text-dim)" :
            "var(--color-text-dim)",
          opacity: voted && voted !== "positive" ? 0.3 : 0.7,
          transition: "all 150ms ease",
          display: "flex",
          alignItems: "center",
          gap: "3px",
          fontSize: "10px",
          fontFamily: "var(--font-mono)",
        }}
      >
        <ThumbsUp size={11} />
        {voted === "positive" && <span>Obrigado!</span>}
      </button>

      <button
        onClick={() => handle("negative")}
        disabled={!!voted}
        title="Não útil"
        style={{
          background: "transparent",
          border: "none",
          cursor: voted ? "default" : "pointer",
          padding: "3px 6px",
          borderRadius: "4px",
          color:
            voted === "negative" ? "#ff3b3b" :
            voted === "positive" ? "var(--color-text-dim)" :
            "var(--color-text-dim)",
          opacity: voted && voted !== "negative" ? 0.3 : 0.7,
          transition: "all 150ms ease",
          display: "flex",
          alignItems: "center",
          gap: "3px",
          fontSize: "10px",
          fontFamily: "var(--font-mono)",
        }}
      >
        <ThumbsDown size={11} />
        {voted === "negative" && <span>Registrado</span>}
      </button>
    </div>
  );
}
