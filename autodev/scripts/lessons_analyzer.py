#!/usr/bin/env python3
"""
lessons_analyzer.py
Analyze collected phase lessons with Ollama and produce versioned guidance.
"""

import json
import os
import re
import sys
import time
import urllib.request


def read_phase_lines(lessons_dir: str):
    rows = []
    for name in sorted(os.listdir(lessons_dir)):
        if not re.match(r"phase_\d+\.jsonl$", name):
            continue
        path = os.path.join(lessons_dir, name)
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                        rows.append(obj)
                    except Exception:
                        pass
        except Exception:
            pass
    return rows


def ollama_generate(ollama_api: str, model: str, prompt: str):
    payload = json.dumps(
        {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.1, "num_ctx": 8192, "num_predict": 1200},
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        f"{ollama_api.rstrip('/')}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=120) as r:
        obj = json.loads(r.read().decode("utf-8", "ignore"))
        return obj.get("response", "").strip()


def next_version(versions_dir: str):
    os.makedirs(versions_dir, exist_ok=True)
    nums = []
    for f in os.listdir(versions_dir):
        m = re.match(r"lessons_v(\d+)\.md$", f)
        if m:
            nums.append(int(m.group(1)))
    return (max(nums) + 1) if nums else 1


def main():
    if len(sys.argv) < 4:
        print("usage: lessons_analyzer.py <lessons_dir> <model> <ollama_api>")
        sys.exit(1)

    lessons_dir, model, ollama_api = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(lessons_dir, exist_ok=True)
    lock_path = os.path.join(lessons_dir, ".analyzer.lock")

    if os.path.exists(lock_path):
        # lock younger than 30 min -> skip
        if time.time() - os.path.getmtime(lock_path) < 1800:
            print("analyzer busy")
            return

    with open(lock_path, "w") as f:
        f.write(str(time.time()))

    try:
        rows = read_phase_lines(lessons_dir)
        if not rows:
            print("no lessons")
            return

        recent = rows[-120:]
        compact = "\n".join(
            [
                f"- phase={r.get('phase')} [{r.get('status','?')}] {str(r.get('summary',''))[:240]}"
                for r in recent
            ]
        )

        prompt = f"""
You are a principal full-stack engineer and software architect.
Analyze these historical build lessons and produce actionable, versioned operating guidance.

Lessons:
{compact}

Output in markdown with sections:
1) # AutoDev Lessons Playbook
2) ## Version Summary
3) ## Cross-Phase Guardrails (8-12 bullets)
4) ## Per-Phase Guidance (Phase 1..8 each with 2-5 bullets)
5) ## Priority Fix Patterns (top recurring failures + prevention)
6) ## Prompt Additions To Enforce (short snippets)

Rules:
- Be concrete and preventive.
- Focus on warnings/errors/failures root causes.
- No fluff.
"""

        analysis = ollama_generate(ollama_api, model, prompt)
        if not analysis:
            print("empty analysis")
            return

        versions_dir = os.path.join(lessons_dir, "versions")
        v = next_version(versions_dir)
        out_path = os.path.join(versions_dir, f"lessons_v{v}.md")
        latest_path = os.path.join(lessons_dir, "latest.md")
        meta_path = os.path.join(lessons_dir, "latest.json")

        with open(out_path, "w", encoding="utf-8") as f:
            f.write(analysis.strip() + "\n")
        with open(latest_path, "w", encoding="utf-8") as f:
            f.write(analysis.strip() + "\n")
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump({"version": v, "model": model, "generated_at": int(time.time()), "path": out_path}, f, indent=2)

        print(f"wrote {out_path}")
    finally:
        try:
            os.remove(lock_path)
        except Exception:
            pass


if __name__ == "__main__":
    main()
