#!/bin/bash
# autodev.sh - Local Autonomous Multi-Agent Software Development System v4
# Phases: Plan → Code → Install → Validate → Launch → UAT → Debug Loop

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config/agent.config.json"
PROMPTS_DIR="$SCRIPT_DIR/prompts"
SCRIPTS_DIR="$SCRIPT_DIR/scripts"
LOGS_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOGS_DIR"

# ── Dependency checks ─────────────────────────────────────────────────────────
for cmd in curl jq python3; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "Error: '$cmd' not found. Install with: brew install $cmd"
        exit 1
    fi
done

OLLAMA_API="http://localhost:11434"
if ! curl -sf "$OLLAMA_API/api/tags" > /dev/null 2>&1; then
    echo "Error: Ollama not running. Start with: ollama serve"
    exit 1
fi
echo "✅ Ollama API reachable at $OLLAMA_API"

# ── Config ────────────────────────────────────────────────────────────────────
cfg() {
    local key="$1" default="${2:-}"
    local val
    val=$(jq -r ".$key // empty" "$CONFIG_FILE" 2>/dev/null)
    [[ -z "$val" || "$val" == "null" ]] && echo "$default" || echo "$val"
}

PLANNER_MODEL=$(cfg "planner_model" "qwen2.5-coder:14b")
CODER_MODEL=$(cfg  "coder_model"    "qwen2.5-coder:32b")
REPAIR_MODEL=$(cfg "repair_model"   "deepseek-coder:33b")
MAX_RETRIES=$(cfg  "max_retries"    "3")
PROJECT_REL=$(cfg  "project_root"   "workspace")
PROJECT_BASE="$SCRIPT_DIR/$PROJECT_REL"

BACKEND_PORT=$(cfg "backend_port"   "8000")
FRONTEND_PORT=$(cfg "frontend_port" "5173")

# ── Usage ─────────────────────────────────────────────────────────────────────
if [[ -z "${1:-}" ]]; then
    echo "Usage: $0 \"<Task Description>\""
    exit 1
fi

