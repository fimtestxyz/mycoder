#!/usr/bin/env python3
"""
preflight.py - Static pre-flight checks before launching services.
Catches syntax errors, missing imports, and vite config mismatches.
Writes errors to errors.log. Exits 0=all-clear, 1=fixable errors found.
Usage: python3 preflight.py <project_root>
"""
import sys, os, ast, re, json, subprocess

def run(project_root):
    errors   = []
    warnings = []
    
    def find_files(ext, exclude=("venv","node_modules","__pycache__",".next","dist","build")):
        for root, dirs, files in os.walk(project_root):
            dirs[:] = [d for d in dirs if d not in exclude]
            for f in files:
                if f.endswith(ext):
                    yield os.path.join(root, f)

    # ── 1. Python syntax ─────────────────────────────────────────────────────
    for py_file in find_files(".py"):
        rel = os.path.relpath(py_file, project_root)
        result = subprocess.run(
            ["python3", "-m", "py_compile", py_file],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            msg = result.stderr.strip().replace(py_file, rel)
            errors.append({"file": rel, "type": "SYNTAX", "detail": msg})
            print(f"  ❌ SYNTAX  {rel}: {msg.split(chr(10))[0]}")
        else:
            print(f"  ✅ py     {rel}")

    # ── 2. Python imports vs requirements.txt ────────────────────────────────
    stdlib = {
        'os','sys','json','re','time','typing','sqlite3','pathlib','collections',
        'functools','itertools','math','random','string','datetime','hashlib',
        'base64','io','abc','copy','dataclasses','enum','uuid','contextlib',
        'asyncio','threading','logging','inspect','traceback','tempfile','shutil'
    }
    for py_file in find_files(".py"):
        rel = os.path.relpath(py_file, project_root)
        if "venv" in py_file: continue
        try:
            with open(py_file) as f: src = f.read()
            tree = ast.parse(src)
            imports = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imports |= {a.name.split('.')[0] for a in node.names}
                elif isinstance(node, ast.ImportFrom):
                    if node.module: imports.add(node.module.split('.')[0])
            third_party = {i for i in imports if i not in stdlib and not i.startswith('_')}
            
            # Find nearest requirements.txt
            req_file = None
            d = os.path.dirname(py_file)
            while d != project_root and d != os.path.dirname(d):
                cand = os.path.join(d, "requirements.txt")
                if os.path.exists(cand): req_file = cand; break
                d = os.path.dirname(d)
            
            if req_file:
                with open(req_file) as f:
                    declared = {l.strip().split('=')[0].split('[')[0].split('>')[0].split('<')[0].lower()
                               for l in f if l.strip() and not l.startswith('#')}
                # Normalize: fastapi → fastapi, uvicorn[standard] → uvicorn
                for imp in third_party:
                    if imp.lower() not in declared and imp.lower() + 's' not in declared:
                        # Some packages have different import names (e.g. PIL → Pillow)
                        known_aliases = {'pydantic': 'pydantic', 'sqlalchemy': 'sqlalchemy',
                                        'fastapi': 'fastapi', 'uvicorn': 'uvicorn'}
                        if imp.lower() in known_aliases and known_aliases[imp.lower()] in declared:
                            continue
                        warnings.append({"file": rel, "type": "MISSING_IMPORT",
                            "detail": f"'{imp}' imported but not in requirements.txt"})
        except SyntaxError:
            pass  # already caught above
        except Exception as e:
            pass

    # ── 3. Vite config imports vs package.json ───────────────────────────────
    for vite_cfg in find_files(".ts"):
        if "vite.config" not in vite_cfg: continue
        rel = os.path.relpath(vite_cfg, project_root)
        fe_dir = os.path.dirname(vite_cfg)
        pkg_path = os.path.join(fe_dir, "package.json")
        if not os.path.exists(pkg_path): continue
        
        with open(vite_cfg) as f: src = f.read()
        with open(pkg_path) as f: pkg = json.load(f)
        all_deps = {**pkg.get("dependencies",{}), **pkg.get("devDependencies",{})}
        
        imports = re.findall(r"from\s+['\"]([^./][^'\"]*)['\"]", src)
        imports += re.findall(r"require\(['\"]([^./][^'\"]*)['\"]", src)
        imports = [i for i in imports if not i.startswith('node:')]
        
        missing = [i for i in imports if i not in all_deps]
        if missing:
            errors.append({"file": rel, "type": "MISSING_DEP",
                "detail": f"imports {missing} but not in package.json deps"})
            print(f"  ❌ VITE    {rel}: missing in package.json: {missing}")
        else:
            print(f"  ✅ vite   {rel}")

    # ── 4. node_modules existence check ─────────────────────────────────────
    for pkg_file in find_files(".json"):
        if "package.json" not in pkg_file: continue
        if "node_modules" in pkg_file: continue
        fe_dir = os.path.dirname(pkg_file)
        rel_dir = os.path.relpath(fe_dir, project_root)
        nm = os.path.join(fe_dir, "node_modules")
        if not os.path.isdir(nm):
            errors.append({"file": rel_dir+"/package.json", "type": "NO_NODE_MODULES",
                "detail": "node_modules not installed — run: npm install --include=dev"})
            print(f"  ❌ DEPS    {rel_dir}: node_modules missing")
        else:
            # Check critical packages exist
            with open(pkg_file) as f:
                try: pkg = json.load(f)
                except: continue
            all_deps = {**pkg.get("dependencies",{}), **pkg.get("devDependencies",{})}
            for crit in ["vite", "@vitejs/plugin-react", "@vitejs/plugin-react-swc"]:
                if crit in all_deps:
                    if not os.path.isdir(os.path.join(nm, crit)):
                        errors.append({"file": rel_dir+"/package.json", "type": "MISSING_DEP",
                            "detail": f"'{crit}' in deps but missing from node_modules"})
                        print(f"  ❌ DEPS    {rel_dir}: {crit} not in node_modules")
            print(f"  ✅ nm     {rel_dir}/node_modules")

    # ── 5. index.html has <div id="root"> ────────────────────────────────────
    for html_file in find_files(".html"):
        rel = os.path.relpath(html_file, project_root)
        with open(html_file) as f: src = f.read()
        if '<div id="root"' not in src and "<div id='root'" not in src:
            warnings.append({"file": rel, "type": "HTML_MISSING_ROOT",
                "detail": "index.html has no <div id=\"root\"> — React cannot mount"})
            print(f"  ⚠️  HTML   {rel}: missing <div id='root'>")
        else:
            print(f"  ✅ html   {rel}")

    # ── Summary ───────────────────────────────────────────────────────────────
    err_log = os.path.join(project_root, "preflight_errors.log")
    all_issues = errors + warnings
    if all_issues:
        with open(err_log, 'w') as f:
            json.dump({"errors": errors, "warnings": warnings}, f, indent=2)
    
    print(f"\n  Pre-flight: {len(errors)} errors, {len(warnings)} warnings")
    if errors:
        # Categorize for repair agent
        cats = list({e["type"] for e in errors})
        print(f"  Error categories: {cats}")
        print(f"  Repair targets:")
        for e in errors:
            print(f"    [{e['type']}] {e['file']}: {e['detail']}")
    
    return errors, warnings

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: preflight.py <project_root>"); sys.exit(1)
    errors, warnings = run(sys.argv[1])
    sys.exit(0 if not errors else 1)
