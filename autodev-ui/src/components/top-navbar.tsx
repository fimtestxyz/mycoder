"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

const links = [
  { href: "/", label: "Tasks" },
  { href: "/lessons", label: "Lessons" },
  { href: "/ollama", label: "Ollama" },
];

export function TopNavbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-3 md:px-6">
        <div className="flex items-center gap-2 md:gap-4">
          <motion.span
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-sm font-semibold"
          >
            AutoDev UI
          </motion.span>

          <nav className="hidden items-center gap-1 md:flex">
            {links.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link key={link.href} href={link.href} className="relative rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                  {active && (
                    <motion.span
                      layoutId="topnav-active-pill"
                      className="absolute inset-0 rounded-md bg-primary"
                      transition={{ type: "spring", stiffness: 320, damping: 26 }}
                    />
                  )}
                  <span className={`relative z-10 ${active ? "text-primary-foreground" : ""}`}>{link.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md border border-border p-1 md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle navigation"
          >
            {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-border md:hidden"
          >
            <div className="mx-auto max-w-7xl space-y-1 px-3 py-2">
              {links.map((link) => {
                const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileOpen(false)}
                    className={`block rounded-md px-2 py-2 text-sm transition ${
                      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
