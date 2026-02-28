#!/usr/bin/env python3
"""
contract_generator.py - Extract testable contract from plan.json + source files
Usage: python3 contract_generator.py <plan.json> <project_root> <backend_port> <frontend_port> <output.json>
"""
import sys, json, os, re

def generate_contract(plan_path, project_root, backend_port, frontend_port, out_path):
    with open(plan_path) as f:
        plan = json.load(f)

    tech_stack = [t.lower() for t in plan.get("tech_stack", [])]
    has_backend  = any(t in tech_stack for t in ["fastapi","flask","express","django","node"])
    has_frontend = any(t in tech_stack for t in ["react","vue","angular","svelte","vite"])

    contract = {"version": "1.0"}

    # ── Infer backend routes from source ─────────────────────────────────────
    if has_backend:
        contract["backend"] = {
            "base_url": f"http://localhost:{backend_port}",
            "endpoints": []
        }
        endpoints = contract["backend"]["endpoints"]

        # Always test docs and health
        endpoints.append({"method": "GET", "path": "/docs", "expect_status": 200})

        # Scan Python files for FastAPI route decorators
        routes_found = []
        for root, dirs, files in os.walk(project_root):
            dirs[:] = [d for d in dirs if d not in ("venv", "__pycache__", "node_modules")]
            for fname in files:
                if fname.endswith(".py"):
                    try:
                        src = open(os.path.join(root, fname)).read()
                    except: continue
                    for m in re.finditer(
                        r'@app\.(get|post|put|patch|delete)\s*\(\s*["\']([^"\']+)["\']',
                        src, re.IGNORECASE
                    ):
                        method = m.group(1).upper()
                        path   = m.group(2)
                        # Extract response model name if present
                        routes_found.append((method, path))

        # Build test sequence: GET → POST (with body) → DELETE
        resource_paths = set()
        for method, path in routes_found:
            # Infer resource name from path (e.g. /todos → todo)
            parts = [p for p in path.split("/") if p and not p.startswith("{")]
            if parts:
                resource_paths.add(("/" + "/".join(parts), method))

        # Add discovered routes as tests
        for base_path, method in sorted(resource_paths):
            resource = base_path.strip("/").split("/")[-1]  # e.g. "todos"
            singular = resource.rstrip("s")  # naive singularize

            if method == "GET":
                endpoints.append({
                    "method": "GET", "path": base_path,
                    "expect_status": 200, "expect_body_type": "array"
                })
            elif method == "POST":
                endpoints.append({
                    "method": "POST", "path": base_path,
                    "expect_status": [200, 201],
                    "request_body": {
                        "title": f"UAT {singular}",
                        "name":  f"UAT {singular}"  # common alternatives
                    },
                    "expect_body_keys": ["id"]
                })
            elif method == "DELETE":
                endpoints.append({
                    "method": "DELETE", "path": base_path + "/{id}",
                    "expect_status": [200, 204]
                })

        # Deduplicate and sort: GET first, then POST, then DELETE
        order = {"GET": 0, "POST": 1, "PUT": 2, "PATCH": 3, "DELETE": 4}
        seen = set()
        unique = []
        for ep in endpoints:
            key = (ep["method"], ep["path"])
            if key not in seen:
                seen.add(key)
                unique.append(ep)
        endpoints.clear()
        endpoints.extend(sorted(unique, key=lambda e: (order.get(e["method"],9), e["path"])))

    # ── Frontend checks ───────────────────────────────────────────────────────
    if has_frontend:
        contract["frontend"] = {
            "base_url": f"http://localhost:{frontend_port}",
            "checks": [
                {
                    "path": "/",
                    "expect_status": 200,
                    "expect_html_contains": ['<div id="root"', "<!DOCTYPE"]
                }
            ]
        }

    with open(out_path, "w") as f:
        json.dump(contract, f, indent=2)

    print(f"  [Contract] Generated: {len(contract.get('backend',{}).get('endpoints',[]))} API tests, "
          f"{len(contract.get('frontend',{}).get('checks',[]))} frontend checks")
    return contract

if __name__ == "__main__":
    generate_contract(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
