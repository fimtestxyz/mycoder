import { NextResponse } from "next/server";
import { getOllamaModelLogs, getOllamaOverview, readAgentConfig, updateAgentConfig } from "@/lib/ollama";

export async function GET() {
  const [ollama, config] = await Promise.all([getOllamaOverview(), Promise.resolve(readAgentConfig())]);
  const modelLogs = getOllamaModelLogs(180);
  return NextResponse.json({ ollama, config, modelLogs });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      config?: {
        planner_model?: string;
        coder_model?: string;
        repair_model?: string;
        repair_model_fallback?: string;
      };
    };

    const config = updateAgentConfig(body.config ?? {});
    return NextResponse.json({ ok: true, config });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
