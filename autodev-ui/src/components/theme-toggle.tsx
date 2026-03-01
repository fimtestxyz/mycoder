"use client";

import { useEffect, useState } from "react";

const THEME_KEY = "autodev.theme.v1";

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    return localStorage.getItem(THEME_KEY) || "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const onChange = (next: string) => {
    setTheme(next);
    localStorage.setItem(THEME_KEY, next);
    document.documentElement.setAttribute("data-theme", next);
  };

  return (
    <select
      value={theme}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-zinc-300 bg-white/90 px-2 py-1 text-xs"
      title="Theme"
    >
      <option value="light">Light</option>
      <option value="tokyo-night">Tokyo Night</option>
      <option value="vscode-dark">VSCode Dark</option>
    </select>
  );
}
