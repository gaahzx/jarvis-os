#!/usr/bin/env bash
# ============================================================
# JARVIS OS — Setup automático (Linux / macOS)
# ============================================================
set -e

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
NC="\033[0m"

log()  { echo -e "${GREEN}[setup]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC}  $1"; }
err()  { echo -e "${RED}[error]${NC} $1"; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODELS_DIR="$ROOT/models"
PIPER_DIR="$MODELS_DIR/piper"
WHISPER_DIR="$MODELS_DIR/whisper"

echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  J.A.R.V.I.S. OS — Setup${NC}"
echo -e "${BOLD}============================================================${NC}"

# ── 1. Verifica Python ──────────────────────────────────────
log "Verificando Python..."
python3 --version || err "Python 3 não encontrado. Instale Python 3.10+."

# ── 2. Cria ambiente virtual ────────────────────────────────
if [ ! -d "$ROOT/.venv" ]; then
  log "Criando ambiente virtual..."
  python3 -m venv "$ROOT/.venv"
fi

source "$ROOT/.venv/bin/activate"
log "Ambiente virtual ativado."

# ── 3. Instala dependências Python ──────────────────────────
log "Instalando dependências Python..."
pip install --upgrade pip -q
pip install -r "$ROOT/backend/requirements.txt" -q
log "Dependências Python instaladas."

# ── 4. Copia .env ───────────────────────────────────────────
if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/config/.env.example" "$ROOT/.env"
  warn ".env criado a partir do exemplo. Preencha as variáveis antes de iniciar."
fi

# ── 5. Cria diretórios de modelos ───────────────────────────
mkdir -p "$PIPER_DIR" "$WHISPER_DIR"

# ── 6. Baixa Piper TTS ──────────────────────────────────────
PIPER_BINARY="$PIPER_DIR/piper"
if [ ! -f "$PIPER_BINARY" ]; then
  log "Baixando Piper TTS..."
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)

  if [[ "$ARCH" == "x86_64" ]]; then
    ARCH_TAG="amd64"
  elif [[ "$ARCH" == "aarch64" ]] || [[ "$ARCH" == "arm64" ]]; then
    ARCH_TAG="arm64"
  else
    warn "Arquitetura não suportada para download automático: $ARCH"
    warn "Baixe manualmente em: https://github.com/rhasspy/piper/releases"
    PIPER_BINARY=""
  fi

  if [ -n "$ARCH_TAG" ]; then
    PIPER_VERSION="2023.11.14-2"
    PIPER_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_${OS}_${ARCH_TAG}.tar.gz"
    TMP_TAR=$(mktemp /tmp/piper.XXXXXX.tar.gz)
    curl -L "$PIPER_URL" -o "$TMP_TAR" --progress-bar || warn "Falha ao baixar Piper."
    tar -xzf "$TMP_TAR" -C "$PIPER_DIR" --strip-components=1 2>/dev/null || true
    rm -f "$TMP_TAR"
    chmod +x "$PIPER_DIR/piper" 2>/dev/null || true
    log "Piper instalado em $PIPER_DIR"
  fi
else
  log "Piper já instalado."
fi

# ── 7. Baixa modelo de voz Piper (pt_BR) ───────────────────
VOICE_MODEL="$PIPER_DIR/pt_BR-faber-medium.onnx"
if [ ! -f "$VOICE_MODEL" ]; then
  log "Baixando modelo de voz pt_BR-faber-medium..."
  BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium"
  curl -L "${BASE_URL}/pt_BR-faber-medium.onnx"      -o "$VOICE_MODEL" --progress-bar || warn "Falha ao baixar modelo .onnx"
  curl -L "${BASE_URL}/pt_BR-faber-medium.onnx.json" -o "${VOICE_MODEL}.json" --progress-bar || warn "Falha ao baixar config .json"
  log "Modelo de voz instalado."
else
  log "Modelo de voz já instalado."
fi

# ── 8. Baixa modelo OpenWakeWord ────────────────────────────
log "Verificando OpenWakeWord..."
python3 -c "
import openwakeword
openwakeword.utils.download_models(['alexa'])
print('OpenWakeWord models OK')
" 2>/dev/null || warn "Falha ao baixar modelos OpenWakeWord. Execute manualmente."

# ── 9. Instala dependências do frontend ─────────────────────
if [ -d "$ROOT/frontend" ]; then
  log "Instalando dependências do frontend..."
  cd "$ROOT/frontend"
  if command -v bun &>/dev/null; then
    bun install
  else
    npm install --legacy-peer-deps
  fi
  cd "$ROOT"
  log "Frontend pronto."
fi

echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${GREEN}  Setup concluído!${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""
echo "  1. Edite o arquivo .env com suas credenciais:"
echo "     ANTHROPIC_API_KEY=sk-ant-..."
echo "     SUPABASE_URL=https://xxx.supabase.co"
echo "     SUPABASE_ANON_KEY=..."
echo ""
echo "  2. Execute o SQL schema no Supabase:"
echo "     Copie o conteúdo de sql/schema.sql → Supabase SQL Editor"
echo ""
echo "  3. Inicie o backend:"
echo "     source .venv/bin/activate"
echo "     python main.py"
echo ""
echo "  4. Inicie o frontend (outro terminal):"
echo "     cd frontend && npm run dev"
echo ""
