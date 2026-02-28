# Local Autonomous Multi-Agent Software Development System (AutoDev)

A fully local, autonomous coding system that generates complete software projects using Ollama and Bash.

## Features

- **Local Execution**: Runs entirely on your machine using Ollama.
- **Multi-Agent Architecture**: Uses specialized agents (Planner, Decomposer, Frontend, Backend, Mobile, DevOps) to handle different aspects of development.
- **Self-Healing**: Automatically detects errors (syntax, build, test) and attempts to repair them.
- **Structured Output**: Generates clean, organized project structures.
- **Configurable**: Easily customize models and project settings.

## Prerequisites

1.  **Ollama**: Installed and running (https://ollama.com/).
    -   Ensure you have the following models pulled (or update `config/agent.config.json`):
        -   `qwen2.5-coder:32b` (Planner)
        -   `qwen2.5-coder:14b` (Coder, Frontend, Backend, Mobile, DevOps)
        -   `deepseek-coder:33b` (Repair)
    -   You can pull them via:
        ```bash
        ollama pull qwen2.5-coder:32b
        ollama pull qwen2.5-coder:14b
        ollama pull deepseek-coder:33b
        ```
2.  **jq**: JSON processor (e.g., `brew install jq`).
3.  **Node.js & npm**: For validating Node.js projects.
4.  **Python & pytest**: For validating Python projects.

## Installation

Clone this repository or copy the `autodev` folder to your workspace.

## Usage

Run the main script with your task description:

```bash
cd autodev
./autodev.sh "Build a simple Todo App with React frontend and FastAPI backend"
```

The system will:
1.  **Plan**: Generate a project architecture.
2.  **Decompose**: Break down the plan into tasks.
3.  **Execute**: Generate code for each domain (Frontend, Backend, etc.).
4.  **Validate**: Run build and tests.
5.  **Repair**: If validation fails, it will attempt to fix the errors automatically.

## Configuration

Edit `autodev/config/agent.config.json` to change models or settings:

```json
{
  "planner_model": "qwen2.5-coder:32b",
  "coder_model": "qwen2.5-coder:14b",
  "repair_model": "deepseek-coder:33b",
  "project_root": "workspace",
  "max_retries": 5
}
```

## Directory Structure

- `autodev.sh`: Main entry point.
- `config/`: Configuration files.
- `prompts/`: Agent prompt templates.
- `scripts/`: Helper scripts (`write_files.sh`, `validate.sh`).
- `logs/`: Execution logs and intermediate files.
- `workspace/`: Generated project output (default).

## Troubleshooting

-   **Ollama Errors**: Ensure Ollama is running (`ollama serve`).
-   **Model Not Found**: Check `config/agent.config.json` and ensure models are pulled.
-   **Validation Failures**: Check `logs/errors.log` and the project directory for details.
