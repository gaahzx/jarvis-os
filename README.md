# J.A.R.V.I.S. OS

> **AI Operating System pessoal** — assistente com interface de voz contínua, orquestração de agentes, memória persistente e interface visual estilo Tony Stark.

---

## Visão Geral

```
Usuário fala "Jarvis" → Wake Word → STT (Whisper) → Claude API (Brain)
    → Task Graph Engine → Agentes → Delivery Manager → TTS (Piper)
    → Visual Brain (ReactFlow) → Console HUD (Next.js)
```

### Stack

| Componente | Tecnologia |
|---|---|
| LLM Brain | Claude Sonnet (Anthropic) |
| STT | faster-whisper (CPU, int8) |
| TTS | Piper TTS (binário local) |
| Wake Word | OpenWakeWord |
| Backend | FastAPI + WebSocket |
| Database | Supabase (Postgres + pgvector) |
| Embeddings | sentence-transformers (local, gratuito) |
| Frontend | Next.js 14 + React Three Fiber + ReactFlow |
| Deploy Backend | Docker / Railway / Render |
| Deploy Frontend | Vercel |

---

## Requisitos de Hardware

| Recurso | Mínimo | Recomendado |
|---|---|---|
| CPU | 4 cores | 8+ cores |
| RAM | 8 GB | 16 GB |
| GPU | Não necessária | Opcional (melhora STT) |
| SO | Windows 10+ / Ubuntu 20.04+ / macOS 12+ | — |

---

## Instalação Rápida

### 1. Clone o repositório

```bash
git clone https://github.com/seu-usuario/jarvis-os.git
cd jarvis-os
```

### 2. Setup automático

**Linux / macOS:**
```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

**Windows (PowerShell como Administrador):**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
```

O script instala automaticamente:
- Ambiente virtual Python
- Dependências Python (`requirements.txt`)
- Piper TTS (binário) + modelo de voz `pt_BR-faber-medium`
- Modelos OpenWakeWord
- Dependências do frontend

### 3. Configure as variáveis de ambiente

```bash
cp config/.env.example .env
```

Edite o arquivo `.env`:

```env
ANTHROPIC_API_KEY=sk-ant-...          # Obrigatório
SUPABASE_URL=https://xxx.supabase.co  # Opcional (usa memória local sem isso)
SUPABASE_ANON_KEY=eyJ...              # Opcional
SUPABASE_SERVICE_ROLE_KEY=eyJ...      # Opcional
```

### 4. Configure o banco de dados Supabase (opcional mas recomendado)

