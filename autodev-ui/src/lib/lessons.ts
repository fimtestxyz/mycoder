import fs from "node:fs";
import path from "node:path";

const appRoot = process.cwd();
const lessonsDir = path.resolve(appRoot, "..", "autodev", "lessons");

export function readPhaseLessons(phase: number, limit = 4): string[] {
  if (!phase || phase < 1) return [];
  const mdPath = path.join(lessonsDir, `phase_${phase}.md`);
  if (!fs.existsSync(mdPath)) return [];

  try {
    const lines = fs
      .readFileSync(mdPath, "utf-8")
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter((x) => x.startsWith("- ["));
    return lines.slice(-limit);
  } catch {
    return [];
  }
}
