#!/usr/bin/env python3
"""
validate_written_files.py - Scan newly written files for fence contamination
and syntax errors. Run immediately after write_files.sh.
Fixes fences in-place if found. Returns list of files with errors.
Usage: python3 validate_written_files.py <project_root>
"""
import sys, os, re, ast, json

def strip_fences(content):
    """Remove any markdown fences from file content."""
    s = content.strip()
    if not s or '```' not in s:
        return content
    first_fence = s.find('```')
    if 0 < first_fence:
        pre = s[:first_fence]
        if pre.count('\n') <= 2:
            s = s[first_fence:]
    if s.startswith('```'):
        newline = s.find('\n')
        if newline >= 0:
            s = s[newline + 1:]
        close = re.search(r'\n```', s)
        if close:
            s = s[:close.start()]
    return s.rstrip('\n') + '\n'

def run(project_root):
    errors = []
    fixed  = []

    def scan(path, rel):
        content = open(path, errors='replace').read()

        # ── Check for fence contamination ─────────────────────────────────
        if '```' in content:
            cleaned = strip_fences(content)
            if '```' not in cleaned:
                with open(path, 'w') as f:
                    f.write(cleaned)
                fixed.append(rel)
                print(f"  🔧 Fixed fence: {rel}")
                content = cleaned
            else:
                errors.append({"file": rel, "type": "FENCE", "detail": "still contains ``` after strip"})
                print(f"  ❌ Fence remains: {rel}")
                return

        # ── Syntax check Python files ─────────────────────────────────────
        if path.endswith('.py'):
            import subprocess
            result = subprocess.run(
                ["python3", "-m", "py_compile", path],
                capture_output=True, text=True
            )
            if result.returncode != 0:
                msg = result.stderr.strip().replace(path, rel)
                errors.append({"file": rel, "type": "SYNTAX", "detail": msg})
                print(f"  ❌ Syntax: {rel}: {msg.split(chr(10))[0]}")
                return
            print(f"  ✅ {rel}")

        # ── Validate JSON files ───────────────────────────────────────────
        elif path.endswith('.json') and 'package' in path:
            try:
                json.loads(content)
                print(f"  ✅ {rel}")
            except json.JSONDecodeError as e:
                errors.append({"file": rel, "type": "INVALID_JSON", "detail": str(e)})
                print(f"  ❌ JSON: {rel}: {e}")
        else:
            print(f"  ✅ {rel}")

    EXCLUDE = ('node_modules', 'venv', '__pycache__', '.next', 'dist', 'build')
    for root, dirs, files in os.walk(project_root):
        dirs[:] = [d for d in dirs if d not in EXCLUDE]
        for fname in files:
            if fname.endswith(('.py', '.ts', '.tsx', '.json', '.html', '.js')):
                full = os.path.join(root, fname)
                rel  = os.path.relpath(full, project_root)
                try:
                    scan(full, rel)
                except Exception as e:
                    errors.append({"file": rel, "type": "READ_ERROR", "detail": str(e)})

    if fixed:
        print(f"\n  🔧 Auto-fixed {len(fixed)} files with fence contamination: {fixed}")
    if errors:
        print(f"\n  ❌ {len(errors)} file(s) still have errors after fixing:")
        for e in errors:
            print(f"     [{e['type']}] {e['file']}: {e['detail'][:100]}")
    else:
        print(f"\n  ✅ All files clean")

    return errors, fixed

if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    errors, fixed = run(root)
    sys.exit(0 if not errors else 1)