1. Acesse o [Supabase Dashboard](https://supabase.com)
2. Crie um projeto
3. Vá em **SQL Editor**
4. Cole e execute o conteúdo de `sql/schema.sql`
5. Vá em **Storage** → crie um bucket chamado `jarvis-deliveries` (público)

### 5. Inicie o backend

```bash
# Ativa o ambiente virtual
source .venv/bin/activate          # Linux/Mac
.\.venv\Scripts\Activate.ps1      # Windows

# Inicia o servidor
python main.py

# Sem pipeline de voz (apenas API):
python main.py --no-voice

# Porta customizada:
python main.py --port 8080
```

O backend estará disponível em:
- API REST: `http://localhost:8000`
- WebSocket: `ws://localhost:8000/ws`
- Docs: `http://localhost:8000/docs`

### 6. Inicie o frontend

Em outro terminal:

```bash
cd frontend
npm run dev
```

Acesse: `http://localhost:3000`

---

## Deploy em Produção

### Backend — Docker

```bash
# Build e inicia
docker compose up --build -d

# Logs
docker compose logs -f jarvis-api

# Para
docker compose down
```

### Backend — Railway

1. Conecte o repositório GitHub no [Railway](https://railway.app)
2. Configure as variáveis de ambiente no painel
3. Railway detecta o `Dockerfile` automaticamente

### Backend — Render

1. Crie um novo **Web Service** no [Render](https://render.com)
2. Aponte para o repositório
3. Build command: `pip install -r backend/requirements.txt`
4. Start command: `python main.py --no-voice`

### Frontend — Vercel

```bash
cd frontend
npx vercel --prod
```

Configure as variáveis de ambiente no Vercel Dashboard:

```
NEXT_PUBLIC_WS_URL=wss://seu-backend.railway.app/ws
NEXT_PUBLIC_API_URL=https://seu-backend.railway.app
```

> **Nota:** O Vercel usa secrets nomeados. Crie:
> - `jarvis_ws_url` → URL do WebSocket
> - `jarvis_api_url` → URL da API REST

---

## Estrutura do Projeto

```
jarvis-os/
├── main.py                    # Entry point
├── Dockerfile
├── docker-compose.yml
│
├── config/
│   └── .env.example
│
├── backend/
│   ├── requirements.txt
│   ├── api/
│   │   └── server.py          # FastAPI + WebSocket
│   ├── core/
│   │   ├── jarvis_core.py     # Orquestrador central
│   │   ├── claude_client.py   # Claude API (3 modos)
│   │   ├── planner.py         # Decisão de modo
│   │   ├── task_graph_engine.py  # Executor DAG
│   │   ├── agent_router.py    # 6 agentes nativos
│   │   ├── delivery_manager.py
│   │   ├── self_improvement.py
│   │   └── pipeline_learner.py
│   ├── voice/
│   │   ├── wakeword.py        # OpenWakeWord
│   │   ├── whisper_listener.py # faster-whisper STT
│   │   ├── piper_tts.py       # Piper TTS
│   │   └── voice_pipeline.py  # Orquestrador de voz
│   ├── memory/
│   │   ├── supabase_client.py
│   │   └── memory_manager.py  # pgvector + embeddings
│   └── tasks/
│       └── task_queue.py
│
├── frontend/
│   ├── app/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── Dashboard.tsx      # Shell com 5 tabs
│   │   ├── Orb.tsx            # Esfera 3D (React Three Fiber)
│   │   ├── Console.tsx        # Chat em tempo real
│   │   ├── AgentsPanel.tsx
│   │   ├── DeliveriesPanel.tsx
│   │   ├── VisualBrain.tsx    # Mapa cognitivo (ReactFlow)
│   │   └── FeedbackButtons.tsx
│   ├── hooks/
│   │   └── useJarvisWS.ts     # WebSocket com reconexão
│   └── styles/
│       └── globals.css        # Tema dark futuristic
│
├── sql/
│   └── schema.sql             # 6 tabelas + pgvector
│
└── scripts/
    ├── setup.sh               # Setup Linux/Mac
    └── setup.ps1              # Setup Windows
```

---

## Agentes Disponíveis

| Agente | Comando | Função |
|---|---|---|
| `research` | `/research` | Pesquisa e coleta de informações |
| `writer` | `/writer` | Redação de textos e documentos |
| `analyst` | `/analyst` | Análise de dados e tendências |
| `coder` | `/coder` | Geração e revisão de código |
| `summarizer` | `/summarizer` | Síntese e resumo de conteúdo |
| `file_gen` | `/file_gen` | Geração de arquivos PDF/Markdown |

---

## Fluxo de Interação

```
1. [OpenWakeWord] Detecta "Jarvis" (< 50ms)
2. [Whisper STT]  Transcreve comando (0.5-2s)
3. [Planner]      Decide modo: conversational / planning / execution
4. [Claude API]   Raciocina e planeja
5. [Task Graph]   Executa agentes em DAG (se planning)
6. [Delivery]     Gera e faz upload de arquivos
7. [Piper TTS]    Sintetiza resposta (200-500ms)
8. [Visual Brain] Atualiza mapa cognitivo
9. [Loop]         Retorna ao modo de escuta
```

---

## Estados do Orb

| Estado | Visual | Cor |
|---|---|---|
| `idle` | Pulsação lenta | Azul escuro |
| `listening` | Ondulações | Azul claro |
| `thinking` | Rotação + partículas | Roxo |
| `speaking` | Expansão rítmica | Ciano |
| `error` | Tremor + flash | Vermelho |

---

## API REST

| Endpoint | Método | Descrição |
|---|---|---|
| `/health` | GET | Status do sistema |
| `/api/chat` | POST | Enviar comando via REST |
| `/api/feedback` | POST | Registrar feedback (👍/👎) |
| `/api/deliveries` | GET | Listar arquivos gerados |
| `/api/agents` | GET | Listar agentes disponíveis |
| `/api/metrics` | GET | Métricas de performance |
| `/api/session` | GET | Informações da sessão atual |
| `/api/session/new` | POST | Nova sessão |
| `/ws` | WebSocket | Canal bidirecional de eventos |

### Protocolo WebSocket

**Enviar:**
```json
{ "type": "command", "text": "Analise tendências de IA" }
{ "type": "feedback", "interaction_id": "uuid", "feedback": "positive" }
{ "type": "new_session" }
{ "type": "ping" }
```

**Receber:**
```json
{ "type": "orb_state", "state": "thinking" }
{ "type": "transcript", "text": "...", "interaction_id": "uuid" }
{ "type": "response", "text": "...", "mode": "planning", "total_latency_ms": 1240 }
{ "type": "graph_update", "graph_id": "...", "nodes": [...], "edges": [...] }
{ "type": "delivery", "url": "https://...", "graph_id": "..." }
{ "type": "agent_status", "agent": "research", "status": "running" }
```

---

## Variáveis de Ambiente

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | — | Chave da Claude API |
| `SUPABASE_URL` | ⬜ | — | URL do projeto Supabase |
| `SUPABASE_ANON_KEY` | ⬜ | — | Chave anônima Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | ⬜ | — | Chave de serviço Supabase |
| `CLAUDE_MODEL` | ⬜ | `claude-sonnet-4-20250514` | Modelo Claude |
| `WHISPER_MODEL` | ⬜ | `base` | Modelo Whisper (tiny/base/small) |
| `WAKEWORD_MODEL` | ⬜ | `alexa` | Modelo wake word |
| `WAKEWORD_THRESHOLD` | ⬜ | `0.5` | Sensibilidade (0.0-1.0) |
| `BACKEND_PORT` | ⬜ | `8000` | Porta do servidor |
| `FRONTEND_URL` | ⬜ | `http://localhost:3000` | URL do frontend (CORS) |
| `LOG_LEVEL` | ⬜ | `INFO` | Nível de log |

---

## Troubleshooting

### PyAudio não instala no Windows
```powershell
pip install pipwin
pipwin install pyaudio
```

### Piper TTS não encontrado
Execute o script de setup que baixa automaticamente:
```bash
./scripts/setup.sh   # Linux/Mac
```
Ou baixe manualmente em [github.com/rhasspy/piper/releases](https://github.com/rhasspy/piper/releases).

### Whisper lento (> 5s por frase)
Use um modelo menor:
```env
WHISPER_MODEL=tiny
```

### Sem Supabase configurado
O sistema funciona com **armazenamento em memória local** — sem persistência entre reinicializações. Para persistência completa, configure o Supabase.

### Frontend não conecta ao backend
Verifique a variável `NEXT_PUBLIC_WS_URL`:
```env
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws   # desenvolvimento
NEXT_PUBLIC_WS_URL=wss://seu-api.com/ws     # produção
```

---

## Licença

MIT — use, modifique e distribua livremente.

---

*"Sometimes you gotta run before you can walk." — Tony Stark*
