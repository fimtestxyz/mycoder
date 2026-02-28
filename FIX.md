The Core Problem
The current approach is linear: Plan → Code → Hope it works. When it fails, the repair agent gets a vague "something's wrong" signal and guesses. That's not a feedback loop — it's a retry loop.
A real feedback loop requires four things working together:

1. Contract-First: Define "Working" Before Writing Code
The biggest mistake is generating code first and testing afterwards. Instead, derive a machine-readable contract from the plan before the coder runs:
Plan (what to build)
  ↓
Contract (how to prove it works)  ← defined FIRST
  ↓
Coder (must satisfy the contract)
  ↓
UAT runner (executes the contract)
The contract captures exactly what "working" means:

POST /todos → returns {id, title, done} with status 200
GET / → returns HTML containing <div id="root">
Frontend loads without console errors

This means the coder gets told upfront: "you must implement these exact endpoints with these exact shapes." The test oracle is defined before the code exists.

2. Structured Failures, Not Log Dumps
When something breaks, the repair agent needs signal, not noise. Sending 500 lines of logs to an LLM is like asking a doctor to diagnose from a full EHR dump. Instead, build a failure categorizer:
Raw failure
    ↓
Categorizer
    ↓
Category: MISSING_DEP / SERVICE_DOWN / SCHEMA_MISMATCH / CORS / WRONG_ROUTE / LOGIC
    ↓
Targeted context: only the relevant files + expected vs actual diff
Each category maps to specific files and specific fixes. MISSING_DEP → send package.json. CORS → send only main.py with the middleware section highlighted. The repair agent sees a small, precise problem statement instead of everything.

3. The Feedback Loop Itself
The loop has six steps, each feeding into the next:
┌─────────────────────────────────────────────────────────────┐
│                    FEEDBACK LOOP                            │
│                                                             │
│  Launch services                                            │
│      ↓                                                      │
│  Run UAT (contract-driven)                                  │
│      ↓                    ← if all pass → DONE ✅          │
│  Categorize failures                                        │
│      ↓                                                      │
│  Build repair context (targeted files + expected vs actual) │
│      ↓                                                      │
│  Repair agent → writes fixed files                          │
│      ↓                                                      │
│  Reinstall changed deps → restart affected service only     │
│      ↑___________________________|                          │
│              (max 3 iterations)                             │
└─────────────────────────────────────────────────────────────┘
Three things make this different from a naive retry loop:
Iteration memory — each repair pass appends to a history: "iteration 1 tried X but Y still failed." The agent doesn't repeat the same fix.
Targeted restarts — if only frontend/package.json changed, restart only the frontend. Don't throw away a working backend.
Escalating context — iteration 1 gets the minimal fix prompt. If it fails, iteration 2 gets the original failure + what iteration 1 tried + the new failure. By iteration 3 the agent has full context.

4. What UAT Actually Tests
HTTP 200 is not enough. A robust UAT tests the full CRUD lifecycle as a user would experience it:
GET  /todos        → 200, body is []              (starts empty)
POST /todos        → 200, body has {id, title, done}  (creates item)
GET  /todos        → 200, body contains the item  (persists)
DELETE /todos/{id} → 200                          (removes it)
GET  /todos        → 200, body is []              (actually deleted)
GET  /docs         → 200                          (API docs work)
GET  http://localhost:5173/ → 200, HTML has <div id="root">
Each assertion is independent. A failure in step 3 ("item doesn't persist") points to a database bug. A failure in step 2 body shape (done field missing) points to the Pydantic model. The failure location tells you the fix location.

5. The Missing Pieces We Still Need
Beyond what's implemented, a truly robust system needs:
Pre-flight static analysis before launch — run python -m py_compile on every .py file and tsc --noEmit on TypeScript. Catch syntax errors in under a second, before spending 60 seconds waiting for a server that will never start.
Dependency lock verification — after npm install, check that every package referenced in vite.config.ts and import statements actually exists in node_modules. Don't wait for runtime to discover @vitejs/plugin-react is missing.
Diff-based repair — instead of sending full file contents, send a structured diff: "Line 12: expected CORSMiddleware(..., allow_origins=['http://localhost:5173']), found allow_origins=['*']". LLMs fix precise diffs far more reliably than they re-generate whole files.
Health check granularity — separate "port is open" from "app is healthy." FastAPI returning 404 on / looks like success. The health check should specifically call /docs or a /health endpoint to confirm the application layer is actually running, not just the TCP socket.

The Architecture in One Diagram
Task description
    │
    ▼
Plan (architecture)
    │
    ▼
Contract (test spec)  ◄──── derived from plan + discovered routes
    │
    ▼
Code generation  ◄──── told to satisfy the contract
    │
    ▼
Static analysis (py_compile, tsc, dep check)
    │
    ├── fail → targeted syntax repair → retry
    ▼
Install & verify deps
    │
    ▼
Launch (PID-tracked, log-captured)
    │
    ▼
Health check (port + app layer)
    │
    ▼
UAT  ◄──────────────────────────────────────────┐
    │                                            │
    ├── pass ──► DONE ✅                         │
    │                                            │
    └── fail ──► Categorize                      │
                    │                            │
                    ▼                            │
                Repair context                   │
                (targeted files + history)       │
                    │                            │
                    ▼                            │
                Repair agent                     │
                    │                            │
                    ▼                            │
                Apply fixes                      │
                    │                            │
                    ▼                            │
                Reinstall if deps changed        │
                    │                            │
                    ▼                            │
                Restart affected service ────────┘
                (max 3 iterations)
The key insight is that every arrow going left (back toward repair) carries more specific information than the one before it. The loop converges because the repair agent gets a progressively clearer picture of exactly what is wrong and what was already tried.