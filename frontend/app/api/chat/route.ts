/**
 * app/api/chat/route.ts
 *
 * Groq + Llama 3.3 70B — 100% gratuito (14.400 req/dia, sem cartão).
 * Tavily Web Search para perguntas em tempo real (opcional).
 */

import Groq from "groq-sdk";
import { AGENTS, detectAgent } from "@/lib/agents";

export const runtime = "nodejs";
export const maxDuration = 60;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

const REALTIME_KEYWORDS =
  /clima|tempo|temperatura|chuva|previsão|notícias?|hoje|amanhã|agora|atual|recente|última|preço|cotação|dólar|bitcoin|btc|jogo|resultado|placar/i;

async function webSearch(query: string): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return "";
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, search_depth: "basic", max_results: 3, include_answer: true }),
    });
    if (!res.ok) return "";
    const data = await res.json();
    const answer = data.answer ? `Resposta direta: ${data.answer}\n\n` : "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = (data.results || []).slice(0, 3).map((r: any) => `- ${r.title}: ${r.content?.slice(0, 200)}`).join("\n");
    return answer + results;
  } catch { return ""; }
}

export async function POST(req: Request) {
  try {
    const { text, history = [], agentName } = await req.json();

    if (!text?.trim()) {
      return Response.json({ error: "Texto vazio." }, { status: 400 });
    }

    const selectedAgent = agentName || detectAgent(text);
    const agent = AGENTS[selectedAgent] || AGENTS["analyst"];

    let systemPrompt = agent.systemPrompt;
    if (REALTIME_KEYWORDS.test(text)) {
      const searchData = await webSearch(text);
      if (searchData) {
        systemPrompt += `\n\n[DADOS EM TEMPO REAL DA WEB]\n${searchData}\n[FIM]\nUse esses dados para responder.`;
      }
    }

    const messages: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history.slice(-20).map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: text },
    ];

    const stream = await groq.chat.completions.create({
      model: (process.env.GROQ_MODEL || "llama-3.3-70b-versatile").trim(),
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
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "start", agent: agent.name, agentLabel: agent.label })}\n\n`));
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content ?? "";
            if (delta) {
              fullText += delta;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "delta", text: delta })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", text: fullText, agent: agent.name, agentLabel: agent.label })}\n\n`));
        } catch (err) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: String(err) })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
    });
  } catch (err) {
    console.error("[/api/chat] Erro:", err);
    return Response.json({ error: "Erro interno." }, { status: 500 });
  }
}
