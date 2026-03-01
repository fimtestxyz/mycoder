"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ModelTag = { name: string; details?: { parameter_size?: string } };
type AgentConfig = {
  planner_model: string;
  coder_model: string;
  repair_model: string;
  repair_model_fallback: string;
};

export default function OllamaPage() {
  const [availableModels, setAvailableModels] = useState<ModelTag[]>([]);
  const [runningModels, setRunningModels] = useState<{ model?: string; name?: string }[]>([]);
  const [modelLogs, setModelLogs] = useState<string[]>([]);
  const [ollamaUp, setOllamaUp] = useState(false);
  const [config, setConfig] = useState<AgentConfig>({
    planner_model: "",
    coder_model: "",
    repair_model: "",
    repair_model_fallback: "",
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/ollama", { cache: "no-store" });
    const data = await res.json();
    setOllamaUp(!!data.ollama?.serviceUp);
    setAvailableModels(data.ollama?.availableModels ?? []);
    setRunningModels(data.ollama?.runningModels ?? []);
    setModelLogs(data.modelLogs ?? []);
    if (data.config) setConfig(data.config);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  const saveConfig = async () => {
    setBusy(true);
    await fetch("/api/ollama", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    });
    await load();
    setBusy(false);
  };

  return (
    <main className="min-h-screen bg-background p-3 md:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm text-zinc-600 hover:text-zinc-900">← Back to tasks</Link>
          <ThemeToggle />
        </div>

        <Card className="rounded-3xl border-zinc-200 bg-card shadow-sm">
          <CardHeader>
            <CardTitle>Ollama Management</CardTitle>
            <CardDescription>Service status, running models, and editable agent model config.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">Ollama status</span>
              <Badge className={ollamaUp ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"}>{ollamaUp ? "Running" : "Down"}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {runningModels.length ? runningModels.map((m, i) => <Badge key={`${m.name}-${i}`} variant="secondary">{m.name || m.model}</Badge>) : <p className="text-sm text-zinc-500">No active model process</p>}
            </div>

            {([
              ["planner_model", "Planner model"],
              ["coder_model", "Coder model"],
              ["repair_model", "Repair model"],
              ["repair_model_fallback", "Repair fallback"],
            ] as const).map(([key, label]) => (
              <div key={key} className="space-y-1">
                <p className="text-xs text-zinc-500">{label}</p>
                <select className="w-full rounded-xl border border-zinc-300 bg-card px-3 py-2 text-sm" value={config[key]} onChange={(e) => setConfig((prev) => ({ ...prev, [key]: e.target.value }))}>
                  <option value={config[key]}>{config[key] || "Select model"}</option>
                  {availableModels.map((m) => (
                    <option key={m.name} value={m.name}>{m.name} {m.details?.parameter_size ? `(${m.details.parameter_size})` : ""}</option>
                  ))}
                </select>
              </div>
            ))}

            <Button onClick={saveConfig} disabled={busy}><Save className="size-4 mr-2" />Save model config</Button>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-zinc-200 bg-card shadow-sm">
          <CardHeader>
            <CardTitle>Ollama Agent Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[46vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs">
              {modelLogs.length ? modelLogs.map((line, i) => <p key={`${i}-${line.slice(0, 20)}`} className="whitespace-pre-wrap text-zinc-700">{line}</p>) : <p className="text-zinc-500">No logs yet.</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
