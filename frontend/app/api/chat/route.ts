/**
 * app/api/chat/route.ts
 *
 * API Route do Next.js com Google Gemini (gratuito via AI Studio).
 * Modelo: gemini-1.5-flash — gratuito, rápido, multilingual.
 *
 * Free tier: 15 RPM, 1.500 req/dia, 1M tokens/min.
 * Obtenha sua chave em: https://aistudio.google.com/app/apikey
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { AGENTS, detectAgent } from "@/lib/agents";

export const runtime = "nodejs";
export const maxDuration = 60;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Configuração de segurança — permissiva para uso geral
const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

export async function POST(req: Request) {
  try {
    const { text, history = [], agentName } = await req.json();

    if (!text?.trim()) {
      return Response.json({ error: "Texto vazio." }, { status: 400 });
    }

    const selectedAgent = agentName || detectAgent(text);
    const agent = AGENTS[selectedAgent] || AGENTS["analyst"];

    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
      systemInstruction: agent.systemPrompt,
      safetySettings,
    });

    // Converte histórico do formato interno para o formato Gemini
    // Interno: { role: "user"|"assistant", content: string }
    // Gemini:  { role: "user"|"model",     parts: [{ text }] }
    const geminiHistory = history
      .slice(-20) // últimas 10 trocas
      .map((m: { role: string; content: string }) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const chat = model.startChat({ history: geminiHistory });

    // Inicia stream
    const result = await chat.sendMessageStream(text);

    const encoder = new TextEncoder();
    let fullText = "";

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Metadados iniciais
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "start",
                agent: agent.name,
                agentLabel: agent.label,
              })}\n\n`
            )
          );

          for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
              fullText += chunkText;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "delta", text: chunkText })}\n\n`
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
