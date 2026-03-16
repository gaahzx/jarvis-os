/**
 * app/api/chat/route.ts
 *
 * Google Gemini 2.0 Flash — gratuito (1.500 req/dia, 15 RPM).
 * Google Search Grounding integrado: respostas com dados em tempo real.
 * Obtenha sua chave em: https://aistudio.google.com/apikey
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { AGENTS, detectAgent } from "@/lib/agents";

export const runtime = "nodejs";
export const maxDuration = 60;

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const REALTIME_KEYWORDS =
  /clima|tempo|temperatura|chuva|previsão|notícias?|hoje|amanhã|agora|atual|recente|última|preço|cotação|dólar|bitcoin|btc|jogo|resultado|placar/i;

export async function POST(req: Request) {
  try {
    const { text, history = [], agentName } = await req.json();

    if (!text?.trim()) {
      return Response.json({ error: "Texto vazio." }, { status: 400 });
    }

    const selectedAgent = agentName || detectAgent(text);
    const agent = AGENTS[selectedAgent] || AGENTS["analyst"];

    const needsSearch = REALTIME_KEYWORDS.test(text);

    const modelConfig: Parameters<typeof genai.getGenerativeModel>[0] = {
      model: "gemini-2.0-flash",
      systemInstruction: agent.systemPrompt,
    };
    if (needsSearch) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (modelConfig as any).tools = [{ googleSearch: {} }];
    }
    const model = genai.getGenerativeModel(modelConfig);

    // Converte histórico para formato Gemini
    const chatHistory = history.slice(-20).map((m: { role: string; content: string }) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history: chatHistory });
    const result = await chat.sendMessageStream(text);

    const encoder = new TextEncoder();
    let fullText = "";

    const readable = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "start", agent: agent.name, agentLabel: agent.label })}\n\n`
            )
          );

          for await (const chunk of result.stream) {
            const delta = chunk.text();
            if (delta) {
              fullText += delta;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "delta", text: delta })}\n\n`)
              );
            }
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "done", text: fullText, agent: agent.name, agentLabel: agent.label })}\n\n`
            )
          );
        } catch (err) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", message: String(err) })}\n\n`)
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
