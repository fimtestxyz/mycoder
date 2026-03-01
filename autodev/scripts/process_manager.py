#!/usr/bin/env python3
"""
process_manager.py - Reliable service lifecycle: start, stop, check, restart.
Usage: python3 process_manager.py <command> <project_root> [backend_port] [frontend_port]
Commands: start | stop | status | restart
"""
import sys, os, json, signal, time, subprocess


def get_pid_file(project_root):
    return os.path.join(project_root, ".pids.json")


def read_pids(project_root):
    pf = get_pid_file(project_root)
    if os.path.exists(pf):
        try:
            return json.load(open(pf))
        except Exception:
            pass
    return {}


def write_pids(project_root, pids):
    with open(get_pid_file(project_root), "w") as f:
        json.dump(pids, f)


def is_running(pid):
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def kill_port(port):
    try:
        result = subprocess.run(["lsof", "-ti", f":{port}"], capture_output=True, text=True)
        for pid_str in result.stdout.strip().split("\n"):
            if pid_str.strip():
                try:
                    os.kill(int(pid_str.strip()), signal.SIGKILL)
                except Exception:
                    pass
    except Exception:
        pass
    time.sleep(0.5)


def _spawn(cmd, cwd, log_path):
    with open(log_path, "w") as lf:
        proc = subprocess.Popen(cmd, cwd=cwd, stdout=lf, stderr=subprocess.STDOUT, start_new_session=True)
    return proc


def _frontend_cmd(fe_path):
    pkg = os.path.join(fe_path, "package.json")
    if not os.path.exists(pkg):
        return None
    try:
        data = json.load(open(pkg))
    except Exception:
        return ["npm", "run", "dev"]

    scripts = data.get("scripts", {})
    if "dev" in scripts:
        return ["npm", "run", "dev"]
    if "start" in scripts:
        return ["npm", "run", "start"]

    # fallback for Vite-ish projects even when script missing
    if os.path.exists(os.path.join(fe_path, "vite.config.ts")) or os.path.exists(os.path.join(fe_path, "vite.config.js")):
        return ["npx", "vite", "--host", "0.0.0.0"]

    return None


def _backend_cmd(be_path, backend_port):
    # 1) venv uvicorn path
    venv_uv = os.path.join(be_path, "venv", "bin", "uvicorn")
    if os.path.exists(venv_uv):
        main_mod = "main"
        for f in ["main.py", "app.py", "server.py"]:
            if os.path.exists(os.path.join(be_path, f)):
                main_mod = f.replace(".py", "")
                break
        return [venv_uv, f"{main_mod}:app", "--reload", "--port", str(backend_port)]

    # 2) requirements with python -m uvicorn
    has_py = any(os.path.exists(os.path.join(be_path, x)) for x in ["main.py", "app.py", "server.py"])
    if has_py:
        main_mod = "main"
        for f in ["main.py", "app.py", "server.py"]:
            if os.path.exists(os.path.join(be_path, f)):
                main_mod = f.replace(".py", "")
                break
        return ["python3", "-m", "uvicorn", f"{main_mod}:app", "--reload", "--port", str(backend_port)]

    # 3) Node backend support
    pkg = os.path.join(be_path, "package.json")
    if os.path.exists(pkg):
        try:
            data = json.load(open(pkg))
            scripts = data.get("scripts", {})
            if "dev" in scripts:
                return ["npm", "run", "dev"]
            if "start" in scripts:
                return ["npm", "run", "start"]
        except Exception:
            return ["npm", "run", "dev"]

    return None


def start_services(project_root, backend_port, frontend_port):
    pids = read_pids(project_root)

    for svc, pid in pids.items():
        if is_running(pid):
            print(f"  [PM] Stopping existing {svc} (PID {pid})")
            try:
                os.kill(int(pid), signal.SIGTERM)
            except Exception:
                pass

    kill_port(backend_port)
    kill_port(frontend_port)
    time.sleep(1)

    new_pids = {}

    # Backend
    for be_dir in ["backend", "api", "server", "app"]:
        be_path = os.path.join(project_root, be_dir)
        if not os.path.isdir(be_path):
            continue

        cmd = _backend_cmd(be_path, backend_port)
        if not cmd:
            continue

        log_path = os.path.join(project_root, "backend.log")
        proc = _spawn(cmd, be_path, log_path)
        new_pids["backend"] = proc.pid
        print(f"  [PM] Backend started PID={proc.pid} → http://localhost:{backend_port}")
        print(f"  [PM] Backend cmd: {' '.join(cmd)}")
        print(f"  [PM] Log: {log_path}")
        break

    # Frontend
    for fe_dir in ["frontend", "client", "web", "ui"]:
        fe_path = os.path.join(project_root, fe_dir)
        if not os.path.isdir(fe_path):
            continue

        cmd = _frontend_cmd(fe_path)
        if not cmd:
            continue

        log_path = os.path.join(project_root, "frontend.log")
        proc = _spawn(cmd, fe_path, log_path)
        new_pids["frontend"] = proc.pid
        print(f"  [PM] Frontend started PID={proc.pid} → http://localhost:{frontend_port}")
        print(f"  [PM] Frontend cmd: {' '.join(cmd)}")
        print(f"  [PM] Log: {log_path}")
        break

    if "backend" not in new_pids:
        print("  [PM] WARNING: backend startup command not found (missing app files/scripts)")
    if "frontend" not in new_pids:
        print("  [PM] WARNING: frontend startup command not found (missing package.json scripts)")

    write_pids(project_root, new_pids)
    return new_pids


def stop_services(project_root, backend_port, frontend_port):
    pids = read_pids(project_root)
    for svc, pid in pids.items():
        if is_running(pid):
            try:
                os.killpg(os.getpgid(int(pid)), signal.SIGTERM)
                print(f"  [PM] Stopped {svc} PID={pid}")
            except Exception:
                try:
                    os.kill(int(pid), signal.SIGKILL)
                except Exception:
                    pass

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
        if not up:
            all_up = False
    return all_up


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    project_root = sys.argv[2] if len(sys.argv) > 2 else "."
    be_port = sys.argv[3] if len(sys.argv) > 3 else "8000"
    fe_port = sys.argv[4] if len(sys.argv) > 4 else "5173"

    if cmd == "start":
        pids = start_services(project_root, be_port, fe_port)
        print(json.dumps(pids))
        sys.exit(0 if ("backend" in pids and "frontend" in pids) else 1)
    elif cmd == "stop":
        stop_services(project_root, be_port, fe_port)
    elif cmd == "restart":
        stop_services(project_root, be_port, fe_port)
        time.sleep(2)
        pids = start_services(project_root, be_port, fe_port)
        print(json.dumps(pids))
        sys.exit(0 if ("backend" in pids and "frontend" in pids) else 1)
    elif cmd == "status":
        sys.exit(0 if status(project_root) else 1)
