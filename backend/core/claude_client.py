"""
backend/core/claude_client.py

Integração com a Claude API (Anthropic).
Opera em 3 modos:
  - conversational : responde diretamente sem agentes
  - planning       : decompõe a tarefa em um TaskGraph JSON
  - execution      : executa subtarefa simples diretamente
"""

import json
import os
from typing import AsyncGenerator, Literal

import anthropic
from pydantic import BaseModel

# ──────────────────────────────────────────────
# Schemas de saída
# ──────────────────────────────────────────────

class ConversationalResponse(BaseModel):
    mode: Literal["conversational"] = "conversational"
    text: str

class TaskNodeSchema(BaseModel):
    id: str
    type: Literal["task", "agent", "memory", "result"]
    label: str
    agent: str | None = None   # Nome do agente AIOS responsável
    params: dict = {}

class TaskEdgeSchema(BaseModel):
    source: str
    target: str
    condition: str | None = None

class PlanningResponse(BaseModel):
    mode: Literal["planning"] = "planning"
    reasoning: str
    graph_id: str
    nodes: list[TaskNodeSchema]
    edges: list[TaskEdgeSchema]

class ExecutionResponse(BaseModel):
    mode: Literal["execution"] = "execution"
    result: str
    artifacts: list[str] = []


# ──────────────────────────────────────────────
# Prompts de sistema
# ──────────────────────────────────────────────

SYSTEM_CONVERSATIONAL = """Você é J.A.R.V.I.S., o assistente pessoal de IA de Tony Stark.
Seja preciso, inteligente e ligeiramente irônico quando apropriado.
Responda em português do Brasil. Seja conciso mas completo.
Você está operando em modo conversacional — responda diretamente sem delegar tarefas."""

SYSTEM_ROUTER = """Você é J.A.R.V.I.S., o núcleo de decisão de um sistema de IA orquestrado.
Sua função é analisar o pedido do usuário e decidir o modo de operação:

MODO "conversational": pedidos simples — perguntas diretas, cálculos, traduções, explicações.
MODO "planning": pedidos complexos que requerem múltiplos passos, pesquisa, geração de arquivos, análises profundas.
MODO "execution": subtarefas simples delegadas pelo Task Graph Engine.

Responda APENAS com um JSON no formato:
{
  "mode": "conversational" | "planning" | "execution",
  "reasoning": "breve justificativa da decisão"
}"""

SYSTEM_PLANNING = """Você é J.A.R.V.I.S. em modo de planejamento estratégico.
Decomponha a tarefa do usuário em um grafo de execução (DAG).

Agentes disponíveis:
- research    : pesquisa e coleta de informações
- writer      : redação de textos, relatórios, documentos
- analyst     : análise de dados, tendências, padrões
- coder       : geração e revisão de código
- summarizer  : síntese e resumo de conteúdo
- file_gen    : geração de arquivos PDF/Markdown

Responda APENAS com JSON no formato:
{
  "reasoning": "explicação do plano",
  "graph_id": "uuid-aqui",
  "nodes": [
    {"id": "n1", "type": "task", "label": "Pesquisar tendências", "agent": "research", "params": {"query": "..."}},
    {"id": "n2", "type": "agent", "label": "Analisar dados", "agent": "analyst", "params": {}},
    {"id": "n3", "type": "result", "label": "Gerar relatório", "agent": "file_gen", "params": {"format": "pdf"}}
  ],
  "edges": [
    {"source": "n1", "target": "n2"},
    {"source": "n2", "target": "n3"}
  ]
}

Tipos de nós:
- "task"   → tarefa a ser executada por um agente (azul no Visual Brain)
- "agent"  → nó de processamento por agente especializado (verde)
- "memory" → acesso à memória do sistema (roxo)
- "result" → nó de saída / entrega final (dourado)"""

SYSTEM_EXECUTION = """Você é J.A.R.V.I.S. executando uma subtarefa específica.
Execute a tarefa fornecida de forma direta e precisa.
Retorne APENAS um JSON:
{
  "result": "resultado da execução",
  "artifacts": ["nome_arquivo.pdf"]
}"""


# ──────────────────────────────────────────────
# Cliente Claude
# ──────────────────────────────────────────────

