#!/usr/bin/env python3
"""
lessons_analyzer.py
Analyze collected phase lessons with Ollama and produce versioned guidance + compact runtime pack.
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


def ollama_generate(ollama_api: str, model: str, prompt: str, max_predict: int = 1200):
    payload = json.dumps(
        {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.1, "num_ctx": 8192, "num_predict": max_predict},
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


def next_version(versions_dir: str, suffix: str):
    os.makedirs(versions_dir, exist_ok=True)
    nums = []
    pat = re.compile(rf"lessons_{suffix}_v(\d+)\.(md|json)$")
    for f in os.listdir(versions_dir):
        m = pat.match(f)
        if m:
            nums.append(int(m.group(1)))
    return (max(nums) + 1) if nums else 1


def extract_json(text: str):
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass

    for pat in [r"```json\s*([\s\S]*?)```", r"```\s*([\s\S]*?)```", r"(\{[\s\S]*\})"]:
        m = re.search(pat, text)
        if not m:
            continue
        block = m.group(1).strip()
        try:
            return json.loads(block)
        except Exception:
            continue
    return None


def fallback_compact(rows):
    compact = {
        "version_summary": "Fallback compact guidance generated locally.",
        "global": [
            "Always verify generated package scripts before launch.",
            "Use strict contract-route matching for backend/frontend integration.",
            "Capture and fix first failing root cause before broad refactors.",
        ],
        "phases": {},
    }
    for p in range(1, 9):
        recent = [r for r in rows if int(r.get("phase", 0)) == p][-5:]
        bullets = []
        for r in recent:
            s = str(r.get("summary", "")).strip()
            if s:
                bullets.append(s[:180])
        compact["phases"][str(p)] = bullets[:4] if bullets else ["Run standard checks and fail-fast on first concrete error."]
    return compact


def main():
    if len(sys.argv) < 4:
        print("usage: lessons_analyzer.py <lessons_dir> <model> <ollama_api>")
        sys.exit(1)

    lessons_dir, model, ollama_api = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(lessons_dir, exist_ok=True)
    lock_path = os.path.join(lessons_dir, ".analyzer.lock")

    if os.path.exists(lock_path):
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

        recent = rows[-140:]
        compact_rows = "\n".join(
            [f"- phase={r.get('phase')} [{r.get('status','?')}] {str(r.get('summary',''))[:240]}" for r in recent]
        )

        # 1) Human-readable playbook
        playbook_prompt = f"""
You are a principal full-stack engineer and software architect.
Analyze historical build lessons and produce actionable, versioned operating guidance.

Lessons:
{compact_rows}

Output markdown with sections:
1) # AutoDev Lessons Playbook
2) ## Version Summary
3) ## Cross-Phase Guardrails (8-12 bullets)
4) ## Per-Phase Guidance (Phase 1..8 each with 2-5 bullets)
5) ## Priority Fix Patterns
6) ## Prompt Additions To Enforce

Rules: concrete, preventive, no fluff.
"""
        playbook = ollama_generate(ollama_api, model, playbook_prompt, 1400)

        # 2) Compact runtime pack (token saver)
        compact_prompt = f"""
You are producing a token-optimized runtime checklist for an autonomous full-stack builder.

Lessons:
{compact_rows}

Return ONLY strict JSON with this schema:
{{
  "version_summary": "string <= 160 chars",
  "global": ["3-6 short bullets, each <= 120 chars"],
  "phases": {{
    "1": ["2-5 short bullets <= 120 chars"],
    "2": [],
    "3": [],
    "4": [],
    "5": [],
    "6": [],
    "7": [],
    "8": []
  }}
}}

Constraints:
- Keep concise for prompt injection budget.
- Focus on common warnings/errors/failures and prevention.
- No markdown.
"""
        compact_text = ollama_generate(ollama_api, model, compact_prompt, 900)
        compact_json = extract_json(compact_text) or fallback_compact(rows)

        versions_dir = os.path.join(lessons_dir, "versions")
        os.makedirs(versions_dir, exist_ok=True)

        v_play = next_version(versions_dir, "playbook")
        play_path = os.path.join(versions_dir, f"lessons_playbook_v{v_play}.md")
        with open(play_path, "w", encoding="utf-8") as f:
            f.write((playbook or "# AutoDev Lessons Playbook\n\nNo output").strip() + "\n")

        v_compact = next_version(versions_dir, "compact")
        compact_path = os.path.join(versions_dir, f"lessons_compact_v{v_compact}.json")
        with open(compact_path, "w", encoding="utf-8") as f:
            json.dump(compact_json, f, indent=2, ensure_ascii=False)

        with open(os.path.join(lessons_dir, "latest.md"), "w", encoding="utf-8") as f:
            f.write((playbook or "# AutoDev Lessons Playbook\n\nNo output").strip() + "\n")
        with open(os.path.join(lessons_dir, "latest_compact.json"), "w", encoding="utf-8") as f:
            json.dump(compact_json, f, indent=2, ensure_ascii=False)

        meta = {
            "playbook_version": v_play,
            "compact_version": v_compact,
            "model": model,
            "generated_at": int(time.time()),
            "playbook_path": play_path,
            "compact_path": compact_path,
        }
        with open(os.path.join(lessons_dir, "latest.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

        print(f"wrote {play_path} and {compact_path}")
    finally:
        try:
            os.remove(lock_path)
        except Exception:
            pass


if __name__ == "__main__":
    main()
