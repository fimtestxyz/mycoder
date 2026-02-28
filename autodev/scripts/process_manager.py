#!/usr/bin/env python3
"""
process_manager.py - Reliable service lifecycle: start, stop, check, restart.
Usage: python3 process_manager.py <command> <project_root> [backend_port] [frontend_port]
Commands: start | stop | status | restart
"""
import sys, os, json, signal, time, subprocess

PID_FILE = None  # set per project

def get_pid_file(project_root):
    return os.path.join(project_root, ".pids.json")

def read_pids(project_root):
    pf = get_pid_file(project_root)
    if os.path.exists(pf):
        try:
            return json.load(open(pf))
        except: pass
    return {}

def write_pids(project_root, pids):
    with open(get_pid_file(project_root), "w") as f:
        json.dump(pids, f)

def is_running(pid):
    if not pid: return False
    try:
        os.kill(int(pid), 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False

def kill_port(port):
    """Kill any process using the given port"""
    try:
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"], capture_output=True, text=True
        )
        for pid_str in result.stdout.strip().split("\n"):
            if pid_str.strip():
                try:
                    os.kill(int(pid_str.strip()), signal.SIGKILL)
                except: pass
    except: pass
    time.sleep(0.5)

def start_services(project_root, backend_port, frontend_port):
    pids = read_pids(project_root)

    # Stop existing if running
    for svc, pid in pids.items():
        if is_running(pid):
            print(f"  [PM] Stopping existing {svc} (PID {pid})")
            try: os.kill(int(pid), signal.SIGTERM)
            except: pass
    kill_port(backend_port)
    kill_port(frontend_port)
    time.sleep(1)

    new_pids = {}
    logs = {}

    # ── Backend ───────────────────────────────────────────────────────────────
    for be_dir in ["backend", "api", "server", "app"]:
        be_path = os.path.join(project_root, be_dir)
        if not os.path.isdir(be_path): continue
        venv_uv = os.path.join(be_path, "venv", "bin", "uvicorn")
        if not os.path.exists(venv_uv): continue

        main_mod = "main"
        for f in ["main.py", "app.py", "server.py"]:
            if os.path.exists(os.path.join(be_path, f)):
                main_mod = f.replace(".py", "")
                break

        log_path = os.path.join(project_root, "backend.log")
        logs["backend"] = log_path
        with open(log_path, "w") as lf:
            proc = subprocess.Popen(
                [venv_uv, f"{main_mod}:app", "--reload", "--port", str(backend_port)],
                cwd=be_path, stdout=lf, stderr=subprocess.STDOUT,
                start_new_session=True
            )
        new_pids["backend"] = proc.pid
        print(f"  [PM] Backend started PID={proc.pid} → http://localhost:{backend_port}")
        print(f"  [PM] Log: {log_path}")
        break

    # ── Frontend ──────────────────────────────────────────────────────────────
    for fe_dir in ["frontend", "client", "web", "ui"]:
        fe_path = os.path.join(project_root, fe_dir)
        if not os.path.isdir(fe_path): continue
        if not os.path.exists(os.path.join(fe_path, "package.json")): continue

        log_path = os.path.join(project_root, "frontend.log")
        logs["frontend"] = log_path
        with open(log_path, "w") as lf:
            proc = subprocess.Popen(
                ["npm", "run", "dev"],
                cwd=fe_path, stdout=lf, stderr=subprocess.STDOUT,
                start_new_session=True
            )
        new_pids["frontend"] = proc.pid
        print(f"  [PM] Frontend started PID={proc.pid} → http://localhost:{frontend_port}")
        print(f"  [PM] Log: {log_path}")
        break

    write_pids(project_root, new_pids)
    return new_pids, logs

def stop_services(project_root, backend_port, frontend_port):
    pids = read_pids(project_root)
    for svc, pid in pids.items():
        if is_running(pid):
            try:
                os.killpg(os.getpgid(int(pid)), signal.SIGTERM)
                print(f"  [PM] Stopped {svc} PID={pid}")
            except:
                try: os.kill(int(pid), signal.SIGKILL)
                except: pass
    kill_port(backend_port)
    kill_port(frontend_port)
    if os.path.exists(get_pid_file(project_root)):
        os.remove(get_pid_file(project_root))
    print("  [PM] All services stopped")

def status(project_root):
    pids = read_pids(project_root)
    if not pids:
        print("  [PM] No services tracked")
        return False
    all_up = True
    for svc, pid in pids.items():
        up = is_running(pid)
        print(f"  [PM] {svc}: {'🟢 running' if up else '🔴 stopped'} (PID {pid})")
        if not up: all_up = False
    return all_up

if __name__ == "__main__":
    cmd          = sys.argv[1] if len(sys.argv) > 1 else "status"
    project_root = sys.argv[2] if len(sys.argv) > 2 else "."
    be_port      = sys.argv[3] if len(sys.argv) > 3 else "8000"
    fe_port      = sys.argv[4] if len(sys.argv) > 4 else "5173"

    if cmd == "start":
        pids, logs = start_services(project_root, be_port, fe_port)
        print(json.dumps(pids))
    elif cmd == "stop":
        stop_services(project_root, be_port, fe_port)
    elif cmd == "restart":
        stop_services(project_root, be_port, fe_port)
        time.sleep(2)
        pids, logs = start_services(project_root, be_port, fe_port)
        print(json.dumps(pids))
    elif cmd == "status":
        sys.exit(0 if status(project_root) else 1)