class ClaudeClient:
    def __init__(self):
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY não definida no ambiente.")
        self.client = anthropic.AsyncAnthropic(api_key=api_key)
        self.model = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514")
        self.max_tokens = int(os.getenv("CLAUDE_MAX_TOKENS", "8192"))

    # ── 1. Decide o modo com base no input do usuário ──────────────────────

    async def decide_mode(
        self,
        user_input: str,
        history: list[dict],
    ) -> dict:
        """
        Retorna {"mode": "conversational"|"planning"|"execution", "reasoning": "..."}
        """
        messages = self._build_messages(history, user_input)
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=256,
            system=SYSTEM_ROUTER,
            messages=messages,
        )
        raw = response.content[0].text.strip()
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            # fallback seguro
            return {"mode": "conversational", "reasoning": "Falha ao parsear decisão de modo."}

    # ── 2. Modo Conversacional ─────────────────────────────────────────────

    async def conversational(
        self,
        user_input: str,
        history: list[dict],
        memory_context: list[dict] | None = None,
    ) -> str:
        """Resposta direta, sem agentes. Retorna texto completo."""
        system = SYSTEM_CONVERSATIONAL
        if memory_context:
            ctx = "\n".join(f"- {m['text']}" for m in memory_context[:5])
            system += f"\n\nContexto relevante da memória:\n{ctx}"

        messages = self._build_messages(history, user_input)
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            system=system,
            messages=messages,
        )
        return response.content[0].text

    async def conversational_stream(
        self,
        user_input: str,
        history: list[dict],
        memory_context: list[dict] | None = None,
    ) -> AsyncGenerator[str, None]:
        """Resposta em streaming para o WebSocket."""
        system = SYSTEM_CONVERSATIONAL
        if memory_context:
            ctx = "\n".join(f"- {m['text']}" for m in memory_context[:5])
            system += f"\n\nContexto relevante da memória:\n{ctx}"

        messages = self._build_messages(history, user_input)
        async with self.client.messages.stream(
            model=self.model,
            max_tokens=self.max_tokens,
            system=system,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield text

    # ── 3. Modo Planning ───────────────────────────────────────────────────

    async def plan(
        self,
        user_input: str,
        history: list[dict],
        memory_context: list[dict] | None = None,
    ) -> PlanningResponse:
        """Decompõe a tarefa em um TaskGraph."""
        import uuid

        system = SYSTEM_PLANNING
        if memory_context:
            ctx = "\n".join(f"- {m['text']}" for m in memory_context[:3])
            system += f"\n\nContexto da memória disponível:\n{ctx}"

        prompt = f"Tarefa do usuário: {user_input}\n\nCrie o grafo de execução."
        messages = self._build_messages(history[-4:], prompt)  # histórico resumido

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=system,
            messages=messages,
        )
        raw = response.content[0].text.strip()

        # Remove blocos de código markdown se presentes
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        try:
            data = json.loads(raw)
            data.setdefault("graph_id", str(uuid.uuid4()))
            return PlanningResponse(**data)
        except (json.JSONDecodeError, Exception) as e:
            # Fallback: grafo de tarefa única
            graph_id = str(uuid.uuid4())
            return PlanningResponse(
                reasoning=f"Erro ao parsear plano ({e}). Usando execução direta.",
                graph_id=graph_id,
                nodes=[
                    TaskNodeSchema(
                        id="n1",
                        type="task",
                        label=user_input[:60],
                        agent="writer",
                        params={"task": user_input},
                    ),
                    TaskNodeSchema(id="n2", type="result", label="Resultado", agent="summarizer"),
                ],
                edges=[TaskEdgeSchema(source="n1", target="n2")],
            )

    # ── 4. Modo Execution ─────────────────────────────────────────────────

    async def execute_task(
        self,
        task_description: str,
        context: dict,
        parent_results: list[dict] | None = None,
    ) -> ExecutionResponse:
        """Executa uma subtarefa simples diretamente."""
        prompt_parts = [f"Tarefa: {task_description}"]
        if context:
            prompt_parts.append(f"Contexto: {json.dumps(context, ensure_ascii=False)}")
        if parent_results:
            results_text = "\n".join(
                f"- {r.get('label', 'resultado')}: {str(r.get('result', ''))[:500]}"
                for r in parent_results
            )
            prompt_parts.append(f"Resultados anteriores:\n{results_text}")

        prompt = "\n\n".join(prompt_parts)
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            system=SYSTEM_EXECUTION,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        try:
            data = json.loads(raw)
            return ExecutionResponse(**data)
        except Exception:
            return ExecutionResponse(result=raw, artifacts=[])

    # ── 5. Síntese de resposta final após execução do grafo ───────────────

    async def synthesize_final_response(
        self,
        original_request: str,
        execution_results: list[dict],
        deliveries: list[str],
    ) -> str:
        """Sintetiza a resposta final para o usuário após execução completa."""
        results_summary = "\n".join(
            f"- [{r.get('node_label', 'nó')}]: {str(r.get('result', ''))[:800]}"
            for r in execution_results
        )
        deliveries_text = (
            "\nArquivos gerados: " + ", ".join(deliveries) if deliveries else ""
        )

        prompt = (
            f"Pedido original: {original_request}\n\n"
            f"Resultados das execuções:\n{results_summary}"
            f"{deliveries_text}\n\n"
            "Sintetize uma resposta clara e direta para o usuário em português do Brasil. "
            "Confirme o que foi feito, destaque os resultados mais importantes."
        )
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            system=SYSTEM_CONVERSATIONAL,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text

    # ── Helpers ───────────────────────────────────────────────────────────

    def _build_messages(self, history: list[dict], user_input: str) -> list[dict]:
        """Constrói lista de mensagens para a API mantendo formato correto."""
        messages = []
        for msg in history[-10:]:  # últimas 10 trocas para não estourar contexto
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": user_input})
        return messages
