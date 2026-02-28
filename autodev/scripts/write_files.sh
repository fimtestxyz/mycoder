#!/bin/bash
# write_files.sh - Parse LLM output and write files to disk
# Handles: FILE: path\ncontent, markdown fences, multiple files

INPUT_FILE="$1"
PROJECT_ROOT="$2"

if [[ -z "$INPUT_FILE" || -z "$PROJECT_ROOT" ]]; then
    echo "Usage: $0 <input_file> <project_root>"
    exit 1
fi

if [[ ! -f "$INPUT_FILE" ]]; then
    echo "Error: Input file not found: $INPUT_FILE"
    exit 1
fi

mkdir -p "$PROJECT_ROOT"

# Use Python for robust parsing — handles edge cases bash can't
python3 - "$INPUT_FILE" "$PROJECT_ROOT" << 'PYEOF'
import sys, os, re

input_path  = sys.argv[1]
project_root = sys.argv[2]

with open(input_path, 'r', errors='replace') as f:
    content = f.read()

# Split on FILE: markers
# Pattern: "FILE: some/path.ext" followed by content until next FILE: or end
file_pattern = re.compile(r'^FILE:\s*(.+?)$', re.MULTILINE)
splits = list(file_pattern.finditer(content))

if not splits:
    print("  [write_files] WARNING: No FILE: markers found in output.")
    print("  [write_files] First 200 chars of output:")
    print("  " + content[:200].replace('\n', '\n  '))
    sys.exit(0)

files_written = 0
for i, match in enumerate(splits):
    rel_path = match.group(1).strip()

    # Security: no directory traversal
    if '..' in rel_path or rel_path.startswith('/'):
        print(f"  [write_files] SKIP unsafe path: {rel_path}")
        continue

    # Get content: from after this FILE: line to start of next FILE: (or end)
    content_start = match.end() + 1  # +1 for the newline after the FILE: line
    content_end   = splits[i+1].start() if i+1 < len(splits) else len(content)
    file_content  = content[content_start:content_end]

    # Strip markdown fences — handles all LLM output patterns:
    #   • ``` ... ```          (clean wrap)
    #   • ``` with no close    (LLM truncation)
    #   • ``` + trailing text  (LLM commentary after closing ```)
    #   • preamble + ```       (short "Here is the fix:" before fence)
    #   • no fence at all      (good model output — pass through)
    s = file_content.strip()
    if s:
        # Strip short preamble (≤3 lines) before first ```
        first_fence = s.find('```')
        if 0 < first_fence:
            pre = s[:first_fence]
            if pre.count('\n') <= 2:
                s = s[first_fence:]
        # If content starts with a fence, extract its body
        if s.startswith('```'):
            newline = s.find('\n')
            if newline >= 0:
                s = s[newline + 1:]       # drop the ```lang line
            # Strip closing ``` AND everything after it (trailing LLM commentary)
            close = re.search(r'\n```', s)
            if close:
                s = s[:close.start()]
        file_content = s

    # Remove trailing whitespace/newlines beyond one
    file_content = file_content.rstrip('\n') + '\n'

    # Write file
    full_path = os.path.join(project_root, rel_path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)

    with open(full_path, 'w') as out:
        out.write(file_content)

    print(f"  [write_files] ✅ {rel_path} ({len(file_content)} bytes)")
    files_written += 1

print(f"  [write_files] Done. {files_written} file(s) written.")
PYEOF
