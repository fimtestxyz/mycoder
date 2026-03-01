"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

const links = [
  { href: "/", label: "Tasks" },
  { href: "/lessons", label: "Lessons" },
  { href: "/ollama", label: "Ollama" },
];

export function TopNavbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-3 md:px-6">
        <div className="flex items-center gap-2 md:gap-4">
          <span className="text-sm font-semibold">AutoDev UI</span>
          <nav className="flex items-center gap-1">
            {links.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-md px-2 py-1 text-xs transition ${
                    active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
