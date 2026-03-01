import fs from "node:fs";
import path from "node:path";

export type LessonItem = {
  id: string;
  phase: number;
  phase_name: string;
  status: string;
  summary: string;
};

const appRoot = process.cwd();
const lessonsDir = path.resolve(appRoot, "..", "autodev", "lessons");

function ensureDir() {
  fs.mkdirSync(lessonsDir, { recursive: true });
}

function phaseJsonl(phase: number) {
  return path.join(lessonsDir, `phase_${phase}.jsonl`);
}

function phaseMd(phase: number) {
  return path.join(lessonsDir, `phase_${phase}.md`);
}

function rebuildPhaseMd(phase: number, items: LessonItem[]) {
  const mdPath = phaseMd(phase);
  const title = items[0]?.phase_name ?? `Phase ${phase}`;
  const lines = [`# Lessons - Phase ${phase}: ${title}`, "", ...items.map((i) => `- [${i.status.toUpperCase()}] ${i.summary}`), ""];
  fs.writeFileSync(mdPath, lines.join("\n"));
}

function readPhase(phase: number): LessonItem[] {
  const jsonl = phaseJsonl(phase);
  if (!fs.existsSync(jsonl)) return [];
  const rows = fs
    .readFileSync(jsonl, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, idx) => {
      try {
        const x = JSON.parse(line) as Omit<LessonItem, "id"> & { id?: string };
        return {
          id: x.id || `p${phase}-${idx + 1}`,
          phase,
          phase_name: x.phase_name || `Phase ${phase}`,
          status: x.status || "ok",
          summary: x.summary || "",
        } satisfies LessonItem;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as LessonItem[];
  return rows;
}

function writePhase(phase: number, items: LessonItem[]) {
  ensureDir();
  const jsonl = phaseJsonl(phase);
  const lines = items.map((i) => JSON.stringify({ phase: i.phase, phase_name: i.phase_name, status: i.status, summary: i.summary, id: i.id }));
  fs.writeFileSync(jsonl, lines.join("\n") + (lines.length ? "\n" : ""));
  rebuildPhaseMd(phase, items);
}

export function listLessons(): LessonItem[] {
  ensureDir();
  const phases = fs
    .readdirSync(lessonsDir)
    .filter((f) => /^phase_\d+\.jsonl$/.test(f))
    .map((f) => Number(f.match(/phase_(\d+)\.jsonl/)?.[1] || 0))
    .filter(Boolean)
    .sort((a, b) => a - b);

  const all = phases.flatMap((p) => readPhase(p));
  return all.sort((a, b) => b.phase - a.phase);
}

export function createLesson(input: Omit<LessonItem, "id">) {
  const phase = Number(input.phase);
  const items = readPhase(phase);
  const next: LessonItem = { ...input, phase, id: `p${phase}-${Date.now()}` };
  items.push(next);
  writePhase(phase, items);
  return next;
}

export function updateLesson(id: string, patch: Partial<Omit<LessonItem, "id">>) {
  const all = listLessons();
  const target = all.find((x) => x.id === id);
  if (!target) return null;

  const phase = target.phase;
  const items = readPhase(phase).map((x) => (x.id === id ? { ...x, ...patch, phase } : x));
  writePhase(phase, items);
  return items.find((x) => x.id === id) ?? null;
}

export function deleteLesson(id: string) {
  const all = listLessons();
  const target = all.find((x) => x.id === id);
  if (!target) return false;

  const phase = target.phase;
  const items = readPhase(phase).filter((x) => x.id !== id);
  writePhase(phase, items);
  return true;
}
