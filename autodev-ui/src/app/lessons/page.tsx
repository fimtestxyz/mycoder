"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Lesson = {
  id: string;
  phase: number;
  phase_name: string;
  status: string;
  summary: string;
};

export default function LessonsPage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [draft, setDraft] = useState({ phase: 1, phase_name: "Architecture Planning", status: "warn", summary: "" });
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/lessons", { cache: "no-store" });
    const data = await res.json();
    setLessons(data.lessons ?? []);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const create = async () => {
    if (!draft.summary.trim()) return;
    await fetch("/api/lessons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    setDraft((d) => ({ ...d, summary: "" }));
    load();
  };

  const save = async (l: Lesson) => {
    await fetch("/api/lessons", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(l),
    });
    setEditingId(null);
    load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/lessons?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  };

  return (
    <main className="min-h-screen bg-background p-3 md:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <Card className="rounded-3xl bg-card">
          <CardHeader><CardTitle>Lesson Management</CardTitle></CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-4">
            <Input type="number" value={draft.phase} onChange={(e) => setDraft({ ...draft, phase: Number(e.target.value || 1) })} placeholder="Phase" />
            <Input value={draft.phase_name} onChange={(e) => setDraft({ ...draft, phase_name: e.target.value })} placeholder="Phase name" />
            <Input value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} placeholder="Status" />
            <Input value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} placeholder="Lesson summary" />
            <div className="md:col-span-4"><Button onClick={create}>Add Lesson</Button></div>
          </CardContent>
        </Card>

        <div className="grid gap-3">
          {lessons.map((l) => (
            <motion.div key={l.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="rounded-2xl bg-card">
                <CardContent className="p-3 space-y-2">
                  <div className="text-xs text-muted-foreground">{l.id} • Phase {l.phase} • {l.phase_name}</div>
                  {editingId === l.id ? (
                    <>
                      <Input value={l.summary} onChange={(e) => setLessons((prev) => prev.map((x) => (x.id === l.id ? { ...x, summary: e.target.value } : x)))} />
                      <Input value={l.status} onChange={(e) => setLessons((prev) => prev.map((x) => (x.id === l.id ? { ...x, status: e.target.value } : x)))} />
                    </>
                  ) : (
                    <p className="text-sm">[{l.status}] {l.summary}</p>
                  )}
                  <div className="flex gap-2">
                    {editingId === l.id ? <Button size="sm" onClick={() => save(l)}>Save</Button> : <Button size="sm" variant="outline" onClick={() => setEditingId(l.id)}>Edit</Button>}
                    <Button size="sm" variant="destructive" onClick={() => remove(l.id)}>Delete</Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </main>
  );
}