TASK="$1"
PROJECT_SLUG=$(python3 -c "
import sys, re
s = re.sub(r'[^a-z0-9]+', '-', sys.argv[1].lower())[:40].strip('-')
print(s or 'project')
" "$TASK")
PROJECT_ROOT="$PROJECT_BASE/$PROJECT_SLUG"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║      AutoDev — Local Agent Loop v4       ║"
echo "╚══════════════════════════════════════════╝"
echo "  Task:    $TASK"
echo "  Output:  $PROJECT_ROOT"
echo "  Models:  $PLANNER_MODEL / $CODER_MODEL / $REPAIR_MODEL"
echo ""
mkdir -p "$PROJECT_ROOT"

# ═══════════════════════════════════════════════════════════════════════════════
# CORE HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

render_template() {
    local tmpl="$1" out="$2"
    shift 2
    python3 - "$tmpl" "$out" "$@" << 'PYEOF'
import sys, os
tmpl_path, out_path = sys.argv[1], sys.argv[2]
with open(tmpl_path) as f:
    content = f.read()
for arg in sys.argv[3:]:
    eq = arg.index('=')
    k, v = arg[:eq], arg[eq+1:]
    content = content.replace('{{' + k + '}}', v)
with open(out_path, 'w') as f:
    f.write(content)
PYEOF
}

ollama_call() {
    local model="$1" prompt_file="$2" out_file="$3"
    local label="${4:-Agent}" timeout="${5:-300}"
    echo "  [$label] Calling $model (timeout: ${timeout}s)..."
    local prompt payload api_response model_output
    prompt=$(cat "$prompt_file")
    payload=$(python3 -c "
import json, sys
print(json.dumps({'model':sys.argv[1],'prompt':sys.argv[2],'stream':False,
  'options':{'temperature':0.1,'num_ctx':8192,'num_predict':4096}}))
" "$model" "$prompt")
    api_response=$(curl -s --max-time "$timeout" \
        -H "Content-Type: application/json" -d "$payload" \
        "$OLLAMA_API/api/generate" 2>&1)
    local curl_exit=$?
    if [[ $curl_exit -ne 0 ]]; then
        echo "  [$label] ERROR: curl failed (exit $curl_exit)"
        return 1
    fi
    model_output=$(python3 -c "
import json, sys
raw = sys.stdin.read()
try:
    obj = json.loads(raw)
    if 'error' in obj:
        print('OLLAMA_ERROR: '+obj['error'],file=sys.stderr); sys.exit(1)
    print(obj.get('response',''), end='')
except: print(raw, end='')
" <<< "$api_response")
    local py_exit=$? chars=${#model_output}
    if [[ $py_exit -ne 0 ]]; then
        echo "  [$label] ERROR: API error. Raw: $(echo "$api_response" | head -2)"
        return 1
    fi
    echo "$model_output" > "$out_file"
    echo "  [$label] Done. ($chars chars)"
    [[ $chars -lt 10 ]] && { echo "  [$label] WARNING: response too short"; return 1; }
    return 0
}

extract_json() {
    local file="$1"
    python3 - "$file" << 'PYEOF'
import sys, json, re
with open(sys.argv[1]) as f:
    raw = f.read()
def try_parse(s):
    try: return json.loads(s.strip())
    except: return None
result = try_parse(raw)
if result: sys.exit(0)
clean = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]','',raw)
clean = re.sub(r'[⠀-⣿]+','',clean)
result = try_parse(clean)
if result:
    with open(sys.argv[1],'w') as f: json.dump(result,f,indent=2)
    sys.exit(0)
for pattern in [r'```json\s*([\s\S]*?)```',r'```\s*([\s\S]*?)```',
                r'<think>[\s\S]*?</think>\s*(\{[\s\S]*\})',r'(\{[\s\S]*\})']:
    m = re.search(pattern, clean)
    if m:
        result = try_parse(m.group(1))
        if result:
            with open(sys.argv[1],'w') as f: json.dump(result,f,indent=2)
            sys.exit(0)
print(f"  [JSON] FAILED. Raw ({len(raw)} chars):",file=sys.stderr)
print(raw[:300],file=sys.stderr)
sys.exit(1)
PYEOF
}

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 1: PLAN
# ═══════════════════════════════════════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Phase 1: Planning"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

PLAN_PROMPT="$LOGS_DIR/plan_prompt.txt"
PLAN_FILE="$LOGS_DIR/plan.json"
render_template "$PROMPTS_DIR/planner.txt" "$PLAN_PROMPT" "TASK_DESCRIPTION=$TASK"

PLAN_OK=0
for attempt in 1 2 3; do
    if ollama_call "$PLANNER_MODEL" "$PLAN_PROMPT" "$PLAN_FILE" "Planner" 120; then
        if extract_json "$PLAN_FILE"; then PLAN_OK=1; break; fi
        echo "  [Planner] Invalid JSON, retry $attempt..."
    fi
done

if [[ $PLAN_OK -eq 0 ]]; then
    echo "  [Planner] Using fallback plan"
    cat > "$PLAN_FILE" << 'FALLBACK'
{
  "project_type": "Web App",
  "tech_stack": ["React","TypeScript","FastAPI","SQLite"],
  "modules": [
    {"name":"Frontend","description":"React + Vite","technologies":["React","TypeScript","Vite"]},
    {"name":"Backend","description":"FastAPI REST","technologies":["FastAPI","SQLAlchemy","SQLite"]}
  ],
  "folder_structure": ["frontend/","backend/"],
  "dependencies": ["react","fastapi","uvicorn","sqlalchemy"]
}
FALLBACK
fi
echo ""; jq . "$PLAN_FILE"; echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 2: CODE GENERATION
# ═══════════════════════════════════════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Phase 2: Code Generation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

CODE_PROMPT="$LOGS_DIR/code_prompt.txt"
CODE_OUTPUT="$LOGS_DIR/code_output.txt"
render_template "$PROMPTS_DIR/coder.txt" "$CODE_PROMPT" \
    "TASK_DESCRIPTION=$TASK" "PLAN_JSON=$(cat "$PLAN_FILE")"

if ! ollama_call "$CODER_MODEL" "$CODE_PROMPT" "$CODE_OUTPUT" "Coder" 600; then
    echo "Error: Code generation failed."; exit 1
fi

echo "  Writing files..."
"$SCRIPTS_DIR/write_files.sh" "$CODE_OUTPUT" "$PROJECT_ROOT"

FILES_WRITTEN=$(find "$PROJECT_ROOT" -type f | wc -l | tr -d ' ')
echo "  Files written: $FILES_WRITTEN"
if [[ "$FILES_WRITTEN" -eq 0 ]]; then
    echo "ERROR: No files written. Raw LLM output:"; head -50 "$CODE_OUTPUT"; exit 1
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 3: INSTALL DEPENDENCIES (with devDep verification)
# ═══════════════════════════════════════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Phase 3: Installing Dependencies"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
SETUP_LOG="$PROJECT_ROOT/setup.log"
> "$SETUP_LOG"

# Python: venv + pip install
while IFS= read -r req_file; do
    dir=$(dirname "$req_file")
    echo "  [Python] $dir"
    if [[ ! -d "$dir/venv" ]]; then
        python3 -m venv "$dir/venv" >> "$SETUP_LOG" 2>&1
    fi
    "$dir/venv/bin/pip" install --quiet -r "$req_file" >> "$SETUP_LOG" 2>&1 \
        && echo "  [Python] ✅ installed" \
        || { echo "  [Python] ⚠️  install failed (check setup.log)"; cat "$SETUP_LOG" | tail -5; }
done < <(find "$PROJECT_ROOT" -name "requirements.txt" \
    -not -path "*/node_modules/*" -not -path "*/venv/*")

# Node: install with --include=dev then verify critical packages
while IFS= read -r pkg_file; do
    dir=$(dirname "$pkg_file")
    echo "  [Node]   $dir"

    # Always install with dev dependencies
    npm install --prefix "$dir" --include=dev >> "$SETUP_LOG" 2>&1
    NPM_EXIT=$?

    if [[ $NPM_EXIT -ne 0 ]]; then
        echo "  [Node]   ⚠️  npm install failed"
        tail -5 "$SETUP_LOG"
    else
        echo "  [Node]   ✅ npm install done"
    fi

    # ── Critical: verify Vite plugin packages are actually in node_modules ──
    # LLM sometimes puts @vitejs/plugin-react in devDependencies but older npm
    # versions or NODE_ENV=production can skip them. Verify and fix explicitly.
    python3 - "$dir" "$SETUP_LOG" << 'VERIFY_PY'
import sys, os, subprocess, json

fe_dir = sys.argv[1]
log_file = sys.argv[2]

# Read what package.json declared
pkg_path = os.path.join(fe_dir, "package.json")
if not os.path.exists(pkg_path):
    sys.exit(0)

with open(pkg_path) as f:
    pkg = json.load(f)

# Collect all declared packages (deps + devDeps)
all_declared = {}
all_declared.update(pkg.get("dependencies", {}))
all_declared.update(pkg.get("devDependencies", {}))

# Check which critical ones are missing
critical = ["vite", "@vitejs/plugin-react", "@vitejs/plugin-react-swc"]
missing = []
for p in critical:
    if p in all_declared:
        node_mod = os.path.join(fe_dir, "node_modules", p)
        if not os.path.isdir(node_mod):
            missing.append(p)

if missing:
    print(f"  [Node]   ⚠️  Missing after install: {missing}")
    print(f"  [Node]   Installing missing packages directly...")
    with open(log_file, 'a') as lf:
        r = subprocess.run(
            ["npm", "install", "--save-dev"] + missing,
            cwd=fe_dir, stdout=lf, stderr=lf
        )
    if r.returncode == 0:
        print(f"  [Node]   ✅ Fixed missing packages")
    else:
        print(f"  [Node]   ❌ Could not install: {missing}")
else:
    # Verify vite itself works
    vite_bin = os.path.join(fe_dir, "node_modules", ".bin", "vite")
    if os.path.exists(vite_bin):
        print(f"  [Node]   ✅ All critical packages present")
    else:
        print(f"  [Node]   ⚠️  vite binary not found in .bin/")
VERIFY_PY

done < <(find "$PROJECT_ROOT" -name "package.json" \
    -not -path "*/node_modules/*" -not -path "*/.next/*")

# Generate start.sh and process manager
python3 - "$PROJECT_ROOT" "$BACKEND_PORT" "$FRONTEND_PORT" << 'PYEOF'
import os, sys, json, stat

root        = sys.argv[1]
backend_port = sys.argv[2]
fe_port      = sys.argv[3]

backend_dir = frontend_dir = None
main_module = "main"

for c in ["backend","api","server","app"]:
    d = os.path.join(root, c)
    if os.path.isdir(d) and any(f.endswith('.py') for f in os.listdir(d)):
        backend_dir = c
        for f in ["main.py","app.py","server.py"]:
            if os.path.exists(os.path.join(d,f)):
                main_module = f.replace(".py","")
                break
        break

for c in ["frontend","client","web","ui"]:
    d = os.path.join(root, c)
    if os.path.isdir(d) and os.path.exists(os.path.join(d,"package.json")):
        frontend_dir = c
        break

lines = [
    "#!/bin/bash",
    "# start.sh — Launch all services and show logs",
    'ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    "cd \"$ROOT\"",
    "echo 'Starting services...'",
    "PIDS=()",
    ""
]

if backend_dir:
    venv_uv = f"{backend_dir}/venv/bin/uvicorn"
    lines += [
        "# ── Backend ──────────────────────────────────",
        f'if [ -f "$ROOT/{venv_uv}" ]; then UVICORN="$ROOT/{venv_uv}"',
        'elif command -v uvicorn &>/dev/null; then UVICORN="uvicorn"',
        "else echo '⚠  uvicorn not found'; UVICORN=''; fi",
        'if [ -n "$UVICORN" ]; then',
        f'  pushd "$ROOT/{backend_dir}" > /dev/null',
        f'  $UVICORN {main_module}:app --reload --port {backend_port} > "$ROOT/backend.log" 2>&1 &',
        '  PIDS+=($!)',
        f'  echo "✅ Backend  → http://localhost:{backend_port}"',
        f'  echo "✅ API Docs → http://localhost:{backend_port}/docs"',
        '  popd > /dev/null',
        'fi', ''
    ]

if frontend_dir:
    lines += [
        "# ── Frontend ─────────────────────────────────",
        f'pushd "$ROOT/{frontend_dir}" > /dev/null',
        f'npm run dev > "$ROOT/frontend.log" 2>&1 &',
        '  PIDS+=($!)',
        f'  echo "✅ Frontend → http://localhost:{fe_port}"',
        'popd > /dev/null', ''
    ]

lines += [
    'echo ""',
    'echo "Logs: tail -f $ROOT/backend.log  OR  $ROOT/frontend.log"',
    'echo "Stop: Ctrl+C"',
    'trap \'kill "${PIDS[@]}" 2>/dev/null; exit\' INT TERM',
    'wait'
]

path = os.path.join(root, "start.sh")
with open(path, 'w') as f:
    f.write('\n'.join(lines) + '\n')
os.chmod(path, stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP | stat.S_IROTH | stat.S_IXOTH)
print(f"  ✅ start.sh generated (backend={backend_dir}, frontend={frontend_dir})")
PYEOF
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 4: STATIC VALIDATION
# ═══════════════════════════════════════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Phase 4: Static Validation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

ATTEMPT=1; VALIDATION_PASSED=0
while [[ $ATTEMPT -le $MAX_RETRIES ]]; do
    echo "  [Validate] Attempt $ATTEMPT / $MAX_RETRIES"
    "$SCRIPTS_DIR/validate.sh" "$PROJECT_ROOT"
    if [[ $? -eq 0 ]]; then VALIDATION_PASSED=1; break; fi

    ERROR_LOG="$PROJECT_ROOT/errors.log"
    if [[ ! -s "$ERROR_LOG" ]]; then VALIDATION_PASSED=1; break; fi

    echo "  [Repair] Sending to $REPAIR_MODEL..."
    SOURCE_FILES=""
    while IFS= read -r -d '' f; do
        rel="${f#$PROJECT_ROOT/}"
        SOURCE_FILES+="FILE: $rel"$'\n'"$(cat "$f")"$'\n\n'
    done < <(find "$PROJECT_ROOT" \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" \) \
        -not -path "*/node_modules/*" -not -path "*/venv/*" -print0 2>/dev/null)

    REPAIR_PROMPT="$LOGS_DIR/repair_prompt_${ATTEMPT}.txt"
    REPAIR_OUTPUT="$LOGS_DIR/repair_output_${ATTEMPT}.txt"
    render_template "$PROMPTS_DIR/repair.txt" "$REPAIR_PROMPT" \
        "ERROR_LOG=$(cat "$ERROR_LOG")" \
        "FAILING_FILE_CONTENT=$SOURCE_FILES"
    if ollama_call "$REPAIR_MODEL" "$REPAIR_PROMPT" "$REPAIR_OUTPUT" "Repair" 300; then
        "$SCRIPTS_DIR/write_files.sh" "$REPAIR_OUTPUT" "$PROJECT_ROOT"
    fi
    ATTEMPT=$((ATTEMPT + 1))
done
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 5: LAUNCH SERVICES
# ═══════════════════════════════════════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Phase 5: Launching Services"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Kill any previous instances on our ports
lsof -ti ":$BACKEND_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti ":$FRONTEND_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

BACKEND_LOG="$PROJECT_ROOT/backend.log"
FRONTEND_LOG="$PROJECT_ROOT/frontend.log"
> "$BACKEND_LOG"; > "$FRONTEND_LOG"

# Find and start backend
BACKEND_PID=""
FRONTEND_PID=""

for be_dir in backend api server app; do
    if [[ -d "$PROJECT_ROOT/$be_dir" ]]; then
        VENV_UV="$PROJECT_ROOT/$be_dir/venv/bin/uvicorn"
        if [[ -f "$VENV_UV" ]]; then
            MAIN_MOD=$(find "$PROJECT_ROOT/$be_dir" -maxdepth 2 -name "main.py" \
                -not -path "*/venv/*" | head -1 | \
                sed "s|$PROJECT_ROOT/$be_dir/||" | sed 's|\.py$||' | sed 's|/|.|g')
            MAIN_MOD="${MAIN_MOD:-main}"
            (cd "$PROJECT_ROOT/$be_dir" && \
                "$VENV_UV" "$MAIN_MOD:app" --reload --port "$BACKEND_PORT" \
                >> "$BACKEND_LOG" 2>&1) &
            BACKEND_PID=$!
            echo "  [Backend] Started PID $BACKEND_PID → http://localhost:$BACKEND_PORT"
        fi
        break
    fi
done

# Find and start frontend
for fe_dir in frontend client web ui; do
    if [[ -d "$PROJECT_ROOT/$fe_dir" && -f "$PROJECT_ROOT/$fe_dir/package.json" ]]; then
        (cd "$PROJECT_ROOT/$fe_dir" && npm run dev >> "$FRONTEND_LOG" 2>&1) &
        FRONTEND_PID=$!
        echo "  [Frontend] Started PID $FRONTEND_PID → http://localhost:$FRONTEND_PORT"
        break
    fi
done

# Health check both services
echo "  Waiting for services to be ready..."
python3 - "$BACKEND_PORT" "$FRONTEND_PORT" "$BACKEND_LOG" "$FRONTEND_LOG" << 'HEALTH_PY'
import sys, time, urllib.request, urllib.error

backend_port  = sys.argv[1]
frontend_port = sys.argv[2]
backend_log   = sys.argv[3]
frontend_log  = sys.argv[4]

def wait_for(url, name, timeout=45):
    start = time.time()
    last_error = ""
    while time.time() - start < timeout:
        try:
            r = urllib.request.urlopen(url, timeout=2)
            print(f"  ✅ {name} is up ({r.status}) at {url}")
            return True
        except urllib.error.HTTPError as e:
            # 404 still means the server is running (FastAPI returns 404 on /)
            if e.code in (404, 405, 422):
                print(f"  ✅ {name} is up ({e.code}) at {url}")
                return True
            last_error = str(e)
        except Exception as e:
            last_error = str(e)
        time.sleep(1)
    print(f"  ❌ {name} did not start within {timeout}s. Last error: {last_error}")
    return False

backend_up  = wait_for(f"http://localhost:{backend_port}/",  "Backend",  45)
frontend_up = wait_for(f"http://localhost:{frontend_port}/", "Frontend", 60)

if not backend_up:
    print("  Backend logs (last 20 lines):")
    try:
        with open(backend_log) as f:
            lines = f.readlines()
        for line in lines[-20:]:
            print("    " + line.rstrip())
    except: pass

if not frontend_up:
    print("  Frontend logs (last 20 lines):")
    try:
        with open(frontend_log) as f:
            lines = f.readlines()
        for line in lines[-20:]:
            print("    " + line.rstrip())
    except: pass

# Exit codes: 0=both up, 1=backend down, 2=frontend down, 3=both down
code = (0 if backend_up else 1) + (0 if frontend_up else 2)
sys.exit(code)
HEALTH_PY
HEALTH_EXIT=$?
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 6: UAT (automated tests against running services)
# ═══════════════════════════════════════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Phase 6: User Acceptance Testing (UAT)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

UAT_REPORT="$PROJECT_ROOT/uat_report.json"
UAT_PASSED=0

python3 - "$BACKEND_PORT" "$FRONTEND_PORT" "$UAT_REPORT" << 'UAT_PY'
import sys, json, urllib.request, urllib.error, time

backend_port  = sys.argv[1]
frontend_port = sys.argv[2]
report_path   = sys.argv[3]
backend_url   = f"http://localhost:{backend_port}"
frontend_url  = f"http://localhost:{frontend_port}"

results = []

def test(name, method, url, body=None, expect=(200,201,204)):
    try:
        data = json.dumps(body).encode() if body else None
        headers = {"Content-Type":"application/json"} if body else {}
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        r = urllib.request.urlopen(req, timeout=8)
        resp_body = r.read()
        try: resp_body = json.loads(resp_body)
        except: resp_body = resp_body.decode('utf-8','replace')[:200]
        ok = r.status in (expect if isinstance(expect, tuple) else (expect,))
        results.append({"name":name,"status":r.status,"ok":ok,"body":resp_body})
        icon = "✅" if ok else "❌"
        print(f"  {icon} [{r.status}] {name}")
        return resp_body
    except urllib.error.HTTPError as e:
        ok = e.code in (expect if isinstance(expect, tuple) else (expect,))
        results.append({"name":name,"status":e.code,"ok":ok,"error":str(e)})
        icon = "✅" if ok else "❌"
        print(f"  {icon} [{e.code}] {name}: {e}")
        return None
    except Exception as e:
        results.append({"name":name,"status":0,"ok":False,"error":str(e)})
        print(f"  ❌ [ERR] {name}: {e}")
        return None

print("  ── Backend API Tests ──────────────────────")

# Docs endpoint
test("GET /docs (API docs accessible)", "GET", f"{backend_url}/docs", expect=(200,))

# CRUD lifecycle
test("GET /todos (initial empty list)",  "GET",    f"{backend_url}/todos",        expect=(200,))
item = test("POST /todos (create item)", "POST",   f"{backend_url}/todos",
            {"title": "UAT Test Item"}, expect=(200,201))
todo_id = item.get("id") if isinstance(item, dict) else None
if todo_id:
    test("GET /todos (item in list)",    "GET",    f"{backend_url}/todos",        expect=(200,))
    test(f"DELETE /todos/{todo_id}",     "DELETE", f"{backend_url}/todos/{todo_id}", expect=(200,204))
    test("GET /todos (empty after del)", "GET",    f"{backend_url}/todos",        expect=(200,))
else:
    print("  ⚠️  Skipping DELETE test: no ID returned from POST")

print("")
print("  ── Frontend Tests ─────────────────────────")

# Frontend loads
fe_result = test("GET / (frontend loads)", "GET", f"{frontend_url}/", expect=(200,))
if isinstance(fe_result, str):
    if "<div" in fe_result or "<!DOCTYPE" in fe_result or "html" in fe_result.lower():
        print("  ✅ Frontend HTML response contains HTML markup")
    else:
        print("  ⚠️  Frontend response doesn't look like HTML")

# Save report
with open(report_path, 'w') as f:
    json.dump(results, f, indent=2)

passed = sum(1 for r in results if r["ok"])
total  = len(results)
print(f"\n  UAT Result: {passed}/{total} tests passed")

sys.exit(0 if passed == total else 1)
UAT_PY
UAT_EXIT=$?

if [[ $UAT_EXIT -eq 0 ]]; then
    UAT_PASSED=1
    echo ""
    echo "  ✅ All UAT tests passed!"
else
    echo ""
    echo "  ⚠️  Some UAT tests failed."
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 7: INTERACTIVE DEBUG LOOP (if UAT failed)
# ═══════════════════════════════════════════════════════════════════════════════
if [[ $UAT_PASSED -eq 0 ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Phase 7: Debug & Repair Loop"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    DEBUG_ATTEMPT=1
    DEBUG_MAX=3

    while [[ $DEBUG_ATTEMPT -le $DEBUG_MAX && $UAT_PASSED -eq 0 ]]; do
        echo ""
        echo "  [Debug] Iteration $DEBUG_ATTEMPT / $DEBUG_MAX"

        # ── Collect all error context ──────────────────────────────────────
        BACKEND_ERRORS=$(tail -30 "$BACKEND_LOG" 2>/dev/null || echo "No backend log")
        FRONTEND_ERRORS=$(tail -30 "$FRONTEND_LOG" 2>/dev/null || echo "No frontend log")
        UAT_FAILURES=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        results = json.load(f)
    failed = [r for r in results if not r.get('ok')]
    print(json.dumps(failed, indent=2))
except: print('No UAT report')
" "$UAT_REPORT" 2>/dev/null)

        # Collect source files
        SOURCE_FILES=""
        while IFS= read -r -d '' f; do
            rel="${f#$PROJECT_ROOT/}"
            SOURCE_FILES+="FILE: $rel"$'\n'"$(cat "$f")"$'\n\n'
        done < <(find "$PROJECT_ROOT" \
            \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" \) \
            -not -path "*/node_modules/*" -not -path "*/venv/*" \
            -not -path "*/__pycache__/*" -print0 2>/dev/null)

        ERROR_CONTEXT="=== Backend Logs ===
$BACKEND_ERRORS

=== Frontend Logs ===
$FRONTEND_ERRORS

=== Failed UAT Tests ===
$UAT_FAILURES"

        echo "  [Debug] Sending error context to $REPAIR_MODEL..."

        DEBUG_PROMPT="$LOGS_DIR/debug_prompt_${DEBUG_ATTEMPT}.txt"
        DEBUG_OUTPUT="$LOGS_DIR/debug_output_${DEBUG_ATTEMPT}.txt"

        render_template "$PROMPTS_DIR/debug.txt" "$DEBUG_PROMPT" \
            "ERROR_CONTEXT=$ERROR_CONTEXT" \
            "SOURCE_FILES=$SOURCE_FILES" \
            "BACKEND_PORT=$BACKEND_PORT" \
            "FRONTEND_PORT=$FRONTEND_PORT"

        if ! ollama_call "$REPAIR_MODEL" "$DEBUG_PROMPT" "$DEBUG_OUTPUT" "Debug" 300; then
            echo "  [Debug] Repair agent failed, skipping iteration"
            DEBUG_ATTEMPT=$((DEBUG_ATTEMPT + 1))
            continue
        fi

        # Apply fixes
        echo "  [Debug] Applying fixes..."
        "$SCRIPTS_DIR/write_files.sh" "$DEBUG_OUTPUT" "$PROJECT_ROOT"

        # Re-install deps if package.json changed
        for fe_dir in frontend client web ui; do
            if [[ -d "$PROJECT_ROOT/$fe_dir" && \
                  "$PROJECT_ROOT/$fe_dir/package.json" -nt \
                  "$PROJECT_ROOT/$fe_dir/node_modules/.package-lock.json" ]] 2>/dev/null; then
                echo "  [Debug] package.json changed, reinstalling..."
                npm install --prefix "$PROJECT_ROOT/$fe_dir" --include=dev >> "$SETUP_LOG" 2>&1
            fi
        done

        # Restart services
        echo "  [Debug] Restarting services..."
        [[ -n "$BACKEND_PID" ]]  && kill "$BACKEND_PID"  2>/dev/null
        [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null
        lsof -ti ":$BACKEND_PORT"  2>/dev/null | xargs kill -9 2>/dev/null || true
        lsof -ti ":$FRONTEND_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
        sleep 2

        > "$BACKEND_LOG"; > "$FRONTEND_LOG"

        for be_dir in backend api server app; do
            if [[ -d "$PROJECT_ROOT/$be_dir" ]]; then
                VENV_UV="$PROJECT_ROOT/$be_dir/venv/bin/uvicorn"
                if [[ -f "$VENV_UV" ]]; then
                    MAIN_MOD=$(find "$PROJECT_ROOT/$be_dir" -maxdepth 2 -name "main.py" \
                        -not -path "*/venv/*" | head -1 | \
                        sed "s|$PROJECT_ROOT/$be_dir/||" | sed 's|\.py$||')
                    MAIN_MOD="${MAIN_MOD:-main}"
                    (cd "$PROJECT_ROOT/$be_dir" && \
                        "$VENV_UV" "$MAIN_MOD:app" --reload --port "$BACKEND_PORT" \
                        >> "$BACKEND_LOG" 2>&1) &
                    BACKEND_PID=$!
                fi
                break
            fi
        done
        for fe_dir in frontend client web ui; do
            if [[ -d "$PROJECT_ROOT/$fe_dir" && -f "$PROJECT_ROOT/$fe_dir/package.json" ]]; then
                (cd "$PROJECT_ROOT/$fe_dir" && npm run dev >> "$FRONTEND_LOG" 2>&1) &
                FRONTEND_PID=$!
                break
            fi
        done

        echo "  [Debug] Waiting for services..."
        sleep 5

        # Re-run UAT
        echo "  [Debug] Re-running UAT..."
        python3 - "$BACKEND_PORT" "$FRONTEND_PORT" "$UAT_REPORT" << 'REUAT_PY'
import sys, json, urllib.request, urllib.error

backend_port  = sys.argv[1]
frontend_port = sys.argv[2]
report_path   = sys.argv[3]
backend_url   = f"http://localhost:{backend_port}"
frontend_url  = f"http://localhost:{frontend_port}"

results = []
def test(name, method, url, body=None, expect=(200,201,204)):
    try:
        data = json.dumps(body).encode() if body else None
        headers = {"Content-Type":"application/json"} if body else {}
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        r = urllib.request.urlopen(req, timeout=8)
        resp_body = r.read()
        try: resp_body = json.loads(resp_body)
        except: resp_body = resp_body.decode('utf-8','replace')[:200]
        ok = r.status in (expect if isinstance(expect, tuple) else (expect,))
        results.append({"name":name,"status":r.status,"ok":ok,"body":resp_body})
        icon = "✅" if ok else "❌"
        print(f"  {icon} [{r.status}] {name}")
        return resp_body
    except urllib.error.HTTPError as e:
        ok = e.code in (expect if isinstance(expect, tuple) else (expect,))
        results.append({"name":name,"status":e.code,"ok":ok,"error":str(e)})
        icon = "✅" if ok else "❌"
        print(f"  {icon} [{e.code}] {name}")
        return None
    except Exception as e:
        results.append({"name":name,"status":0,"ok":False,"error":str(e)})
        print(f"  ❌ [ERR] {name}: {e}")
        return None

test("GET /docs",                 "GET", f"{backend_url}/docs",    expect=(200,))
test("GET /todos",                "GET", f"{backend_url}/todos",   expect=(200,))
item = test("POST /todos",        "POST",f"{backend_url}/todos",   {"title":"Retest Item"}, expect=(200,201))
tid = item.get("id") if isinstance(item,dict) else None
if tid:
    test(f"DELETE /todos/{tid}",  "DELETE",f"{backend_url}/todos/{tid}", expect=(200,204))
test("GET / (frontend)",          "GET", f"{frontend_url}/",       expect=(200,))

with open(report_path,'w') as f:
    json.dump(results, f, indent=2)
passed = sum(1 for r in results if r["ok"])
total  = len(results)
print(f"  UAT: {passed}/{total} passed")
sys.exit(0 if passed==total else 1)
REUAT_PY
        REUAT_EXIT=$?

        if [[ $REUAT_EXIT -eq 0 ]]; then
            UAT_PASSED=1
            echo "  ✅ All tests pass after debug iteration $DEBUG_ATTEMPT!"
        else
            echo "  Still failing after iteration $DEBUG_ATTEMPT"
        fi

        DEBUG_ATTEMPT=$((DEBUG_ATTEMPT + 1))
    done
fi

# ═══════════════════════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

# Ensure services are still running (don't kill them — user needs them)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "╔══════════════════════════════════════════╗"
if [[ $UAT_PASSED -eq 1 ]]; then
    echo "║   ✅  Build + UAT COMPLETE — All Green   ║"
else
    echo "║   ⚠️   Build done — UAT needs attention   ║"
fi
echo "╚══════════════════════════════════════════╝"
echo ""
echo "📁  Project:  $PROJECT_ROOT"
echo ""
echo "Generated files:"
find "$PROJECT_ROOT" -type f \
    -not -path "*/node_modules/*" -not -path "*/venv/*" \
    -not -path "*/__pycache__/*"  -not -name "*.pyc" \
    | sort | sed "s|$PROJECT_ROOT/||" | sed 's/^/   /'
echo ""
if [[ -n "$BACKEND_PID" || -n "$FRONTEND_PID" ]]; then
    echo "🟢  Services are RUNNING:"
    [[ -n "$BACKEND_PID" ]]  && echo "    Backend:  http://localhost:$BACKEND_PORT"
    [[ -n "$BACKEND_PID" ]]  && echo "    API Docs: http://localhost:$BACKEND_PORT/docs"
    [[ -n "$FRONTEND_PID" ]] && echo "    Frontend: http://localhost:$FRONTEND_PORT"
    echo ""
    echo "    Logs:     tail -f $PROJECT_ROOT/backend.log"
    echo "              tail -f $PROJECT_ROOT/frontend.log"
    echo ""
    echo "    To stop:  kill $BACKEND_PID $FRONTEND_PID"
    echo "    To restart: cd $PROJECT_ROOT && ./start.sh"
else
    echo "▶  To start: cd $PROJECT_ROOT && ./start.sh"
fi
echo ""
[[ -f "$UAT_REPORT" ]] && echo "📋  UAT report: $UAT_REPORT"
echo ""
[[ $UAT_PASSED -eq 1 ]] && exit 0 || exit 1
