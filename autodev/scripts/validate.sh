#!/bin/bash
# validate.sh - Validate generated project code
# Usage: ./validate.sh <project_root>

PROJECT_ROOT="$1"

if [[ -z "$PROJECT_ROOT" ]]; then
    echo "Usage: $0 <project_root>"
    exit 1
fi

if [[ ! -d "$PROJECT_ROOT" ]]; then
    echo "Error: Project root not found: $PROJECT_ROOT"
    exit 1
fi

LOG_FILE="$PROJECT_ROOT/errors.log"
> "$LOG_FILE"
FAILED=0

echo "  Validating: $PROJECT_ROOT"

# ── Python syntax check ───────────────────────────────────────────────────────
while IFS= read -r -d '' pyfile; do
    if ! python3 -m py_compile "$pyfile" 2>> "$LOG_FILE"; then
        echo "  ❌ Syntax error: ${pyfile#$PROJECT_ROOT/}"
        FAILED=1
    fi
done < <(find "$PROJECT_ROOT" -name "*.py" \
    -not -path "*/venv/*" \
    -not -path "*/__pycache__/*" \
    -print0 2>/dev/null)

# ── Check required files exist ────────────────────────────────────────────────
REQUIRED_FILES=()

# Backend
if find "$PROJECT_ROOT" -name "main.py" -not -path "*/venv/*" | grep -q .; then
    echo "  ✅ backend/main.py found"
    # Check FastAPI app is defined
    if ! grep -r "FastAPI()" "$PROJECT_ROOT" --include="*.py" \
        --exclude-dir=venv --exclude-dir=__pycache__ -q; then
        echo "  ⚠  No FastAPI() instance found in Python files" >> "$LOG_FILE"
    fi
fi

# Frontend
if find "$PROJECT_ROOT" -name "package.json" -not -path "*/node_modules/*" | grep -q .; then
    echo "  ✅ frontend/package.json found"
fi
if find "$PROJECT_ROOT" -name "App.tsx" -o -name "App.jsx" -o -name "App.js" \
    2>/dev/null | grep -v node_modules | grep -q .; then
    echo "  ✅ App component found"
fi

# ── TypeScript syntax check (if tsc available) ────────────────────────────────
TSX_COUNT=$(find "$PROJECT_ROOT" -name "*.tsx" -o -name "*.ts" \
    -not -path "*/node_modules/*" 2>/dev/null | wc -l | tr -d ' ')
if [[ $TSX_COUNT -gt 0 ]]; then
    FE_DIR=$(find "$PROJECT_ROOT" -name "tsconfig.json" \
        -not -path "*/node_modules/*" 2>/dev/null | head -1 | xargs -I{} dirname {})
    if [[ -n "$FE_DIR" ]] && command -v npx &>/dev/null; then
        echo "  Checking TypeScript in $FE_DIR ..."
        pushd "$FE_DIR" > /dev/null
        npx tsc --noEmit >> "$LOG_FILE" 2>&1 || true  # warn only, don't fail
        popd > /dev/null
    fi
fi

# ── Result ────────────────────────────────────────────────────────────────────
if [[ -s "$LOG_FILE" ]]; then
    echo "  Errors found:"
    cat "$LOG_FILE" | sed 's/^/    /'
fi

if [[ $FAILED -eq 1 ]]; then
    echo "  Validation: FAILED"
    exit 1
else
    echo "  Validation: PASSED"
    exit 0
fi
