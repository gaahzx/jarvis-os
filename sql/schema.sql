-- ============================================================
-- JARVIS OS — Schema do banco de dados (Supabase / PostgreSQL)
-- Execute este arquivo no SQL Editor do Supabase
-- ============================================================

-- Habilita extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- TABELA: conversations
-- Histórico completo de diálogos por sessão
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id      UUID NOT NULL,
    user_input      TEXT NOT NULL,
    assistant_response TEXT NOT NULL,
    mode            VARCHAR(20) NOT NULL DEFAULT 'conversational',
    -- 'conversational' | 'planning' | 'execution'
    graph_id        UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);

-- ============================================================
-- TABELA: memory
-- Memória contextual com embedding vetorial (pgvector)
-- ============================================================
CREATE TABLE IF NOT EXISTS memory (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    text            TEXT NOT NULL,
    embedding       VECTOR(384),    -- all-MiniLM-L6-v2 = 384 dimensões
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice HNSW para busca vetorial eficiente
CREATE INDEX IF NOT EXISTS idx_memory_embedding ON memory
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_memory_created_at ON memory(created_at DESC);

-- Função RPC para busca semântica (chamada pelo SupabaseClient)
CREATE OR REPLACE FUNCTION match_memory(
    query_embedding VECTOR(384),
    match_threshold FLOAT DEFAULT 0.6,
    match_count     INT DEFAULT 5
)
RETURNS TABLE (
    id          UUID,
    text        TEXT,
    metadata    JSONB,
    similarity  FLOAT,
    created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.text,
        m.metadata,
        1 - (m.embedding <=> query_embedding) AS similarity,
        m.created_at
    FROM memory m
    WHERE 1 - (m.embedding <=> query_embedding) > match_threshold
    ORDER BY m.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ============================================================
-- TABELA: tasks
-- Tarefas planejadas e executadas pelo Task Graph Engine
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    graph_id        UUID NOT NULL,
    session_id      UUID,
    node_id         VARCHAR(100) NOT NULL,
    node_label      TEXT NOT NULL,
    node_type       VARCHAR(20) NOT NULL DEFAULT 'task',
    -- 'task' | 'agent' | 'memory' | 'result'
    agent_name      VARCHAR(50),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- 'pending' | 'running' | 'success' | 'error'
    params          JSONB DEFAULT '{}',
    result          TEXT,
    error_message   TEXT,
    duration_ms     FLOAT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_graph_id ON tasks(graph_id);
CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- ============================================================
-- TABELA: deliveries
-- Arquivos gerados e entregues ao usuário
-- ============================================================
CREATE TABLE IF NOT EXISTS deliveries (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    graph_id        UUID,
    node_id         VARCHAR(100),
    agent_name      VARCHAR(50),
    session_id      UUID,
    filename        VARCHAR(255) NOT NULL,
    file_type       VARCHAR(20) NOT NULL,  -- 'pdf' | 'md' | 'txt' | etc
    storage_path    TEXT NOT NULL,
    public_url      TEXT NOT NULL,
    file_size_bytes BIGINT DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_session_id ON deliveries(session_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_graph_id ON deliveries(graph_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_created_at ON deliveries(created_at DESC);

-- ============================================================
-- TABELA: task_metrics
-- Métricas de auto-melhoria por interação
-- ============================================================
CREATE TABLE IF NOT EXISTS task_metrics (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    interaction_id          UUID NOT NULL,
    session_id              UUID,
    user_input_length       INT DEFAULT 0,
    mode                    VARCHAR(20),
    planner_latency_ms      FLOAT,
    total_latency_ms        FLOAT,
    graph_id                UUID,
    success                 BOOLEAN DEFAULT TRUE,
    deliveries_count        INT DEFAULT 0,
    agent_count             INT DEFAULT 0,
    error_message           TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_metrics_session_id ON task_metrics(session_id);
CREATE INDEX IF NOT EXISTS idx_task_metrics_mode ON task_metrics(mode);
CREATE INDEX IF NOT EXISTS idx_task_metrics_created_at ON task_metrics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_metrics_total_latency ON task_metrics(total_latency_ms DESC);

-- ============================================================
-- TABELA: task_feedback
-- Feedback do usuário (👍/👎) por interação
-- ============================================================
CREATE TABLE IF NOT EXISTS task_feedback (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    interaction_id  UUID NOT NULL,
    session_id      UUID,
    feedback        VARCHAR(10) NOT NULL CHECK (feedback IN ('positive', 'negative')),
    comment         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_feedback_interaction_id ON task_feedback(interaction_id);
CREATE INDEX IF NOT EXISTS idx_task_feedback_feedback ON task_feedback(feedback);

-- ============================================================
-- Row Level Security (RLS) — desativa para uso com service role
-- Em produção, configure RLS conforme sua política de acesso
-- ============================================================
ALTER TABLE conversations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_metrics     ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_feedback    ENABLE ROW LEVEL SECURITY;

-- Políticas permissivas para o service role (backend)
CREATE POLICY "service_role_all" ON conversations    FOR ALL USING (true);
CREATE POLICY "service_role_all" ON memory           FOR ALL USING (true);
CREATE POLICY "service_role_all" ON tasks            FOR ALL USING (true);
CREATE POLICY "service_role_all" ON deliveries       FOR ALL USING (true);
CREATE POLICY "service_role_all" ON task_metrics     FOR ALL USING (true);
CREATE POLICY "service_role_all" ON task_feedback    FOR ALL USING (true);

-- ============================================================
-- Storage bucket (execute via Supabase Dashboard ou API)
-- ============================================================
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('jarvis-deliveries', 'jarvis-deliveries', true)
-- ON CONFLICT DO NOTHING;
