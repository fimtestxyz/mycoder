#!/usr/bin/env python3
"""
fix_node_deps.py
Remove or flag invalid npm packages (404) from package.json, then print what changed.
Usage: python3 fix_node_deps.py <frontend_dir>
"""
import json
import os
import subprocess
import sys


def exists_on_npm(pkg: str) -> bool:
    try:
        r = subprocess.run(["npm", "view", pkg, "version"], capture_output=True, text=True, timeout=20)
        return r.returncode == 0 and bool(r.stdout.strip())
    except Exception:
        return True  # don't destroy deps on network/tooling errors


def main():
    if len(sys.argv) < 2:
        sys.exit(1)

    d = sys.argv[1]
    p = os.path.join(d, "package.json")
    if not os.path.exists(p):
        print("no-package-json")
        return

    data = json.load(open(p, "r", encoding="utf-8"))
    changed = []

    for section in ("dependencies", "devDependencies"):
        deps = data.get(section, {}) or {}
        for name in list(deps.keys()):
            if not exists_on_npm(name):
                changed.append((section, name))
                deps.pop(name, None)
        data[section] = deps

    if changed:
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        lock = os.path.join(d, "package-lock.json")
        if os.path.exists(lock):
            os.remove(lock)
        print("removed:", ", ".join([f"{s}:{n}" for s, n in changed]))
    else:
        print("no-invalid-packages")


if __name__ == "__main__":
    main()
