#!/usr/bin/env python3
"""
uat_runner.py - Contract-driven UAT engine
Reads a contract.json, executes tests, writes structured failure reports.
Usage: python3 uat_runner.py <contract.json> <output_report.json>
"""
import sys, json, time, urllib.request, urllib.error, os, re

def run_uat(contract_path, report_path):
    with open(contract_path) as f:
        contract = json.load(f)

    results  = []
    all_pass = True

    # ── Wait for services to be ready ────────────────────────────────────────
    def wait_for(url, label, timeout=60):
        start = time.time()
        while time.time() - start < timeout:
            try:
                r = urllib.request.urlopen(url, timeout=2)
                print(f"  ✅ {label} ready ({r.status})")
                return True
            except urllib.error.HTTPError as e:
                if e.code in (404, 405, 422, 307):
                    print(f"  ✅ {label} ready ({e.code})")
                    return True
            except Exception:
                pass
            time.sleep(1)
        print(f"  ❌ {label} did not start within {timeout}s")
        return False

    backend_url  = contract.get("backend",  {}).get("base_url",  "")
    frontend_url = contract.get("frontend", {}).get("base_url", "")

    if backend_url:
        if not wait_for(backend_url + "/", "Backend"):
            results.append({"test": "Backend startup", "ok": False,
                "category": "SERVICE_DOWN", "expected": "service running",
                "actual": f"{backend_url} not reachable after 60s"})
            all_pass = False

    if frontend_url:
        if not wait_for(frontend_url + "/", "Frontend"):
            results.append({"test": "Frontend startup", "ok": False,
                "category": "SERVICE_DOWN", "expected": "service running",
                "actual": f"{frontend_url} not reachable after 60s"})
            all_pass = False

    # ── Backend endpoint tests ────────────────────────────────────────────────
    created_params = {}  # e.g. {'id': 123, 'userId': 5} from create responses

    for ep in contract.get("backend", {}).get("endpoints", []):
        method   = ep["method"]
        path     = ep["path"]
        body     = ep.get("request_body")
        statuses = ep["expect_status"]
        if isinstance(statuses, int):
            statuses = [statuses]

        # Resolve parameterized paths (e.g. /orders/{id}, /users/{userId})
        params = re.findall(r"\{([^}]+)\}", path)
        can_resolve = True
        for p in params:
            if p in created_params:
                path = path.replace("{" + p + "}", str(created_params[p]))
            elif p.lower().endswith("id") and "id" in created_params:
                path = path.replace("{" + p + "}", str(created_params["id"]))
            else:
                can_resolve = False
                break
        if not can_resolve:
            print(f"  ⏭  SKIP {method} {path}: missing path param values")
            continue

        url  = backend_url + path
        name = f"{method} {ep['path']}"

        try:
            data    = json.dumps(body).encode() if body else None
            headers = {"Content-Type": "application/json"} if body else {}
            req     = urllib.request.Request(url, data=data, headers=headers, method=method)
            r       = urllib.request.urlopen(req, timeout=8)
            resp_raw = r.read()
            try:
                resp_body = json.loads(resp_raw)
            except:
                resp_body = resp_raw.decode("utf-8", "replace")[:300]

            ok = r.status in statuses

            # Validate response body structure
            body_errors = []
            if ok and ep.get("expect_body_type") == "array":
                if not isinstance(resp_body, list):
                    body_errors.append(f"expected array, got {type(resp_body).__name__}")
                    ok = False
            if ok and ep.get("expect_body_keys"):
                if isinstance(resp_body, dict):
                    for k in ep["expect_body_keys"]:
                        if k not in resp_body:
                            body_errors.append(f"missing key '{k}'")
                            ok = False
                else:
                    body_errors.append(f"expected dict, got {type(resp_body).__name__}")
                    ok = False

            # Track created path params from response objects for follow-up tests
            if method == "POST" and isinstance(resp_body, dict):
                for k, v in resp_body.items():
                    if isinstance(v, (int, str)) and k.lower().endswith("id"):
                        created_params[k] = v
                if "id" in resp_body:
                    created_params["id"] = resp_body["id"]

            category = "LOGIC" if not ok else "OK"
            if body_errors:
                actual = f"status={r.status} body_errors={body_errors} body={str(resp_body)[:200]}"
            else:
                actual = f"status={r.status} body={str(resp_body)[:100]}"

            results.append({
                "test": name, "ok": ok, "status": r.status,
                "expected": {"status": statuses, **{k:v for k,v in ep.items()
                             if k.startswith("expect_")}},
                "actual": actual, "category": category,
                "body": resp_body
            })

            icon = "✅" if ok else "❌"
            print(f"  {icon} [{r.status}] {name}" + (f" — {body_errors}" if body_errors else ""))

        except urllib.error.HTTPError as e:
            ok = e.code in statuses
            category = categorize(str(e), e.code)
            results.append({"test": name, "ok": ok, "status": e.code,
                "expected": statuses, "actual": f"HTTPError {e.code}: {e.reason}",
                "category": category})
            icon = "✅" if ok else "❌"
            print(f"  {icon} [{e.code}] {name}")

        except Exception as e:
            category = categorize(str(e), 0)
            results.append({"test": name, "ok": False, "status": 0,
                "expected": statuses, "actual": str(e), "category": category})
            print(f"  ❌ [ERR] {name}: {e}")

        if not results[-1]["ok"]:
            all_pass = False

    # ── Frontend tests ────────────────────────────────────────────────────────
    for check in contract.get("frontend", {}).get("checks", []):
        url  = frontend_url + check["path"]
        name = f"Frontend GET {check['path']}"
        try:
            r        = urllib.request.urlopen(url, timeout=8)
            html     = r.read().decode("utf-8", "replace")
            ok       = r.status == check.get("expect_status", 200)
            contains = check.get("expect_html_contains", [])
            missing  = [s for s in contains if s not in html]
            if missing:
                ok = False
                actual = f"status={r.status} missing_in_html={missing}"
                category = "FRONTEND_CONTENT"
            else:
                actual = f"status={r.status} html_ok"
                category = "OK"
            results.append({"test": name, "ok": ok, "status": r.status,
                "expected": check, "actual": actual, "category": category})
            icon = "✅" if ok else "❌"
            print(f"  {icon} [{r.status}] {name}" + (f" — missing: {missing}" if missing else ""))
        except urllib.error.HTTPError as e:
            category = categorize(str(e), e.code)
            results.append({"test": name, "ok": False, "status": e.code,
                "expected": check, "actual": str(e), "category": category})
            print(f"  ❌ [{e.code}] {name}: {e}")
        except Exception as e:
            category = categorize(str(e), 0)
            results.append({"test": name, "ok": False, "status": 0,
                "expected": check, "actual": str(e), "category": category})
            print(f"  ❌ [ERR] {name}: {e}")
        if not results[-1]["ok"]:
            all_pass = False

    # ── Write report ─────────────────────────────────────────────────────────
    passed  = sum(1 for r in results if r["ok"])
    total   = len(results)
    failures = [r for r in results if not r["ok"]]

    report = {
        "passed": passed, "total": total, "all_pass": all_pass,
        "results": results, "failures": failures,
        "failure_categories": list({f["category"] for f in failures})
    }
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"\n  UAT: {passed}/{total} passed  |  failures: {[f['test'] for f in failures]}")
    return all_pass, failures

def categorize(error_str, status_code):
    s = error_str.lower()
    if "syntaxerror" in s:                          return "SYNTAX"
    if "cannot find module" in s or "module not found" in s: return "MISSING_DEP"
    if "connection refused" in s or status_code == 0: return "SERVICE_DOWN"
    if status_code == 404:                          return "WRONG_ROUTE"
    if "cors" in s:                                 return "CORS"
    if status_code in (422, 400):                   return "SCHEMA_MISMATCH"
    if status_code == 500:                          return "SERVER_ERROR"
    return "LOGIC"

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: uat_runner.py <contract.json> <report.json>")
        sys.exit(1)
    ok, failures = run_uat(sys.argv[1], sys.argv[2])
    sys.exit(0 if ok else 1)
