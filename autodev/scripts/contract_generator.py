#!/usr/bin/env python3
"""
contract_generator.py - Build dynamic UAT contract from plan + generated source code
Usage: python3 contract_generator.py <plan.json> <project_root> <backend_port> <frontend_port> <output.json>
"""
import sys, json, os, re


def _load_json(path, fallback):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return fallback


def _walk_sources(project_root):
    for root, dirs, files in os.walk(project_root):
        dirs[:] = [d for d in dirs if d not in ("venv", "node_modules", "__pycache__", ".git", "dist", ".next")]
        for fname in files:
            if fname.endswith((".py", ".js", ".ts")):
                path = os.path.join(root, fname)
                try:
                    yield path, open(path, "r", encoding="utf-8", errors="ignore").read()
                except Exception:
                    continue


def _infer_request_body(path):
    # Generic payload shape for dynamic entities
    resource = [p for p in path.split("/") if p and not p.startswith("{")]
    name = resource[-1] if resource else "item"
    singular = name[:-1] if name.endswith("s") else name
    return {
        "name": f"Sample {singular}",
        "title": f"Sample {singular}",
        "description": "Sample description",
        "content": "Sample content",
    }


def _parse_fastapi_routes(src):
    routes = []
    for m in re.finditer(r'@\w*app\.(get|post|put|patch|delete)\s*\(\s*["\']([^"\']+)["\']', src, re.IGNORECASE):
        routes.append((m.group(1).upper(), m.group(2)))
    return routes


def _parse_express_routes(src):
    routes = []
    for m in re.finditer(r'\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*["\']([^"\']+)["\']', src, re.IGNORECASE):
        routes.append((m.group(1).upper(), m.group(2)))
    return routes


def _normalize_path(path):
    # Convert :id style to {id} for UAT runner template replacement
    return re.sub(r":([a-zA-Z_][a-zA-Z0-9_]*)", r"{\1}", path)


def generate_contract(plan_path, project_root, backend_port, frontend_port, out_path):
    plan = _load_json(plan_path, {})
    tech_stack = [str(t).lower() for t in plan.get("tech_stack", [])]

    has_backend = any(k in tech_stack for k in ["fastapi", "flask", "django", "express", "node", "nestjs"])
    has_frontend = any(k in tech_stack for k in ["react", "vue", "angular", "svelte", "next", "vite"])

    contract = {"version": "2.0"}

    if has_backend:
        endpoints = []
        discovered = []

        for _, src in _walk_sources(project_root):
            discovered.extend(_parse_fastapi_routes(src))
            discovered.extend(_parse_express_routes(src))

        # fallback when route decorators not found: test root + health-like endpoints
        if not discovered:
            discovered = [("GET", "/"), ("GET", "/health")]

        for method, raw_path in discovered:
            path = _normalize_path(raw_path)
            endpoint = {"method": method, "path": path}

            if method == "GET":
                endpoint["expect_status"] = [200, 204]
            elif method == "POST":
                endpoint["expect_status"] = [200, 201, 202]
                endpoint["request_body"] = _infer_request_body(path)
            elif method in ("PUT", "PATCH"):
                endpoint["expect_status"] = [200, 202]
                endpoint["request_body"] = _infer_request_body(path)
            elif method == "DELETE":
                endpoint["expect_status"] = [200, 202, 204]
            else:
                endpoint["expect_status"] = [200]

            endpoints.append(endpoint)

        # Keep deterministic unique list
        seen = set()
        unique = []
        for ep in endpoints:
            key = (ep["method"], ep["path"])
            if key in seen:
                continue
            seen.add(key)
            unique.append(ep)

        order = {"GET": 0, "POST": 1, "PUT": 2, "PATCH": 3, "DELETE": 4}
        unique.sort(key=lambda e: (order.get(e["method"], 9), e["path"]))

        contract["backend"] = {
            "base_url": f"http://localhost:{backend_port}",
            "endpoints": unique,
        }

    if has_frontend:
        contract["frontend"] = {
            "base_url": f"http://localhost:{frontend_port}",
            "checks": [
                {
                    "path": "/",
                    "expect_status": 200,
                    "expect_html_contains": ["<html", "</html"],
                }
            ],
        }

    with open(out_path, "w") as f:
        json.dump(contract, f, indent=2)

    print(
        f"  [Contract] Generated: {len(contract.get('backend', {}).get('endpoints', []))} API tests, "
        f"{len(contract.get('frontend', {}).get('checks', []))} frontend checks"
    )
    return contract


if __name__ == "__main__":
    generate_contract(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
