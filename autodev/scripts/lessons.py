#!/usr/bin/env python3
"""
lessons.py - Persist and recall phase lessons.

Usage:
  python3 lessons.py record <lessons_dir> <phase_num> <phase_name> <status> <summary>
  python3 lessons.py remind <lessons_dir> <phase_num> <phase_name> <task> <model> [ollama_api]
"""

import json
import os
import re
import sys
import urllib.request


def phase_paths(lessons_dir: str, phase_num: str):
    os.makedirs(lessons_dir, exist_ok=True)
    return (
        os.path.join(lessons_dir, f"phase_{phase_num}.jsonl"),
        os.path.join(lessons_dir, f"phase_{phase_num}.md"),
    )


def read_recent(jsonl_path: str, limit: int = 12):
    if not os.path.exists(jsonl_path):
        return []
    rows = []
    with open(jsonl_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
    return rows[-limit:]


def record(lessons_dir: str, phase_num: str, phase_name: str, status: str, summary: str):
    jsonl_path, md_path = phase_paths(lessons_dir, phase_num)
    item = {
        "phase": int(phase_num),
        "phase_name": phase_name,
        "status": status,
        "summary": summary,
    }

    with open(jsonl_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(item, ensure_ascii=False) + "\n")

    # Keep markdown human-readable log too
    heading = f"# Lessons - Phase {phase_num}: {phase_name}\n\n"
    if not os.path.exists(md_path):
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(heading)

    with open(md_path, "a", encoding="utf-8") as f:
        f.write(f"- [{status.upper()}] {summary}\n")


def ollama_generate(model: str, prompt: str, ollama_api: str):
    payload = json.dumps(
        {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.1, "num_ctx": 4096, "num_predict": 220},
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        f"{ollama_api.rstrip('/')}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=35) as r:
        obj = json.loads(r.read().decode("utf-8", "ignore"))
        return obj.get("response", "").strip()


def fallback_bullets(items, phase_name):
    bad = [i.get("summary", "") for i in items if i.get("status") in ("error", "failed", "warn")]
    if not bad:
        return f"No major historical failures found for {phase_name}. Continue with standard checks."
    bullets = "\n".join([f"- {b}" for b in bad[-3:]])
    return f"Avoid these known issues in {phase_name}:\n{bullets}"


def remind(lessons_dir: str, phase_num: str, phase_name: str, task: str, model: str, ollama_api: str):
    jsonl_path, _ = phase_paths(lessons_dir, phase_num)
    items = read_recent(jsonl_path, limit=12)
    if not items:
        print(f"No prior lessons for Phase {phase_num} ({phase_name}).")
        return

    short = "\n".join(
        [f"- [{x.get('status','?')}] {x.get('summary','')[:220]}" for x in items[-8:]]
    )

    prompt = f"""You are a strict engineering reviewer.
Task: {task}
Current phase: {phase_num} - {phase_name}
Recent lessons:
{short}

Return concise execution reminders to avoid repeating mistakes.
Output 4-6 bullet points only. No intro.
"""

    try:
        text = ollama_generate(model, prompt, ollama_api)
        # normalize if model adds noise
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        lines = [ln if ln.startswith("-") else f"- {re.sub(r'^\d+[\.)]\s*', '', ln)}" for ln in lines][:6]
        print("\n".join(lines) if lines else fallback_bullets(items, phase_name))
    except Exception:
        print(fallback_bullets(items, phase_name))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: lessons.py <record|remind> ...")
        sys.exit(1)

    mode = sys.argv[1]
    if mode == "record":
        if len(sys.argv) < 7:
            sys.exit(1)
        _, _, lessons_dir, phase_num, phase_name, status, summary = sys.argv[:7]
        record(lessons_dir, phase_num, phase_name, status, summary)
        sys.exit(0)

    if mode == "remind":
        if len(sys.argv) < 7:
            sys.exit(1)
        _, _, lessons_dir, phase_num, phase_name, task, model, *rest = sys.argv
        ollama_api = rest[0] if rest else "http://localhost:11434"
        remind(lessons_dir, phase_num, phase_name, task, model, ollama_api)
        sys.exit(0)

    sys.exit(1)
