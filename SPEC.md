Below is a **full enterprise-grade `SPEC.md`** for a **local LLM multi-agent development system** running on **Ollama** on macOS (Mac Mini M4 Pro 64GB), using **bash as execution loop**, capable of generating complete working software inside:

```
~/workspace/projectA
~/workspace/projectB
~/workspace/projectC
```

This design mimics the workflow style of tools like Claude Code but runs fully local via Ollama.

---

# 📄 SPEC.md

## Project: Local Autonomous Multi-Agent Software Development System

Version: 1.0
Environment: macOS (Apple Silicon – M4 Pro, 64GB RAM)
Execution Engine: Ollama + Bash Agent Loop

---

# 1. Executive Summary

Build a **local-first autonomous coding system** that:

* Accepts high-level task input
* Decomposes into architecture plan
* Spawns sub-agents (frontend / backend / mobile / infra)
* Iteratively writes, refactors, and validates code
* Produces fully working production-grade applications
* Operates entirely offline
* Writes directly to project folders

The system uses:

* Local LLMs via Ollama
* Agent orchestration in Bash
* Structured prompt contracts
* Deterministic file write cycles
* Validation + repair loops

---

# 2. System Goals

## 2.1 Functional Goals

* Generate complete web applications:

  * Frontend (React / Next / Vue)
  * Backend (FastAPI / Node / Spring Boot)
  * Mobile (React Native / Flutter)
* Support multi-service architecture
* Maintain structured project layout
* Self-heal compilation/runtime errors
* Enforce enterprise coding standards
* Generate documentation, tests, Docker, CI

## 2.2 Non-Functional Goals

* Fully local execution
* Deterministic agent behavior
* Low hallucination file writes
* Structured output contracts
* Idempotent execution loops
* Model pluggable (Qwen / DeepSeek / etc)

---

# 3. High-Level Architecture

```
User Task Input
      ↓
Planner Agent
      ↓
Task Decomposer
      ↓
Sub-Agents
   ├── Frontend Agent
   ├── Backend Agent
   ├── Mobile Agent
   ├── DevOps Agent
      ↓
Code Writer
      ↓
Validator (lint/test/build)
      ↓
Repair Loop
      ↓
Stable Output in ~/workspace/projectX
```

---

# 4. LLM Model Strategy (Ollama)

Recommended models:

| Role             | Model Type             |
| ---------------- | ---------------------- |
| Planner          | 30B coder model        |
| Code Generator   | 14B–30B coder          |
| Debug / Repair   | Strong reasoning coder |
| Fast small tasks | 7B coder               |

All models run through:

```bash
ollama run <model>
```

Or via API:

```
http://localhost:11434
```

---

# 5. Agent Architecture

## 5.1 Agent Types

### 5.1.1 Planner Agent

Responsibility:

* Interpret task
* Define architecture
* Output structured project plan in JSON

Output Contract:

```json
{
  "project_type": "",
  "tech_stack": [],
  "modules": [],
  "folder_structure": [],
  "dependencies": []
}
```

---

### 5.1.2 Decomposer Agent

Responsibility:

* Break modules into implementation tasks
* Assign tasks to sub-agents

Output:

```json
{
  "frontend_tasks": [],
  "backend_tasks": [],
  "mobile_tasks": [],
  "devops_tasks": []
}
```

---

### 5.1.3 Frontend Agent

Responsibilities:

* UI architecture
* Routing
* State management
* API integration
* Component hierarchy
* Accessibility
* Test scaffolding

Output format (STRICT):

```
FILE: src/components/Header.tsx
<code>

FILE: src/pages/index.tsx
<code>
```

---

### 5.1.4 Backend Agent

Responsibilities:

* REST/GraphQL API
* Authentication
* DB schema
* ORM models
* Middleware
* Logging
* Validation
* Security headers

Output format:

```
FILE: app/main.py
<code>
```

---

### 5.1.5 Mobile Agent

Responsibilities:

* Navigation
* API hooks
* Device integration
* Platform config

---

### 5.1.6 DevOps Agent

Responsibilities:

