#!/bin/bash
# autodev.sh v6 — Contract-Driven Loop with Resume Capability
#
# Feedback architecture:
#   Contract (spec) → Code → Pre-flight → Install → Launch → UAT → Debug Loop
#         ↑                                                    |
#         └──────── Structured failures + history ────────────┘
#
# Resume: state saved after each phase. Re-run same command to continue
#   from last failed step — no redownloading, no re-codegen, no re-install.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config/agent.config.json"
PROMPTS_DIR="$SCRIPT_DIR/prompts"
SCRIPTS_DIR="$SCRIPT_DIR/scripts"
LOGS_DIR="$SCRIPT_DIR/logs"
LESSONS_DIR="$SCRIPT_DIR/lessons"
mkdir -p "$LOGS_DIR" "$LESSONS_DIR"

# ── Dependencies ──────────────────────────────────────────────────────────────
for cmd in curl jq python3; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "Error: '$cmd' not found. Install: brew install $cmd"; exit 1
    fi
done

OLLAMA_API="http://localhost:11434"
if ! curl -sf "$OLLAMA_API/api/tags" > /dev/null 2>&1; then
    echo "Error: Ollama not running. Start: ollama serve"; exit 1
fi

# ── Config ────────────────────────────────────────────────────────────────────
cfg() {
    local key="$1" default="${2:-}"
    local val; val=$(jq -r ".$key // empty" "$CONFIG_FILE" 2>/dev/null)
    [[ -z "$val" || "$val" == "null" ]] && echo "$default" || echo "$val"
}

PLANNER_MODEL=$(cfg "planner_model" "qwen2.5-coder:14b")
CODER_MODEL=$(cfg  "coder_model"    "qwen2.5-coder:32b")
REPAIR_MODEL=$(cfg "repair_model"   "deepseek-coder:33b")
REPAIR_FALLBACK=$(cfg "repair_model_fallback" "qwen2.5-coder:14b")
MAX_RETRIES=$(cfg  "max_retries"    "3")
PROJECT_REL=$(cfg  "project_root"   "workspace")
BACKEND_PORT=$(cfg "backend_port"   "8000")
FRONTEND_PORT=$(cfg "frontend_port" "5173")
PROJECT_BASE="$SCRIPT_DIR/$PROJECT_REL"

