/**
 * app/api/chat/route.ts
 *
 * API Route do Next.js que chama o Claude API com streaming (SSE).
 * Roda como serverless function no Vercel — sem backend separado.
 */

import Anthropic from "@anthropic-ai/sdk";
import { AGENTS, detectAgent } from "@/lib/agents";

export const runtime = "nodejs";
export const maxDuration = 60; // segundos (Vercel Pro permite 60s)

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const { text, history = [], agentName } = await req.json();

    if (!text?.trim()) {
      return Response.json({ error: "Texto vazio." }, { status: 400 });
    }

    // Seleciona agente (explícito ou auto-detectado)
    const selectedAgent = agentName || detectAgent(text);
    const agent = AGENTS[selectedAgent] || AGENTS["analyst"];

    // Monta histórico de mensagens
    const messages: Anthropic.MessageParam[] = [
      ...history.slice(-10), // últimas 10 trocas para não exceder contexto
      { role: "user", content: text },
    ];

    // Inicia stream do Claude
    const stream = await client.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: agent.systemPrompt,
      messages,
      stream: true,
    });

    const encoder = new TextEncoder();
    let fullText = "";

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Envia metadados iniciais
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "start",
                agent: agent.name,
                agentLabel: agent.label,
              })}\n\n`
            )
          );

          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              const chunk = event.delta.text;
              fullText += chunk;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "delta", text: chunk })}\n\n`
                )
              );
            }
          }

          // Envia mensagem de conclusão
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "done",
                text: fullText,
                agent: agent.name,
                agentLabel: agent.label,
              })}\n\n`
            )
          );
        } catch (err) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: String(err) })}\n\n`
            )
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("[/api/chat] Erro:", err);
    return Response.json({ error: "Erro interno." }, { status: 500 });
  }
}