* Dockerfile
* docker-compose.yml
* .env template
* CI pipeline
* K8s manifest (optional)
* Monitoring config

---

# 6. Bash Agent Loop (Core Orchestration)

## 6.1 Control Loop

```bash
while true; do
    PLAN=$(ollama run planner_model < task.txt)

    DECOMP=$(ollama run decomposer_model <<< "$PLAN")

    for AGENT in frontend backend mobile devops; do
        OUTPUT=$(ollama run ${AGENT}_model <<< "$DECOMP")

        ./write_files.sh "$OUTPUT" "$PROJECT_ROOT"

        ./validate.sh "$PROJECT_ROOT"

        if [ $? -ne 0 ]; then
            FIX=$(ollama run repair_model < errors.log)
            ./write_files.sh "$FIX" "$PROJECT_ROOT"
        fi
    done

    if ./all_checks_pass.sh; then
        break
    fi
done
```

---

# 7. File Writing Engine

## 7.1 write_files.sh

Parses structured LLM output:

```
FILE: path/to/file.ext
<content>
```

Logic:

* Create directories
* Overwrite file atomically
* Validate syntax
* Log diff

---

# 8. Validation Layer

## 8.1 Frontend

* npm install
* npm run build
* ESLint
* Type check

## 8.2 Backend

* Unit tests
* Lint
* Security scan
* Migration check

## 8.3 Mobile

* Build check
* Dependency validation

---

# 9. Error Repair Strategy

On build/test failure:

1. Capture full logs
2. Send logs + failing file to Repair Agent
3. Require structured file rewrite only
4. Re-run validation
5. Max retry threshold (configurable)

---

# 10. Enterprise Coding Standards

Enforced via system prompt:

* SOLID principles
* Clean architecture
* Layer separation
* DTO validation
* Structured logging
* Config separation
* No hardcoded secrets
* Comprehensive error handling
* Unit tests mandatory
* Type-safe code

---

# 11. Project Structure Standard

```
projectA/
 ├── frontend/
 ├── backend/
 ├── mobile/
 ├── infra/
 ├── docs/
 ├── scripts/
 ├── .env.example
 ├── docker-compose.yml
 └── README.md
```

---

# 12. State Management

To avoid hallucination drift:

* Store plan.json
* Store task_map.json
* Store execution log
* Use them as context input every iteration

---

# 13. Configuration File

`agent.config.json`

```json
{
  "planner_model": "qwen3-coder:30b",
  "coder_model": "qwen2.5-coder:14b",
  "repair_model": "deepseek-coder:33b",
  "max_retries": 5,
  "project_root": "~/workspace/projectA"
}
```

---

# 14. Security Model

* No shell execution without validation
* No arbitrary command generation
* Only allow whitelisted commands:

  * npm
  * pip
  * docker
  * pytest
  * build tools
* Sandboxed execution

---

# 15. Scalability Considerations

Future extensions:

* Multi-project parallelism
* Redis task queue
* Vector memory per project
* Git auto-commit
* Multi-model voting
* Fine-tuned internal coding model

---

# 16. Acceptance Criteria

System is complete when:

* A high-level prompt like:

  > “Build a multi-tenant SaaS with React frontend and FastAPI backend with JWT auth and Stripe integration”

Produces:

* Running frontend
* Running backend
* Docker compose setup
* Passing tests
* Clean folder structure
* Deployment-ready artifacts

---

# 17. Future Enhancements

* Self-improving prompt refinement
* Cost/performance auto-model switching
* Long-term memory embedding store
* Risk scoring of generated code
* Code diff semantic validator
* CI auto-fix loop

---

# 18. Summary

This SPEC defines a:

* Fully local
* Multi-agent
* Self-healing
* Enterprise-grade
* Autonomous software development system
* Using Ollama + Bash orchestration
* Producing production-ready web/mobile apps

---

If you want next, I can generate:

* ✅ Full bash orchestration framework
* ✅ Agent prompt templates
* ✅ write_files.sh production-grade version
* ✅ JSON schema contracts
* ✅ State memory + vector DB integration design


