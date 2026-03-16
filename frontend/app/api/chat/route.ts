/**
 * app/api/chat/route.ts
 *
 * API Route com Groq (gratuito, ultra-rápido via LPU).
 * Modelo padrão: llama-3.3-70b-versatile
 *
 * Free tier: 30 RPM, 14.400 req/dia, 6.000 tokens/min
 * Obtenha sua chave em: https://console.groq.com/keys
 */

import Groq from "groq-sdk";
import { AGENTS, detectAgent } from "@/lib/agents";

export const runtime = "nodejs";
export const maxDuration = 60;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

export async function POST(req: Request) {
  try {
    const { text, history = [], agentName } = await req.json();

    if (!text?.trim()) {
      return Response.json({ error: "Texto vazio." }, { status: 400 });
    }

    const selectedAgent = agentName || detectAgent(text);
    const agent = AGENTS[selectedAgent] || AGENTS["analyst"];

    // Groq usa o mesmo formato do OpenAI — sem conversão necessária
    const messages: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: agent.systemPrompt },
      ...history.slice(-20).map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: text },
    ];

    const stream = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages,
      stream: true,
      max_tokens: 8192,
      temperature: 0.7,
    });

    const encoder = new TextEncoder();
    let fullText = "";

    const readable = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "start",
                agent: agent.name,
                agentLabel: agent.label,
              })}\n\n`
            )
          );

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content ?? "";
            if (delta) {
              fullText += delta;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "delta", text: delta })}\n\n`
                )
              );
            }
          }

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
