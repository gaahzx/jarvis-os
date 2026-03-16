# ============================================================
# JARVIS OS — Setup automático (Windows PowerShell)
# Execute como: powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
# ============================================================

$ErrorActionPreference = "Continue"
$ROOT = Split-Path -Parent $PSScriptRoot
$MODELS_DIR = Join-Path $ROOT "models"
$PIPER_DIR = Join-Path $MODELS_DIR "piper"
$WHISPER_DIR = Join-Path $MODELS_DIR "whisper"

function log   { Write-Host "[setup] $args" -ForegroundColor Green }
function warn  { Write-Host "[warn]  $args" -ForegroundColor Yellow }
function fatal { Write-Host "[error] $args" -ForegroundColor Red; exit 1 }

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  J.A.R.V.I.S. OS — Setup (Windows)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# ── 1. Verifica Python ──────────────────────────────────────
log "Verificando Python..."
try { $pyver = python --version 2>&1; log $pyver }
catch { fatal "Python não encontrado. Instale Python 3.10+ de https://python.org" }

# ── 2. Cria ambiente virtual ────────────────────────────────
$VENV = Join-Path $ROOT ".venv"
if (-not (Test-Path $VENV)) {
    log "Criando ambiente virtual..."
    python -m venv $VENV
}

$ACTIVATE = Join-Path $VENV "Scripts\Activate.ps1"
. $ACTIVATE
log "Ambiente virtual ativado."

# ── 3. Instala dependências Python ──────────────────────────
log "Instalando dependências Python..."
pip install --upgrade pip -q
pip install -r "$ROOT\backend\requirements.txt" -q
log "Dependências Python instaladas."

# ── 4. Copia .env ───────────────────────────────────────────
$ENV_FILE = Join-Path $ROOT ".env"
$ENV_EXAMPLE = Join-Path $ROOT "config\.env.example"
if (-not (Test-Path $ENV_FILE)) {
    Copy-Item $ENV_EXAMPLE $ENV_FILE
    warn ".env criado. Preencha ANTHROPIC_API_KEY e SUPABASE_* antes de iniciar."
}

# ── 5. Cria diretórios de modelos ───────────────────────────
New-Item -ItemType Directory -Force -Path $PIPER_DIR | Out-Null
New-Item -ItemType Directory -Force -Path $WHISPER_DIR | Out-Null

# ── 6. Baixa Piper TTS (Windows x64) ───────────────────────
$PIPER_EXE = Join-Path $PIPER_DIR "piper.exe"
if (-not (Test-Path $PIPER_EXE)) {
    log "Baixando Piper TTS para Windows..."
    $PIPER_VERSION = "2023.11.14-2"
    $PIPER_URL = "https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION/piper_windows_amd64.zip"
    $TMP_ZIP = Join-Path $env:TEMP "piper_win.zip"
    try {
        Invoke-WebRequest -Uri $PIPER_URL -OutFile $TMP_ZIP -UseBasicParsing
        Expand-Archive -Path $TMP_ZIP -DestinationPath $PIPER_DIR -Force
        Remove-Item $TMP_ZIP -ErrorAction SilentlyContinue
        # Move arquivos para o nível correto se estiverem em subpasta
        $EXTRACTED = Get-ChildItem $PIPER_DIR -Recurse -Filter "piper.exe" | Select-Object -First 1
        if ($EXTRACTED -and $EXTRACTED.DirectoryName -ne $PIPER_DIR) {
            Move-Item "$($EXTRACTED.DirectoryName)\*" $PIPER_DIR -Force
        }
        log "Piper instalado em $PIPER_DIR"
    } catch {
        warn "Falha ao baixar Piper: $_"
        warn "Baixe manualmente em: https://github.com/rhasspy/piper/releases"
    }
} else {
    log "Piper já instalado."
}

# ── 7. Baixa modelo de voz pt_BR ────────────────────────────
$VOICE_MODEL = Join-Path $PIPER_DIR "pt_BR-faber-medium.onnx"
if (-not (Test-Path $VOICE_MODEL)) {
    log "Baixando modelo de voz pt_BR-faber-medium..."
    $BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium"
    try {
        Invoke-WebRequest "$BASE_URL/pt_BR-faber-medium.onnx"      -OutFile $VOICE_MODEL -UseBasicParsing
        Invoke-WebRequest "$BASE_URL/pt_BR-faber-medium.onnx.json" -OutFile "$VOICE_MODEL.json" -UseBasicParsing
        log "Modelo de voz instalado."
    } catch {
        warn "Falha ao baixar modelo de voz: $_"
    }
} else {
    log "Modelo de voz já instalado."
}

# ── 8. Download modelos OpenWakeWord ────────────────────────
log "Baixando modelos OpenWakeWord..."
try {
    python -c "import openwakeword; openwakeword.utils.download_models(['alexa']); print('OK')"
} catch {
    warn "Falha ao baixar modelos OpenWakeWord. Tente manualmente."
}

# ── 9. Frontend ─────────────────────────────────────────────
$FRONTEND = Join-Path $ROOT "frontend"
if (Test-Path $FRONTEND) {
    log "Instalando dependências do frontend..."
    Push-Location $FRONTEND
    try { npm install --legacy-peer-deps }
    catch { warn "Falha ao instalar frontend: $_" }
    Pop-Location
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Setup concluído!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Edite o arquivo .env:" -ForegroundColor White
Write-Host "     ANTHROPIC_API_KEY=sk-ant-..." -ForegroundColor Gray
Write-Host "     SUPABASE_URL=https://xxx.supabase.co" -ForegroundColor Gray
Write-Host ""
Write-Host "  2. Execute o SQL no Supabase Dashboard:" -ForegroundColor White
Write-Host "     Copie sql/schema.sql → SQL Editor do Supabase" -ForegroundColor Gray
Write-Host ""
Write-Host "  3. Inicie o backend:" -ForegroundColor White
Write-Host "     .\.venv\Scripts\Activate.ps1" -ForegroundColor Gray
Write-Host "     python main.py" -ForegroundColor Gray
Write-Host ""
Write-Host "  4. Inicie o frontend (outro terminal):" -ForegroundColor White
Write-Host "     cd frontend; npm run dev" -ForegroundColor Gray
Write-Host ""
