/**
 * app/api/chat/route.ts
 *
 * API Route com xAI Grok (gratuito, com acesso à internet via web search).
 * Modelo: grok-3-mini-beta
 *
 * Free tier: $25/mês em créditos grátis
 * Obtenha sua chave em: https://console.x.ai
 */

import OpenAI from "openai";
import { AGENTS, detectAgent } from "@/lib/agents";

export const runtime = "nodejs";
export const maxDuration = 60;

const xai = new OpenAI({
  apiKey: process.env.XAI_API_KEY!,
  baseURL: "https://api.x.ai/v1",
});

// Palavras-chave que indicam necessidade de busca em tempo real
const REALTIME_KEYWORDS =
  /clima|tempo|temperatura|chuva|previsão|notícias?|noticias?|hoje|amanhã|amanha|agora|atual|recente|última|ultima|preço|cotação|cotacao|dólar|dollar|bitcoin|btc|jogo|resultado|placar/i;

export async function POST(req: Request) {
  try {
    const { text, history = [], agentName } = await req.json();

    if (!text?.trim()) {
      return Response.json({ error: "Texto vazio." }, { status: 400 });
    }

    const selectedAgent = agentName || detectAgent(text);
    const agent = AGENTS[selectedAgent] || AGENTS["analyst"];

    const needsSearch = REALTIME_KEYWORDS.test(text);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: agent.systemPrompt },
      ...history.slice(-20).map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: text },
    ];

    const requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: "grok-3-mini-beta",
      messages,
      stream: true,
      max_tokens: 8192,
      temperature: 0.7,
    };

    // Ativa busca na web para perguntas sobre tempo real
    if (needsSearch) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (requestParams as any)["search_parameters"] = { mode: "auto" };
    }

    const stream = await xai.chat.completions.create(requestParams);

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
