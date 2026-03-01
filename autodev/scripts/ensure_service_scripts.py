#!/usr/bin/env python3
"""
ensure_service_scripts.py
Ensure each generated project has service management bash scripts.
"""
import os
import stat
import sys


def write(path: str, content: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def main():
    if len(sys.argv) < 4:
        print("usage: ensure_service_scripts.py <project_root> <backend_port> <frontend_port>")
        sys.exit(1)

    root, be_port, fe_port = sys.argv[1], sys.argv[2], sys.argv[3]
    scripts_dir = os.path.join(root, "scripts")
    manage = os.path.join(scripts_dir, "manage_services.sh")

    content = f'''#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${{BASH_SOURCE[0]}}")/.." && pwd)"
BE_PORT="${{2:-{be_port}}}"
FE_PORT="${{3:-{fe_port}}}"
PID_FILE="$ROOT/.pids.json"

kill_port() {{
  lsof -ti ":$1" 2>/dev/null | xargs -I{{}} kill -9 {{}} 2>/dev/null || true
}}

find_backend_cmd() {{
  for d in backend api server app; do
    if [[ -d "$ROOT/$d" ]]; then
      if [[ -x "$ROOT/$d/venv/bin/uvicorn" ]]; then
        mod="main"
        [[ -f "$ROOT/$d/app.py" ]] && mod="app"
        [[ -f "$ROOT/$d/server.py" ]] && mod="server"
        echo "$ROOT/$d/venv/bin/uvicorn $mod:app --reload --port $BE_PORT"
        return 0
      fi
      if [[ -f "$ROOT/$d/main.py" || -f "$ROOT/$d/app.py" || -f "$ROOT/$d/server.py" ]]; then
        mod="main"
        [[ -f "$ROOT/$d/app.py" ]] && mod="app"
        [[ -f "$ROOT/$d/server.py" ]] && mod="server"
        echo "python3 -m uvicorn $mod:app --reload --port $BE_PORT"
        return 0
      fi
      if [[ -f "$ROOT/$d/package.json" ]]; then
        if jq -e '.scripts.dev' "$ROOT/$d/package.json" >/dev/null 2>&1; then echo "npm run dev"; return 0; fi
        if jq -e '.scripts.start' "$ROOT/$d/package.json" >/dev/null 2>&1; then echo "npm run start"; return 0; fi
      fi
    fi
  done
  return 1
}}

find_frontend_cmd() {{
  for d in frontend client web ui; do
    if [[ -f "$ROOT/$d/package.json" ]]; then
      if jq -e '.scripts.dev' "$ROOT/$d/package.json" >/dev/null 2>&1; then echo "$d:::npm run dev"; return 0; fi
      if jq -e '.scripts.start' "$ROOT/$d/package.json" >/dev/null 2>&1; then echo "$d:::npm run start"; return 0; fi
      if [[ -f "$ROOT/$d/vite.config.ts" || -f "$ROOT/$d/vite.config.js" ]]; then echo "$d:::npx vite --host 0.0.0.0 --port $FE_PORT"; return 0; fi
    fi
  done
  return 1
}}

start() {{
  stop || true
  kill_port "$BE_PORT"; kill_port "$FE_PORT"
  mkdir -p "$ROOT"
  p_backend=""
  p_frontend=""

  if cmd=$(find_backend_cmd); then
    for d in backend api server app; do [[ -d "$ROOT/$d" ]] && BE_DIR="$ROOT/$d" && break; done
    bash -lc "cd '$BE_DIR' && $cmd" > "$ROOT/backend.log" 2>&1 &
    p_backend=$!
  fi

  if pair=$(find_frontend_cmd); then
    FE_DIR="$ROOT/${{pair%%:::*}}"
    FE_CMD="${{pair#*:::}}"
    bash -lc "cd '$FE_DIR' && $FE_CMD" > "$ROOT/frontend.log" 2>&1 &
    p_frontend=$!
  fi

  printf '{{"backend": %s, "frontend": %s}}\n' "${{p_backend:-null}}" "${{p_frontend:-null}}" > "$PID_FILE"
  cat "$PID_FILE"

  [[ -n "$p_backend" && -n "$p_frontend" ]]
}}

stop() {{
  [[ -f "$PID_FILE" ]] || return 0
  b=$(jq -r '.backend // empty' "$PID_FILE" 2>/dev/null || true)
  f=$(jq -r '.frontend // empty' "$PID_FILE" 2>/dev/null || true)
  [[ -n "$b" ]] && kill -TERM "$b" 2>/dev/null || true
  [[ -n "$f" ]] && kill -TERM "$f" 2>/dev/null || true
  kill_port "$BE_PORT"; kill_port "$FE_PORT"
  rm -f "$PID_FILE"
}}

status() {{
  [[ -f "$PID_FILE" ]] || {{ echo '{{}}'; return 1; }}
  cat "$PID_FILE"
}}

case "${{1:-status}}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  *) echo "usage: $0 <start|stop|restart|status> [backend_port] [frontend_port]"; exit 1 ;;
esac
'''

    write(manage, content)
    write(os.path.join(root, "start.sh"), f"#!/usr/bin/env bash\nbash scripts/manage_services.sh start {be_port} {fe_port}\n")
    write(os.path.join(root, "stop.sh"), f"#!/usr/bin/env bash\nbash scripts/manage_services.sh stop {be_port} {fe_port}\n")
    write(os.path.join(root, "restart.sh"), f"#!/usr/bin/env bash\nbash scripts/manage_services.sh restart {be_port} {fe_port}\n")
    print(manage)


if __name__ == "__main__":
    main()
