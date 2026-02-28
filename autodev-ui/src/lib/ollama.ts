import fs from "node:fs";
import path from "node:path";

export type AgentConfig = {
  planner_model: string;
  coder_model: string;
  repair_model: string;
  repair_model_fallback: string;
  max_retries: number;
  project_root: string;
  backend_port: string;
  frontend_port: string;
};

type OllamaTag = {
  name: string;
  model: string;
  size?: number;
  modified_at?: string;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
  };
};

type OllamaPs = {
  model?: string;
  name?: string;
  size?: number;
  size_vram?: number;
  expires_at?: string;
};

const appRoot = process.cwd();
const configPath = path.resolve(appRoot, "..", "autodev", "config", "agent.config.json");
const tasksDir = path.join(appRoot, "tasks");
const ollamaHost = "http://localhost:11434";

const defaultConfig: AgentConfig = {
  planner_model: "qwen2.5-coder:32b",
  coder_model: "qwen2.5-coder:32b",
  repair_model: "deepseek-coder:33b",
  repair_model_fallback: "qwen2.5-coder:14b",
  max_retries: 3,
  project_root: "workspace",
  backend_port: "8000",
  frontend_port: "5173",
};

export function readAgentConfig(): AgentConfig {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return { ...defaultConfig, ...(JSON.parse(raw) as Partial<AgentConfig>) };
  } catch {
    return defaultConfig;
  }
}

export function updateAgentConfig(partial: Partial<AgentConfig>): AgentConfig {
  const current = readAgentConfig();
  const next: AgentConfig = {
    ...current,
    ...partial,
    max_retries: Number(partial.max_retries ?? current.max_retries),
  };

  fs.writeFileSync(configPath, JSON.stringify(next, null, 2));
  return next;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getOllamaOverview() {
  const tags = await fetchJson<{ models?: OllamaTag[] }>(`${ollamaHost}/api/tags`);
  const ps = await fetchJson<{ models?: OllamaPs[] }>(`${ollamaHost}/api/ps`);

  return {
    serviceUp: !!tags,
    availableModels: tags?.models ?? [],
    runningModels: ps?.models ?? [],
  };
}

export function getOllamaModelLogs(lines = 120) {
  if (!fs.existsSync(tasksDir)) return [] as string[];

  const files = fs
    .readdirSync(tasksDir)
    .filter((f) => f.endsWith(".log"))
    .map((f) => path.join(tasksDir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .slice(0, 4);

  const interesting: string[] = [];
  for (const file of files) {
    try {
      const rows = fs.readFileSync(file, "utf-8").split(/\r?\n/);
      const extracted = rows.filter(
        (r) =>
          /\[(Planner|Coder|Debug|PreFlight-Repair|PreFlight-Fallback)\]/.test(r) ||
          /Phase\s+\d+:/.test(r) ||
          /All Systems Green|UAT/.test(r)
      );
      for (const row of extracted) {
        interesting.push(`[${path.basename(file)}] ${row}`);
      }
    } catch {
      // ignore bad logs
    }
  }

  return interesting.slice(-lines);
}
