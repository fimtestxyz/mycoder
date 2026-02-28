"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Play, Square, RotateCcw, Terminal, Target, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

type Status = "idle" | "running" | "stopped" | "completed" | "failed";

type State = {
  status: Status;
  goal: string;
  pid: number | null;
  startedAt: string | null;
  updatedAt: string;
  currentPhase: number;
  phaseTitle: string;
  progress: number;
  lastSummary: string;
  exitCode: number | null;
};

export default function Home() {
  const [goal, setGoal] = useState("");
  const [state, setState] = useState<State | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const goalInitialized = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/autodev?lines=240", { cache: "no-store" });
    const data = await res.json();
    setState(data.state);
    setLogs(data.logs ?? []);

    // Initialize input once from backend state, then never overwrite user typing.
    if (!goalInitialized.current && data.state?.goal) {
      setGoal(data.state.goal);
      goalInitialized.current = true;
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [load]);

  const runAction = async (action: "start" | "stop" | "resume") => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/autodev", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, goal }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Request failed");
      }
      setState(data.state);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const statusColor = useMemo(() => {
    switch (state?.status) {
      case "running":
        return "bg-emerald-500";
      case "completed":
        return "bg-blue-500";
      case "failed":
        return "bg-rose-500";
      case "stopped":
        return "bg-amber-500";
      default:
        return "bg-zinc-500";
    }
  }, [state?.status]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-black text-zinc-100 p-4 md:p-8">
      <div className="mx-auto max-w-7xl grid gap-4 md:gap-6 lg:grid-cols-5">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="lg:col-span-3">
          <Card className="border-zinc-800/80 bg-zinc-900/60 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-2xl flex items-center gap-2"><Target className="size-5" /> AutoDev Control Center</CardTitle>
              <CardDescription>Input a goal and orchestrate autodev.sh with start / stop / resume controls.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                value={goal}
                onChange={(e) => {
                  goalInitialized.current = true;
                  setGoal(e.target.value);
                }}
                placeholder="e.g. Build a multi-tenant SaaS dashboard with Stripe billing"
                className="h-12 text-base"
              />

              <div className="flex flex-wrap gap-2">
                <Button disabled={busy || !goal || state?.status === "running"} onClick={() => runAction("start")}>
                  <Play className="mr-2 size-4" /> Start
                </Button>
                <Button variant="secondary" disabled={busy || state?.status !== "running"} onClick={() => runAction("stop")}>
                  <Square className="mr-2 size-4" /> Stop
                </Button>
                <Button variant="outline" disabled={busy || state?.status === "running" || !goal} onClick={() => runAction("resume")}>
                  <RotateCcw className="mr-2 size-4" /> Resume
                </Button>
              </div>

              {error && <p className="text-sm text-rose-400">{error}</p>}
            </CardContent>
          </Card>

          <Card className="mt-4 border-zinc-800/80 bg-zinc-900/60 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Terminal className="size-4" /> Live Logs</CardTitle>
              <CardDescription>Auto-refresh every 2 seconds.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[380px] rounded-md border border-zinc-800 bg-black/50 p-3 font-mono text-xs md:text-sm">
                {logs.length === 0 ? (
                  <p className="text-zinc-500">No logs yet. Start a run to stream output.</p>
                ) : (
                  logs.map((line, idx) => (
                    <motion.p key={`${idx}-${line.slice(0, 20)}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="whitespace-pre-wrap break-words text-zinc-200/90">
                      {line}
                    </motion.p>
                  ))
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="lg:col-span-2 space-y-4">
          <Card className="border-zinc-800/80 bg-zinc-900/60 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Activity className="size-4" /> Run Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Badge className={`${statusColor} text-white border-0 capitalize`}>{state?.status ?? "idle"}</Badge>
                <span className="text-xs text-zinc-400">PID: {state?.pid ?? "-"}</span>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-zinc-300">
                  <span>Phase {state?.currentPhase ?? 0}/8</span>
                  <span>{state?.progress ?? 0}%</span>
                </div>
                <Progress value={state?.progress ?? 0} className="h-2" />
                <p className="text-sm text-zinc-300">{state?.phaseTitle ?? "Waiting"}</p>
              </div>

              <Separator className="bg-zinc-800" />

              <div className="space-y-1 text-sm">
                <p className="text-zinc-400">Goal</p>
                <p className="line-clamp-3">{state?.goal || "-"}</p>
              </div>
              <div className="space-y-1 text-sm">
                <p className="text-zinc-400">Summary</p>
                <p>{state?.lastSummary || "No updates yet."}</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </main>
  );
}
