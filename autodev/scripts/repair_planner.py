#!/usr/bin/env python3
"""
repair_planner.py - Turn structured UAT failures into targeted repair instructions.
Reads uat_report.json + project files → outputs surgical repair context for the LLM.
Usage: python3 repair_planner.py <report.json> <project_root> <output_context.txt>
"""
import sys, json, os, re

def plan_repair(report_path, project_root, out_path):
    with open(report_path) as f:
        report = json.load(f)

    failures  = report.get("failures", [])
    categories = {f["category"] for f in failures}

    # Map categories → which files to send to repair agent
    file_map = {
        "SYNTAX":         ["backend/main.py", "backend/app.py"],
        "MISSING_DEP":    ["frontend/package.json", "frontend/vite.config.ts"],
        "SERVICE_DOWN":   ["backend/main.py", "backend/requirements.txt"],
        "WRONG_ROUTE":    ["backend/main.py"],
        "CORS":           ["backend/main.py"],
        "SCHEMA_MISMATCH":["backend/main.py"],
        "SERVER_ERROR":   ["backend/main.py"],
        "LOGIC":          ["backend/main.py"],
        "FRONTEND_CONTENT":["frontend/src/App.tsx", "frontend/vite.config.ts"],
    }

    # Collect only the relevant source files
    files_to_fix = set()
    for cat in categories:
        files_to_fix.update(file_map.get(cat, []))

    # Find actual files (try both named paths and discovered paths)
    file_contents = {}
    for rel_path in files_to_fix:
        full_path = os.path.join(project_root, rel_path)
        if os.path.exists(full_path):
            try:
                file_contents[rel_path] = open(full_path).read()
            except: pass
        else:
            # Try searching for the file
            fname = os.path.basename(rel_path)
            for root, dirs, files in os.walk(project_root):
                dirs[:] = [d for d in dirs if d not in ("venv","node_modules","__pycache__")]
                if fname in files:
                    rel = os.path.relpath(os.path.join(root,fname), project_root)
                    try:
                        file_contents[rel] = open(os.path.join(root,fname)).read()
                    except: pass
                    break

    # Build structured repair prompt section
    lines = [
        "=== REPAIR INSTRUCTIONS ===",
        "",
        f"UAT Result: {report['passed']}/{report['total']} tests passed",
        f"Failure categories: {list(categories)}",
        "",
        "=== FAILED TESTS (what was expected vs what happened) ===",
    ]
    for f in failures:
        lines += [
            f"",
            f"TEST: {f['test']}",
            f"CATEGORY: {f['category']}",
            f"EXPECTED: {json.dumps(f.get('expected',''))}",
            f"ACTUAL:   {f.get('actual','')}",
        ]

    lines += ["", "=== SPECIFIC FIX GUIDANCE ==="]
    for cat in sorted(categories):
        if cat == "MISSING_DEP":
            # Extract the specific missing package from error
            missing_pkg = next((
                re.search(r"'([^']+)'|\"([^\"]+)\"", f.get("actual","")).group(1)
                for f in failures if f["category"] == "MISSING_DEP"
                if re.search(r"'([^']+)'|\"([^\"]+)\"", f.get("actual",""))
            ), "@vitejs/plugin-react")
            lines += [f"• MISSING_DEP: Add '{missing_pkg}' to devDependencies in package.json"]
        elif cat == "SERVICE_DOWN":
            lines += ["• SERVICE_DOWN: Check imports in main.py, ensure all packages in requirements.txt are importable"]
        elif cat == "CORS":
            lines += ["• CORS: Add CORSMiddleware with allow_origins=[\"http://localhost:5173\"]"]
        elif cat == "SCHEMA_MISMATCH":
            lines += ["• SCHEMA_MISMATCH: Fix Pydantic request/response model field names and types"]
        elif cat == "WRONG_ROUTE":
            lines += ["• WRONG_ROUTE: Check route path strings match what frontend calls"]
        elif cat == "LOGIC":
            lines += ["• LOGIC: Fix the response body to include all required fields"]
        elif cat == "SYNTAX":
            lines += ["• SYNTAX: Fix the Python syntax error shown in the logs"]
        elif cat == "FRONTEND_CONTENT":
            lines += ["• FRONTEND_CONTENT: Ensure index.html has <div id='root'> and App.tsx renders content"]

    lines += ["", "=== FILES TO FIX (complete file content required) ==="]
    for rel_path, content in file_contents.items():
        lines += ["", f"FILE: {rel_path}", content]

    output = "\n".join(lines)
    with open(out_path, "w") as f:
        f.write(output)

    print(f"  [RepairPlan] {len(failures)} failures → {len(file_contents)} files targeted")
    print(f"  [RepairPlan] Categories: {list(categories)}")
    return file_contents

if __name__ == "__main__":
    plan_repair(sys.argv[1], sys.argv[2], sys.argv[3])