[[ -z "${1:-}" ]] && { echo "Usage: $0 \"<task>\""; exit 1; }
TASK="$1"
PROJECT_SLUG=$(python3 -c "
import sys,re; s=re.sub(r'[^a-z0-9]+','-',sys.argv[1].lower())[:40].strip('-')
print(s or 'project')" "$TASK")
PROJECT_ROOT="$PROJECT_BASE/$PROJECT_SLUG"
mkdir -p "$PROJECT_ROOT"

# ── Key paths ─────────────────────────────────────────────────────────────────
STATE_FILE="$PROJECT_ROOT/.autodev_state.json"
CONTRACT_FILE="$LOGS_DIR/contract.json"
UAT_REPORT="$PROJECT_ROOT/uat_report.json"
REPAIR_CONTEXT="$LOGS_DIR/repair_context.txt"
SETUP_LOG="$PROJECT_ROOT/setup.log"
PLAN_FILE="$LOGS_DIR/plan.json"

# ═══════════════════════════════════════════════════════════════════════════════
# STATE MANAGEMENT — resume from last completed phase
# ═══════════════════════════════════════════════════════════════════════════════

state_get() {
    # state_get <field> [default]
    local field="$1" default="${2:-}"
    if [[ -f "$STATE_FILE" ]]; then
        local val; val=$(jq -r ".$field // empty" "$STATE_FILE" 2>/dev/null)
        [[ -z "$val" || "$val" == "null" ]] && echo "$default" || echo "$val"
    else
        echo "$default"
    fi
}

state_set() {
    # state_set <field> <value>
    local field="$1" value="$2"
    local current="{}"
    [[ -f "$STATE_FILE" ]] && current=$(cat "$STATE_FILE")
    echo "$current" | python3 -c "
import json,sys
state=json.load(sys.stdin)
field,value=sys.argv[1],sys.argv[2]
# Try to parse as JSON, else store as string
try: state[field]=json.loads(value)
except: state[field]=value
print(json.dumps(state,indent=2))
" "$field" "$value" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
}

phase_done() {
    # Mark a phase as completed and save to state
    local phase="$1" info="${2:-{}}"
    state_set "last_completed_phase" "$phase"
    state_set "phase_${phase}_result" "$info"
    state_set "task" "\"$TASK\""
    state_set "project_slug" "\"$PROJECT_SLUG\""
}

skip_phase() {
    # skip_phase <phase_num> <phase_name>
    local phase="$1" name="$2"
    echo "  ⏭  Phase $phase ($name) — already completed, skipping"
    echo ""
}

LAST_PHASE=$(state_get "last_completed_phase" "0")
RESUME_MODE=0
[[ "$LAST_PHASE" -gt 0 ]] && RESUME_MODE=1

# ═══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

render_template() {
    local tmpl="$1" out="$2"; shift 2
    python3 - "$tmpl" "$out" "$@" << 'PYEOF'
import sys
with open(sys.argv[1]) as f: content=f.read()
for arg in sys.argv[3:]:
    eq=arg.index('='); k,v=arg[:eq],arg[eq+1:]
    content=content.replace('{{'+k+'}}',v)
with open(sys.argv[2],'w') as f: f.write(content)
PYEOF
}

ollama_call() {
    local model="$1" prompt_file="$2" out_file="$3"
    local label="${4:-Agent}" timeout="${5:-300}"
    echo "  [$label] → $model (timeout: ${timeout}s)..."
    local prompt payload api_response
    prompt=$(cat "$prompt_file")
    payload=$(python3 -c "
import json,sys
print(json.dumps({'model':sys.argv[1],'prompt':sys.argv[2],'stream':False,
  'options':{'temperature':0.1,'num_ctx':32768,'num_predict':4096}}))" "$model" "$prompt")
    api_response=$(curl -s --max-time "$timeout" \
        -H "Content-Type: application/json" -d "$payload" \
        "$OLLAMA_API/api/generate" 2>&1)
    [[ $? -ne 0 ]] && { echo "  [$label] ERROR: curl failed"; return 1; }
    local model_output
    model_output=$(echo "$api_response" | python3 -c "
import json,sys
raw=sys.stdin.read()
try:
    obj=json.loads(raw)
    e=obj.get('error','')
    if e: sys.stderr.write('ERROR:'+e); raise SystemExit(1)
    sys.stdout.write(obj.get('response',''))
except SystemExit: raise
except: sys.stdout.write(raw)")
    [[ $? -ne 0 ]] && { echo "  [$label] ERROR: API error"; return 1; }
    echo "$model_output" > "$out_file"
    local chars=${#model_output}
    echo "  [$label] Done ($chars chars)"
    [[ $chars -lt 10 ]] && { echo "  [$label] WARNING: very short response"; return 1; }
    return 0
}

extract_json() {
    python3 - "$1" << 'PYEOF'
import sys,json,re
with open(sys.argv[1]) as f: raw=f.read()
def try_p(s):
    try: return json.loads(s.strip())
    except: return None
result=try_p(raw)
if result: sys.exit(0)
clean=re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]','',raw)
clean=re.sub(r'[⠀-⣿]+','',clean)
result=try_p(clean)
if result:
    with open(sys.argv[1],'w') as f: json.dump(result,f,indent=2); sys.exit(0)
for pat in [r'```json\s*([\s\S]*?)```',r'```\s*([\s\S]*?)```',r'(\{[\s\S]*\})']:
    m=re.search(pat,clean)
    if m:
        result=try_p(m.group(1))
        if result:
            with open(sys.argv[1],'w') as f: json.dump(result,f,indent=2); sys.exit(0)
sys.exit(1)
PYEOF
}

pm() { python3 "$SCRIPTS_DIR/process_manager.py" "$@"; }

lesson_record() {
    # lesson_record <phase_num> <phase_name> <status> <summary>
    local phase="$1" name="$2" status="$3" summary="$4"
    python3 "$SCRIPTS_DIR/lessons.py" record "$LESSONS_DIR" "$phase" "$name" "$status" "$summary" >/dev/null 2>&1 || true
}

lesson_record_from_file() {
    # lesson_record_from_file <phase_num> <phase_name> <status> <file> <label>
    local phase="$1" name="$2" status="$3" file="$4" label="$5"
    [[ ! -f "$file" ]] && return 0
    local extracted
    extracted=$(grep -E -i "error|failed|warning|exception|traceback|❌|missing script" "$file" | tail -6 | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g' | cut -c1-380)
    if [[ -n "$extracted" ]]; then
        lesson_record "$phase" "$name" "$status" "$label :: $extracted"
    fi
}

phase_reminder() {
    # phase_reminder <phase_num> <phase_name>
    local phase="$1" name="$2"
    local reminder

    # Apply compact token-optimized version first (if available)
    if [[ -f "$LESSONS_DIR/latest_compact.json" ]]; then
        echo "  📘 Compact Lessons Pack (applied):"
        python3 - "$LESSONS_DIR/latest_compact.json" "$phase" << 'PY'
import json,sys
p=sys.argv[1]; phase=str(sys.argv[2])
try:
    d=json.load(open(p))
except Exception:
    raise SystemExit(0)
summary=d.get('version_summary','')
if summary: print(f"- {summary}")
for g in (d.get('global') or [])[:4]:
    print(f"- {g}")
for x in (d.get('phases',{}).get(phase) or [])[:5]:
    print(f"- {x}")
PY
        echo ""
    fi

    reminder=$(python3 "$SCRIPTS_DIR/lessons.py" remind "$LESSONS_DIR" "$phase" "$name" "$TASK" "$PLANNER_MODEL" "$OLLAMA_API" 2>/dev/null || true)
    if [[ -n "$reminder" ]]; then
        echo "  🧠 Lessons reminder for Phase $phase ($name):"
        echo "$reminder" | sed 's/^/     /'
        echo ""
    fi
}

kick_lessons_analysis() {
    # Non-blocking analysis when runtime is idle enough; lock handled by analyzer.
    nohup python3 "$SCRIPTS_DIR/lessons_analyzer.py" "$LESSONS_DIR" "$PLANNER_MODEL" "$OLLAMA_API" \
      > "$LOGS_DIR/lessons_analyzer.log" 2>&1 &
}

auto_install_missing_libs() {
    # auto_install_missing_libs <project_root> <setup_log>
    local root="$1" log_file="$2"
    python3 - "$root" "$log_file" << 'AUTO_LIB_PY'
import os,re,sys,subprocess,json
root,logf=sys.argv[1],sys.argv[2]
texts=[]
for name in ["backend.log","frontend.log","preflight_errors.log","uat_report.json"]:
    p=os.path.join(root,name)
    if os.path.exists(p):
        try:texts.append(open(p,encoding='utf-8',errors='ignore').read())
        except:pass
blob="\n".join(texts)

py_missing=set(re.findall(r"No module named ['\"]?([a-zA-Z0-9_\.\-]+)", blob))
js_missing=set(re.findall(r"Cannot find module ['\"]([^'\"]+)['\"]", blob))
js_missing.update(re.findall(r"Failed to resolve import ['\"]([^'\"]+)['\"]", blob))

# Python install
for d,_,files in os.walk(root):
    if 'venv' in d or '.venv' in d or 'node_modules' in d: continue
    if 'requirements.txt' in files or 'pyproject.toml' in files:
        venv = os.path.join(d,'.venv') if os.path.isdir(os.path.join(d,'.venv')) else os.path.join(d,'venv')
        pip = os.path.join(venv,'bin','pip')
        if os.path.exists(pip) and py_missing:
            pkgs=sorted({m.split('.')[0] for m in py_missing if m not in {'app','main'}})
            if pkgs:
                with open(logf,'a') as lf:
                    lf.write(f"\n[AUTO_LIB] python install in {d}: {pkgs}\n")
                    subprocess.run([pip,'install']+pkgs,cwd=d,stdout=lf,stderr=lf)

# Node install
for d,_,files in os.walk(root):
    if 'node_modules' in d: continue
    if 'package.json' in files:
        nm=os.path.isdir(os.path.join(d,'node_modules'))
        with open(logf,'a') as lf:
            if not nm:
                lf.write(f"\n[AUTO_LIB] node_modules missing in {d}: running npm install --include=dev\n")
                subprocess.run(['npm','install','--include=dev'],cwd=d,stdout=lf,stderr=lf)

        if js_missing:
            # ignore relative imports
            pkgs=sorted({m for m in js_missing if not m.startswith('.') and not m.startswith('/')})
            if pkgs:
                with open(logf,'a') as lf:
                    lf.write(f"\n[AUTO_LIB] npm install in {d}: {pkgs}\n")
                    subprocess.run(['npm','install']+pkgs,cwd=d,stdout=lf,stderr=lf)
AUTO_LIB_PY
}

# ═══════════════════════════════════════════════════════════════════════════════
# HEADER
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   AutoDev — Contract-Driven Loop v6      ║"
echo "╚══════════════════════════════════════════╝"
echo "  Task:    $TASK"
echo "  Output:  $PROJECT_ROOT"
echo "  Models:  $PLANNER_MODEL / $CODER_MODEL / $REPAIR_MODEL"
if [[ $RESUME_MODE -eq 1 ]]; then
    echo ""
    echo "  ↺  RESUME MODE — last completed phase: $LAST_PHASE"
    echo "     Skipping completed phases, continuing from phase $((LAST_PHASE + 1))"
fi
echo ""

# Start asynchronous lesson analysis (versioned playbook refresh)
kick_lessons_analysis

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 1: PLAN
# ═══════════════════════════════════════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Phase 1: Architecture Planning"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
phase_reminder 1 "Architecture Planning"

if [[ "$LAST_PHASE" -ge 1 && -f "$PLAN_FILE" ]]; then
    skip_phase 1 "Planning"
else
    render_template "$PROMPTS_DIR/planner.txt" "$LOGS_DIR/plan_prompt.txt" \
        "TASK_DESCRIPTION=$TASK"
    PLAN_OK=0
    for attempt in 1 2 3; do
        if ollama_call "$PLANNER_MODEL" "$LOGS_DIR/plan_prompt.txt" "$PLAN_FILE" "Planner" 120; then
            if extract_json "$PLAN_FILE"; then PLAN_OK=1; break; fi
            echo "  [Planner] Bad JSON, retry $attempt..."
        fi
    done
    if [[ $PLAN_OK -eq 0 ]]; then
        echo "  [Planner] Using fallback plan"
        cat > "$PLAN_FILE" << 'FB'
{"project_type":"Web App","tech_stack":["React","TypeScript","FastAPI","SQLite"],
"modules":[{"name":"Frontend","technologies":["React","Vite"]},{"name":"Backend","technologies":["FastAPI","SQLite"]}],
"folder_structure":["frontend/","backend/"],"dependencies":["react","fastapi","uvicorn","sqlalchemy"]}
FB
        lesson_record 1 "Architecture Planning" "warn" "Planner failed to return valid JSON after retries; fallback plan injected."
    fi
    phase_done 1 '{"status":"ok"}'
    lesson_record 1 "Architecture Planning" "ok" "Plan generated successfully with valid JSON output."
fi
jq . "$PLAN_FILE"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 2: GENERATE CONTRACT
# ═══════════════════════════════════════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Phase 2: Generating Test Contract"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
phase_reminder 2 "Generating Test Contract"

if [[ "$LAST_PHASE" -ge 2 && -f "$CONTRACT_FILE" ]]; then
    skip_phase 2 "Contract"
    echo "  Contract: $(jq '.backend.endpoints|length' "$CONTRACT_FILE") API + $(jq '.frontend.checks|length' "$CONTRACT_FILE") frontend tests"
    echo ""
else
    python3 "$SCRIPTS_DIR/contract_generator.py" \
        "$PLAN_FILE" "$PROJECT_ROOT" "$BACKEND_PORT" "$FRONTEND_PORT" \
        "${CONTRACT_FILE}.initial"
    cp "${CONTRACT_FILE}.initial" "$CONTRACT_FILE"
    echo "  Initial contract: $(jq '.backend.endpoints|length' "$CONTRACT_FILE") API tests (will expand after codegen)"
    echo ""
    phase_done 2 '{"status":"ok"}'
    lesson_record 2 "Generating Test Contract" "ok" "Contract generated/updated successfully from plan and source."
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 3: CODE GENERATION
# ═══════════════════════════════════════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Phase 3: Code Generation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
phase_reminder 3 "Code Generation"

FILES_COUNT=$(find "$PROJECT_ROOT" -type f \
    -not -path "*/node_modules/*" -not -path "*/venv/*" \
    -not -name ".autodev_state.json" -not -name "*.log" \
    2>/dev/null | wc -l | tr -d ' ')

if [[ "$LAST_PHASE" -ge 3 && "$FILES_COUNT" -gt 3 ]]; then
    skip_phase 3 "Code Generation"
    echo "  Existing files: $FILES_COUNT"
    echo ""
    # Update contract with discovered routes (in case we're resuming after codegen)
    python3 "$SCRIPTS_DIR/contract_generator.py" \
        "$PLAN_FILE" "$PROJECT_ROOT" "$BACKEND_PORT" "$FRONTEND_PORT" "$CONTRACT_FILE"
    echo "  Contract updated: $(jq '.backend.endpoints|length' "$CONTRACT_FILE") API tests"
    echo ""
else
    # Pass contract summary to coder so it knows exact API shape to implement
    CONTRACT_SUMMARY=$(jq -r '
      "Implement these exact endpoints: " +
      (.backend.endpoints | map(.method + " " + .path) | join(", "))
    ' "$CONTRACT_FILE" 2>/dev/null || echo "See plan")

    render_template "$PROMPTS_DIR/coder.txt" "$LOGS_DIR/code_prompt.txt" \
        "TASK_DESCRIPTION=$TASK" \
        "PLAN_JSON=$(cat "$PLAN_FILE")" \
        "CONTRACT_SUMMARY=$CONTRACT_SUMMARY"

    if ! ollama_call "$CODER_MODEL" "$LOGS_DIR/code_prompt.txt" \
            "$LOGS_DIR/code_output.txt" "Coder" 600; then
        echo "Error: Code generation failed."; exit 1
    fi

    echo "  Writing files..."
    "$SCRIPTS_DIR/write_files.sh" "$LOGS_DIR/code_output.txt" "$PROJECT_ROOT"
    echo "  Validating written files (fence/syntax check)..."
    python3 "$SCRIPTS_DIR/validate_written_files.py" "$PROJECT_ROOT"
    FILES_WRITTEN=$(find "$PROJECT_ROOT" -type f \
        -not -path "*/node_modules/*" -not -path "*/venv/*" \
        -not -name ".autodev_state.json" | wc -l | tr -d ' ')
    echo "  Files written: $FILES_WRITTEN"
    [[ "$FILES_WRITTEN" -eq 0 ]] && {
        echo "ERROR: No files written. LLM output:"; head -30 "$LOGS_DIR/code_output.txt"
        exit 1
    }

    # Ensure generated project always has service management scripts
    python3 "$SCRIPTS_DIR/ensure_service_scripts.py" "$PROJECT_ROOT" "$BACKEND_PORT" "$FRONTEND_PORT" >/dev/null 2>&1 || true

    # Update contract with discovered routes
    python3 "$SCRIPTS_DIR/contract_generator.py" \
        "$PLAN_FILE" "$PROJECT_ROOT" "$BACKEND_PORT" "$FRONTEND_PORT" "$CONTRACT_FILE"
    echo "  Contract updated: $(jq '.backend.endpoints|length' "$CONTRACT_FILE") API tests"
    phase_done 3 "{\"status\":\"ok\",\"files_written\":$FILES_WRITTEN}"
    lesson_record 3 "Code Generation" "ok" "Code generation produced $FILES_WRITTEN files without write/format failures."
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 4: INSTALL + VERIFY DEPENDENCIES
# ═══════════════════════════════════════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Phase 4: Installing & Verifying Dependencies"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
phase_reminder 4 "Installing & Verifying Dependencies"

# Always run install if node_modules or .venv/venv is missing, even when resuming
NEEDS_INSTALL=0
while IFS= read -r req_file; do
    dir=$(dirname "$req_file")
    [[ ! -d "$dir/.venv" && ! -d "$dir/venv" ]] && NEEDS_INSTALL=1
done < <(find "$PROJECT_ROOT" -name "requirements.txt" -not -path "*/node_modules/*")
while IFS= read -r pyproj; do
    dir=$(dirname "$pyproj")
    [[ ! -d "$dir/.venv" && ! -d "$dir/venv" ]] && NEEDS_INSTALL=1
done < <(find "$PROJECT_ROOT" -name "pyproject.toml" -not -path "*/node_modules/*")
while IFS= read -r pkg_file; do
    dir=$(dirname "$pkg_file")
    [[ ! -d "$dir/node_modules" ]] && NEEDS_INSTALL=1
done < <(find "$PROJECT_ROOT" -name "package.json" -not -path "*/node_modules/*")

if [[ "$LAST_PHASE" -ge 4 && $NEEDS_INSTALL -eq 0 ]]; then
    echo "  (re-running verification even though dependencies appear present)"
fi
{
    > "$SETUP_LOG"
    PHASE4_LOG="$PROJECT_ROOT/phase4_dependency_check.log"
    > "$PHASE4_LOG"

    echo "  [Install] Detailed logs: $SETUP_LOG"
    echo "  [Verify]  Detailed logs: $PHASE4_LOG"

    # Python backend: uv/.venv preferred
    while IFS= read -r py_file; do
        dir=$(dirname "$py_file")
        echo "[Python] target=$dir" | tee -a "$PHASE4_LOG"

        if [[ -f "$dir/pyproject.toml" && -n "$(command -v uv 2>/dev/null)" ]]; then
            (cd "$dir" && uv sync) >> "$SETUP_LOG" 2>&1 || true
            [[ ! -d "$dir/.venv" ]] && (cd "$dir" && uv venv .venv) >> "$SETUP_LOG" 2>&1 || true
        else
            if [[ ! -d "$dir/.venv" && ! -d "$dir/venv" ]]; then
                python3 -m venv "$dir/.venv" >> "$SETUP_LOG" 2>&1 || python3 -m venv "$dir/venv" >> "$SETUP_LOG" 2>&1 || true
            fi
            if [[ -f "$dir/requirements.txt" ]]; then
                if [[ -x "$dir/.venv/bin/pip" ]]; then
                    "$dir/.venv/bin/pip" install -r "$dir/requirements.txt" >> "$SETUP_LOG" 2>&1 || true
                elif [[ -x "$dir/venv/bin/pip" ]]; then
                    "$dir/venv/bin/pip" install -r "$dir/requirements.txt" >> "$SETUP_LOG" 2>&1 || true
                fi
            fi
        fi

        python3 - "$dir" "$PHASE4_LOG" << 'PYV'
import os,sys,subprocess
d,log=sys.argv[1],sys.argv[2]
venv = os.path.join(d,'.venv') if os.path.isdir(os.path.join(d,'.venv')) else os.path.join(d,'venv')
ok = os.path.isdir(venv)
py = os.path.join(venv,'bin','python')
with open(log,'a') as f:
    f.write(f"[Python] venv_present={ok} path={venv}\n")
    if ok and os.path.exists(py):
        r=subprocess.run([py,'-c','import sys;print(sys.version)'],capture_output=True,text=True)
        f.write(f"[Python] python_ok={r.returncode==0} version={r.stdout.strip()}\n")
    else:
        f.write("[Python] python_ok=False\n")
PYV

    done < <(find "$PROJECT_ROOT" \( -name "requirements.txt" -o -name "pyproject.toml" \) -not -path "*/node_modules/*")

    # Node frontend/backend package install + verify scripts + node_modules
    while IFS= read -r pkg_file; do
        dir=$(dirname "$pkg_file")
        echo "[Node] target=$dir" | tee -a "$PHASE4_LOG"
        if (cd "$dir" && npm install --include=dev) >> "$SETUP_LOG" 2>&1; then
            echo "[Node] npm install ok: $dir" >> "$PHASE4_LOG"
        else
            echo "[Node] npm install failed: $dir -> attempting self-heal for invalid deps" >> "$PHASE4_LOG"
            python3 "$SCRIPTS_DIR/fix_node_deps.py" "$dir" >> "$SETUP_LOG" 2>&1 || true
            (cd "$dir" && npm install --include=dev) >> "$SETUP_LOG" 2>&1 || true
        fi

        python3 - "$dir" "$PHASE4_LOG" "$SETUP_LOG" << 'NV'
import os,sys,json,subprocess
from subprocess import TimeoutExpired

d,log,setup=sys.argv[1],sys.argv[2],sys.argv[3]
p=os.path.join(d,'package.json')
if not os.path.exists(p): sys.exit(0)
try:
    pkg=json.load(open(p))
except Exception:
    pkg={}
scripts=pkg.get('scripts',{}) or {}
has_dev='dev' in scripts
has_start='start' in scripts
has_build='build' in scripts
nm=os.path.isdir(os.path.join(d,'node_modules'))

with open(log,'a') as f:
    f.write(f"[Node] node_modules_present={nm} dev_script={has_dev} start_script={has_start} build_script={has_build}\n")
    deps={**pkg.get('dependencies',{}),**pkg.get('devDependencies',{})}
    miss=[]
    for k in list(deps.keys())[:120]:
        kp=os.path.join(d,'node_modules',*k.split('/'))
        if not os.path.isdir(kp):
            miss.append(k)
    if miss:
        f.write(f"[Node] missing_declared_packages={miss[:30]}\n")

# Explicitly test npm scripts work in Phase 4
# build: must run and exit
# dev/start: smoke-run with timeout (expect long-running; timeout means command started successfully)
def run_script(script, timeout_sec):
    cmd=['npm','run',script]
    with open(setup,'a') as lf:
        lf.write(f"\n[PHASE4_SCRIPT_TEST] {d} :: {' '.join(cmd)}\n")
        try:
            r=subprocess.run(cmd,cwd=d,stdout=lf,stderr=lf,timeout=timeout_sec)
            return (r.returncode==0, f"exit={r.returncode}")
        except TimeoutExpired:
            return (True, f"timeout({timeout_sec}s)-assume-started")
        except Exception as e:
            return (False, f"error={e}")

results=[]
if has_build:
    ok,msg=run_script('build',180)
    results.append(("build",ok,msg))
if has_dev:
    ok,msg=run_script('dev',20)
    results.append(("dev",ok,msg))
if has_start:
    ok,msg=run_script('start',20)
    results.append(("start",ok,msg))

with open(log,'a') as f:
    for name,ok,msg in results:
        f.write(f"[NodeScript] {name} ok={ok} {msg}\n")
NV

    done < <(find "$PROJECT_ROOT" -name "package.json" -not -path "*/node_modules/*" -not -path "*/.next/*")

    # One pass auto-install based on detected missing imports/modules
    auto_install_missing_libs "$PROJECT_ROOT" "$SETUP_LOG"

    echo "  [Phase4] Verification snapshot:"
    tail -n 20 "$PHASE4_LOG" | sed 's/^/    /'

    phase_done 4 '{"status":"ok"}'
    lesson_record 4 "Installing & Verifying Dependencies" "ok" "Dependency installation and verification logs generated (phase4_dependency_check.log)."
    lesson_record_from_file 4 "Installing & Verifying Dependencies" "warn" "$SETUP_LOG" "Dependency/install warnings"
    lesson_record_from_file 4 "Installing & Verifying Dependencies" "warn" "$PHASE4_LOG" "Dependency verification findings"
}
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 5: STATIC PRE-FLIGHT (syntax + import + vite config checks)
# ═══════════════════════════════════════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Phase 5: Static Pre-flight Checks"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
phase_reminder 5 "Static Pre-flight Checks"

run_preflight() {
    python3 "$SCRIPTS_DIR/preflight.py" "$PROJECT_ROOT"
    return $?
}

if [[ "$LAST_PHASE" -ge 5 ]]; then
    # Always re-run preflight even on resume — catches issues from prev debug iterations
    echo "  (re-running — checks are fast)"
fi

PREFLIGHT_ATTEMPTS=0
PREFLIGHT_PASSED=0

while [[ $PREFLIGHT_ATTEMPTS -lt 2 ]]; do
    run_preflight
    PFRESULT=$?
    if [[ $PFRESULT -eq 0 ]]; then
        echo "  ✅ Pre-flight passed — no static errors"
        PREFLIGHT_PASSED=1
        break
    fi

    PREFLIGHT_ATTEMPTS=$((PREFLIGHT_ATTEMPTS + 1))
    PREFLIGHT_ERR="$PROJECT_ROOT/preflight_errors.log"

    if [[ $PREFLIGHT_ATTEMPTS -ge 2 ]]; then
        echo "  ⚠️  Pre-flight issues remain after repair — continuing (runtime will confirm)"
        lesson_record 5 "Static Pre-flight Checks" "warn" "Static preflight still failed after repair attempt; runtime phase must diagnose."
        break
    fi

    echo "  [PreFlight] Sending static errors to $REPAIR_MODEL..."
    PF_CONTEXT=$(cat "$PREFLIGHT_ERR" 2>/dev/null)

    # Build targeted repair context from preflight errors
    PF_FILES=""
    python3 - "$PREFLIGHT_ERR" "$PROJECT_ROOT" << 'PF_PY'
import json, os, sys
try:
    with open(sys.argv[1]) as f: report=json.load(f)
except: sys.exit(0)
root=sys.argv[2]
targets=set()
for e in report.get("errors",[]):
    f=e.get("file","")
    if f: targets.add(os.path.join(root,f))
for path in targets:
    if os.path.exists(path):
        rel=os.path.relpath(path,root)
        content=open(path).read()
        print(f"\nFILE_CONTENT: {rel}\n{content}")
PF_PY

    PF_REPAIR_PROMPT="$LOGS_DIR/preflight_repair_${PREFLIGHT_ATTEMPTS}.txt"
    PF_REPAIR_OUT="$LOGS_DIR/preflight_repair_out_${PREFLIGHT_ATTEMPTS}.txt"

    cat > "$PF_REPAIR_PROMPT" << PFPROMPT
You are a code repair expert. Fix the following static analysis errors found before launch.
Output ONLY fixed files using FILE: format. No markdown, no explanation.

ERRORS:
$PF_CONTEXT

$PF_FILES

For each error listed, output the complete fixed file content as:
FILE: relative/path/to/file.ext
<complete fixed content — no truncation>
PFPROMPT

    PF_REPAIR_OK=0
    if ollama_call "$REPAIR_MODEL" "$PF_REPAIR_PROMPT" "$PF_REPAIR_OUT" "PreFlight-Repair" 180; then
        PF_REPAIR_OK=1
    elif ollama_call "$REPAIR_FALLBACK" "$PF_REPAIR_PROMPT" "$PF_REPAIR_OUT" "PreFlight-Fallback" 180; then
        PF_REPAIR_OK=1
    fi
    if [[ $PF_REPAIR_OK -eq 1 ]]; then
        echo "  [PreFlight] Applying fixes..."
        "$SCRIPTS_DIR/write_files.sh" "$PF_REPAIR_OUT" "$PROJECT_ROOT"
        # Reinstall if package.json was fixed
        if grep -q "package.json" "$PF_REPAIR_OUT" 2>/dev/null; then
            for fe_dir in frontend client web ui; do
                if [[ -d "$PROJECT_ROOT/$fe_dir" ]]; then
                    npm install --prefix "$PROJECT_ROOT/$fe_dir" --include=dev >> "$SETUP_LOG" 2>&1
                fi
            done
        fi
    fi
done

phase_done 5 "{\"status\":\"ok\",\"preflight_passed\":$PREFLIGHT_PASSED}"
if [[ $PREFLIGHT_PASSED -eq 1 ]]; then
    lesson_record 5 "Static Pre-flight Checks" "ok" "Preflight passed cleanly before launch."
else
    lesson_record_from_file 5 "Static Pre-flight Checks" "failed" "$PROJECT_ROOT/preflight_errors.log" "Preflight errors"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 6: LAUNCH SERVICES
# ═══════════════════════════════════════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Phase 6: Launching Services"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
phase_reminder 6 "Launching Services"

# Check if services are already running (resume case)
SERVICES_RUNNING=0
if [[ "$LAST_PHASE" -ge 6 ]]; then
    if pm status "$PROJECT_ROOT" 2>/dev/null | grep -q "running"; then
        echo "  Services already running (from previous run)"
        SERVICES_RUNNING=1
    fi
fi

if [[ $SERVICES_RUNNING -eq 0 ]]; then
    if ! pm start "$PROJECT_ROOT" "$BACKEND_PORT" "$FRONTEND_PORT"; then
        echo "  [PM] startup command discovery failed for one or more services"
        lesson_record 6 "Launching Services" "failed" "process_manager could not discover valid startup commands for backend/frontend"
    fi
fi

echo "  Waiting for services to be ready..."
python3 - "$BACKEND_PORT" "$FRONTEND_PORT" \
    "$PROJECT_ROOT/backend.log" "$PROJECT_ROOT/frontend.log" << 'HEALTH_PY'
import sys,time,urllib.request,urllib.error
be_port,fe_port=sys.argv[1],sys.argv[2]
be_log,fe_log=sys.argv[3],sys.argv[4]

def wait_for(url, name, log, timeout=60):
    start=time.time()
    last=""
    while time.time()-start<timeout:
        try:
            r=urllib.request.urlopen(url,timeout=2)
            print(f"  ✅ {name} ready ({r.status})"); return True
        except urllib.error.HTTPError as e:
            if e.code in (404,405,422,307):
                print(f"  ✅ {name} ready ({e.code})"); return True
            last=str(e)
        except Exception as e:
            last=str(e)
        time.sleep(1)
    print(f"  ❌ {name} timed out. Last: {last}")
    try:
        lines=open(log).readlines()
        for l in lines[-12:]: print("    "+l.rstrip())
    except: pass
    return False

be_up=wait_for(f"http://localhost:{be_port}/docs","Backend(docs)",be_log,60)
if not be_up:
    be_up=wait_for(f"http://localhost:{be_port}/","Backend",be_log,10)
fe_up=wait_for(f"http://localhost:{fe_port}/","Frontend",fe_log,90)
sys.exit(0 if (be_up and fe_up) else 1)
HEALTH_PY
LAUNCH_OK=$?

if [[ $LAUNCH_OK -eq 0 ]]; then
    phase_done 6 '{"status":"ok"}'
    lesson_record 6 "Launching Services" "ok" "Backend/frontend became reachable within health-check timeout."
else
    phase_done 6 '{"status":"partial"}'
    echo "  ⚠️  One or more services failed to start — UAT will diagnose"

    FE_MISSING_DEV=$(grep -E "Missing script: \"dev\"" "$PROJECT_ROOT/frontend.log" 2>/dev/null | tail -1)
    if [[ -n "$FE_MISSING_DEV" ]]; then
        lesson_record 6 "Launching Services" "failed" "Frontend launch failed: npm script 'dev' missing in package.json. Ensure frontend/package.json has scripts.dev before launch."
    else
        lesson_record 6 "Launching Services" "failed" "Service health checks timed out (connection refused / startup failure). Inspect backend.log and frontend.log before UAT."
    fi
    lesson_record_from_file 6 "Launching Services" "failed" "$PROJECT_ROOT/frontend.log" "Frontend startup errors"
    lesson_record_from_file 6 "Launching Services" "failed" "$PROJECT_ROOT/backend.log" "Backend startup errors"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 7: CONTRACT-DRIVEN UAT
# ═══════════════════════════════════════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Phase 7: Contract-Driven UAT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
phase_reminder 7 "Contract-Driven UAT"
echo "  Contract: $(jq '.backend.endpoints|length' "$CONTRACT_FILE") API tests + $(jq '.frontend.checks|length' "$CONTRACT_FILE") frontend checks"
echo ""

python3 "$SCRIPTS_DIR/uat_runner.py" "$CONTRACT_FILE" "$UAT_REPORT"
UAT_EXIT=$?
UAT_PASSED=$([[ $UAT_EXIT -eq 0 ]] && echo 1 || echo 0)

if [[ $UAT_PASSED -eq 1 ]]; then
    phase_done 7 '{"status":"ok","all_pass":true}'
    lesson_record 7 "Contract-Driven UAT" "ok" "All contract tests passed in first UAT run."
    echo ""
    echo "  ✅ All UAT tests passed!"
else
    phase_done 7 '{"status":"failed"}'
    FAIL_CATS=$(jq -r '.failure_categories | join(", ")' "$UAT_REPORT" 2>/dev/null || echo "unknown")
    FAIL_DETAILS=$(jq -r '.failures | map("[" + (.category // "?") + "] " + (.test // "?") + " => " + ((.actual // "")|tostring)) | .[:3] | join(" ; ")' "$UAT_REPORT" 2>/dev/null || echo "")
    lesson_record 7 "Contract-Driven UAT" "failed" "UAT failed with categories: $FAIL_CATS. Details: $FAIL_DETAILS"
    echo ""
    echo "  ⚠️  UAT failures detected — entering debug loop"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 8: TARGETED DEBUG LOOP
# ═══════════════════════════════════════════════════════════════════════════════
DEBUG_ITERATIONS=$(state_get "debug_iterations" "0")

if [[ $UAT_PASSED -eq 0 ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Phase 8: Targeted Debug Loop"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    phase_reminder 8 "Targeted Debug Loop"

    # On resume: start from where we left off (don't repeat already-tried fixes)
    START_ITER=$((DEBUG_ITERATIONS + 1))
    MAX_ITER=3

    if [[ $DEBUG_ITERATIONS -ge $MAX_ITER ]]; then
        echo "  ⚠️  Already ran $DEBUG_ITERATIONS debug iterations — manual intervention needed"
        echo "  Check: tail -f $PROJECT_ROOT/backend.log"
        echo "  Check: tail -f $PROJECT_ROOT/frontend.log"
    fi

    for DEBUG_ITER in $(seq $START_ITER $MAX_ITER); do
        [[ $UAT_PASSED -eq 1 ]] && break

        echo ""
        echo "  ┌─────────────────────────────────────────┐"
        echo "  │  Debug iteration $DEBUG_ITER / $MAX_ITER                 │"
        echo "  └─────────────────────────────────────────┘"

        # ── Step A: structured repair context ────────────────────────────────
        echo "  [Debug $DEBUG_ITER/A] Categorizing failures..."
        python3 "$SCRIPTS_DIR/repair_planner.py" \
            "$UAT_REPORT" "$PROJECT_ROOT" "$REPAIR_CONTEXT"

        # Append runtime logs + iteration history
        {
            echo ""
            echo "=== Backend Runtime Log (last 40 lines) ==="
            tail -40 "$PROJECT_ROOT/backend.log" 2>/dev/null || echo "(empty)"
            echo ""
            echo "=== Frontend Runtime Log (last 40 lines) ==="
            tail -40 "$PROJECT_ROOT/frontend.log" 2>/dev/null || echo "(empty)"
            echo ""
            if [[ $DEBUG_ITER -gt 1 ]]; then
                echo "=== Previous Fix Attempts (do NOT repeat these) ==="
                for prev in $(seq 1 $((DEBUG_ITER-1))); do
                    echo "--- Iteration $prev: files changed ---"
                    grep "^FILE:" "$LOGS_DIR/debug_output_${prev}.txt" 2>/dev/null || echo "(none)"
                    echo "--- Iteration $prev: UAT result ---"
                    jq -r '.failures[].test' "$UAT_REPORT" 2>/dev/null | head -5 || echo "(no report)"
                done
            fi
        } >> "$REPAIR_CONTEXT"

        # ── Step B: repair model ──────────────────────────────────────────────
        DEBUG_PROMPT="$LOGS_DIR/debug_prompt_${DEBUG_ITER}.txt"
        DEBUG_OUTPUT="$LOGS_DIR/debug_output_${DEBUG_ITER}.txt"

        render_template "$PROMPTS_DIR/debug.txt" "$DEBUG_PROMPT" \
            "ERROR_CONTEXT=$(cat "$REPAIR_CONTEXT")" \
            "SOURCE_FILES=" \
            "BACKEND_PORT=$BACKEND_PORT" \
            "FRONTEND_PORT=$FRONTEND_PORT"

        echo "  [Debug $DEBUG_ITER/B] Calling $REPAIR_MODEL..."
        REPAIR_OK=0
        if ollama_call "$REPAIR_MODEL" "$DEBUG_PROMPT" "$DEBUG_OUTPUT" "Debug-$DEBUG_ITER" 300; then
            REPAIR_OK=1
        else
            echo "  [Debug $DEBUG_ITER] $REPAIR_MODEL failed — trying fallback $REPAIR_FALLBACK..."
            if ollama_call "$REPAIR_FALLBACK" "$DEBUG_PROMPT" "$DEBUG_OUTPUT" "Debug-$DEBUG_ITER-fallback" 240; then
                REPAIR_OK=1
                echo "  [Debug $DEBUG_ITER] Fallback model succeeded"
            fi
        fi
        if [[ $REPAIR_OK -eq 0 ]]; then
            echo "  [Debug $DEBUG_ITER] All repair models failed — skipping iteration"
            DEBUG_ITERATIONS=$DEBUG_ITER
            state_set "debug_iterations" "$DEBUG_ITERATIONS"
            continue
        fi

        FILES_FIXED=$(grep -c "^FILE:" "$DEBUG_OUTPUT" 2>/dev/null || echo 0)
        echo "  [Debug $DEBUG_ITER/C] Applying $FILES_FIXED fix(es)..."
        "$SCRIPTS_DIR/write_files.sh" "$DEBUG_OUTPUT" "$PROJECT_ROOT"
        echo "  [Debug $DEBUG_ITER/C] Validating written files..."
        python3 "$SCRIPTS_DIR/validate_written_files.py" "$PROJECT_ROOT"

        # ── Step C: reinstall if package.json changed ─────────────────────────
        if grep -q "package.json" "$DEBUG_OUTPUT" 2>/dev/null; then
            echo "  [Debug $DEBUG_ITER] package.json changed — reinstalling..."
            for fe_dir in frontend client web ui; do
                if [[ -d "$PROJECT_ROOT/$fe_dir" ]]; then
                    npm install --prefix "$PROJECT_ROOT/$fe_dir" --include=dev >> "$SETUP_LOG" 2>&1
                    python3 - "$PROJECT_ROOT/$fe_dir" "$SETUP_LOG" << 'FIX_PY'
import sys,os,subprocess,json
d,log=sys.argv[1],sys.argv[2]
pkg=os.path.join(d,"package.json")
if not os.path.exists(pkg): sys.exit(0)
with open(pkg) as f: p=json.load(f)
decl={**p.get("dependencies",{}),**p.get("devDependencies",{})}
miss=[x for x in ["vite","@vitejs/plugin-react"] if x in decl
      and not os.path.isdir(os.path.join(d,"node_modules",x))]
if miss:
    with open(log,'a') as lf:
        subprocess.run(["npm","install","--save-dev"]+miss,cwd=d,stdout=lf,stderr=lf)
    print(f"  [Node] Fixed: {miss}")
FIX_PY
                fi
            done
        fi

        # ── Step D: auto-install missing libraries + preflight ───────────────
        echo "  [Debug $DEBUG_ITER/D] Auto-install missing libraries (js/python) if detected..."
        auto_install_missing_libs "$PROJECT_ROOT" "$SETUP_LOG"

        echo "  [Debug $DEBUG_ITER/D] Quick pre-flight check..."
        if ! python3 "$SCRIPTS_DIR/preflight.py" "$PROJECT_ROOT" 2>/dev/null; then
            echo "  [Debug $DEBUG_ITER] Pre-flight still failing — restart may not help"
        fi

        # ── Step E: restart only affected service ─────────────────────────────
        BACKEND_CHANGED=$(grep -c "^FILE:.*backend\|^FILE:.*main\.py\|^FILE:.*requirements" \
            "$DEBUG_OUTPUT" 2>/dev/null || echo 0)
        FRONTEND_CHANGED=$(grep -c "^FILE:.*frontend\|^FILE:.*package\.json\|^FILE:.*vite\.config" \
            "$DEBUG_OUTPUT" 2>/dev/null || echo 0)

        echo "  [Debug $DEBUG_ITER/E] Restarting (backend=$BACKEND_CHANGED frontend=$FRONTEND_CHANGED files changed)..."
        pm restart "$PROJECT_ROOT" "$BACKEND_PORT" "$FRONTEND_PORT"

        echo "  [Debug $DEBUG_ITER] Waiting for restart..."
        python3 - "$BACKEND_PORT" "$FRONTEND_PORT" \
            "$PROJECT_ROOT/backend.log" "$PROJECT_ROOT/frontend.log" << 'RESTART_HEALTH'
import sys,time,urllib.request,urllib.error
be,fe=sys.argv[1],sys.argv[2]
be_log,fe_log=sys.argv[3],sys.argv[4]
def wait(url,name,log,t=45):
    start=time.time()
    while time.time()-start<t:
        try:
            r=urllib.request.urlopen(url,timeout=2); return True
        except urllib.error.HTTPError as e:
            if e.code in (404,405,422): return True
        except: pass
        time.sleep(1)
    print(f"  ❌ {name} still down")
    try:
        for l in open(log).readlines()[-6:]: print("    "+l.rstrip())
    except: pass
    return False
wait(f"http://localhost:{be}/docs","Backend(docs)",be_log,45)
wait(f"http://localhost:{fe}/","Frontend",fe_log,60)
RESTART_HEALTH

        # ── Step F: re-run UAT ────────────────────────────────────────────────
        echo "  [Debug $DEBUG_ITER/F] Re-running UAT..."
        python3 "$SCRIPTS_DIR/uat_runner.py" "$CONTRACT_FILE" "$UAT_REPORT"
        REUAT_EXIT=$?

        DEBUG_ITERATIONS=$DEBUG_ITER
        state_set "debug_iterations" "$DEBUG_ITERATIONS"

        if [[ $REUAT_EXIT -eq 0 ]]; then
            UAT_PASSED=1
            phase_done 8 "{\"status\":\"ok\",\"iterations\":$DEBUG_ITERATIONS}"
            lesson_record 8 "Targeted Debug Loop" "ok" "Resolved UAT failures by iteration $DEBUG_ITER."
            echo ""
            echo "  ✅ All tests pass after debug iteration $DEBUG_ITER!"
        else
            REMAINING=$(python3 -c "
import json; r=json.load(open('$UAT_REPORT'))
f=[x['test'] for x in r.get('failures',[])]
print(f'Still failing ({len(f)}): {f}')" 2>/dev/null)
            echo "  $REMAINING"
            lesson_record 8 "Targeted Debug Loop" "failed" "Debug iteration $DEBUG_ITER still failing: $REMAINING"
            lesson_record_from_file 8 "Targeted Debug Loop" "failed" "$REPAIR_CONTEXT" "Debug repair context errors"
            phase_done 8 "{\"status\":\"partial\",\"iterations\":$DEBUG_ITERATIONS}"
        fi
    done
fi

# ═══════════════════════════════════════════════════════════════════════════════
# GENERATE start.sh for manual re-launch
# ═══════════════════════════════════════════════════════════════════════════════
python3 - "$PROJECT_ROOT" "$BACKEND_PORT" "$FRONTEND_PORT" "$SCRIPT_DIR" << 'STARTPY'
import os,sys,stat
root,be_port,fe_port,script_dir=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4]
be_dir=fe_dir=""; main_mod="main"
for c in ["backend","api","server"]:
    d=os.path.join(root,c)
    if os.path.isdir(d) and any(f.endswith('.py') for f in os.listdir(d)):
        be_dir=c
        for f in ["main.py","app.py"]:
            if os.path.exists(os.path.join(d,f)): main_mod=f.replace(".py",""); break
        break
for c in ["frontend","client","web"]:
    d=os.path.join(root,c)
    if os.path.isdir(d) and os.path.exists(os.path.join(d,"package.json")):
        fe_dir=c; break
pm=os.path.join(script_dir,"scripts","process_manager.py")
content=f"""#!/bin/bash
# start.sh — Re-launch all autodev services
ROOT="$(cd "$(dirname "${{BASH_SOURCE[0]}}")" && pwd)"
python3 "{pm}" start "$ROOT" {be_port} {fe_port}
echo ""
echo "  Backend:  http://localhost:{be_port}"
echo "  API Docs: http://localhost:{be_port}/docs"
echo "  Frontend: http://localhost:{fe_port}"
echo "  Logs:     tail -f $ROOT/backend.log | $ROOT/frontend.log"
"""
path=os.path.join(root,"start.sh")
with open(path,'w') as f: f.write(content)
os.chmod(path,stat.S_IRWXU|stat.S_IRGRP|stat.S_IXGRP|stat.S_IROTH|stat.S_IXOTH)
STARTPY

# ═══════════════════════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════╗"
if [[ $UAT_PASSED -eq 1 ]]; then
    echo "║   ✅  All Systems Green — UAT Passed     ║"
elif [[ $DEBUG_ITERATIONS -gt 0 ]]; then
    echo "║   ⚠️   Built — UAT partial ($DEBUG_ITERATIONS/$MAX_RETRIES debug runs)  ║"
else
    echo "║   ⚠️   Built — UAT incomplete            ║"
fi
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  📁  Project:      $PROJECT_ROOT"
echo "  📋  Contract:     $CONTRACT_FILE"
echo "  📊  UAT report:   $UAT_REPORT"
echo "  💾  State file:   $STATE_FILE"
echo "  🧠  Lessons dir:  $LESSONS_DIR"
echo ""
echo "  Generated files:"
find "$PROJECT_ROOT" -type f \
    -not -path "*/node_modules/*" -not -path "*/venv/*" \
    -not -path "*/__pycache__/*"  -not -name "*.pyc" \
    | sort | sed "s|$PROJECT_ROOT/||" | sed 's/^/     /'
echo ""

if pm status "$PROJECT_ROOT" 2>/dev/null | grep -q "running"; then
    echo "  🟢  Services running:"
    echo "       Backend:   http://localhost:$BACKEND_PORT"
    echo "       API Docs:  http://localhost:$BACKEND_PORT/docs"
    echo "       Frontend:  http://localhost:$FRONTEND_PORT"
    echo ""
    echo "       Logs:      tail -f $PROJECT_ROOT/backend.log"
    echo "                  tail -f $PROJECT_ROOT/frontend.log"
    echo "       Stop:      python3 $SCRIPTS_DIR/process_manager.py stop $PROJECT_ROOT"
    echo "       Restart:   ./start.sh"
fi

echo ""
echo "  Re-run UAT:   python3 $SCRIPTS_DIR/uat_runner.py $CONTRACT_FILE $UAT_REPORT"
echo "  Resume build: $0 \"$TASK\""
if [[ $UAT_PASSED -eq 0 ]]; then
    echo ""
    echo "  ⚠️  Failed tests:"
    jq -r '.failures[] | "     [\(.category)] \(.test): \(.actual)"' \
        "$UAT_REPORT" 2>/dev/null || true
fi
echo ""

# Refresh versioned lessons after this run's outcomes
kick_lessons_analysis

[[ $UAT_PASSED -eq 1 ]] && exit 0 || exit 1
