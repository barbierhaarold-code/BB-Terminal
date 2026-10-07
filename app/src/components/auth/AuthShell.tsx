import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-term-bg flex flex-col items-center justify-center px-4 gap-8 relative">
      <div className="absolute top-3 right-3"><ThemeToggle /></div>
      <div className="flex items-center gap-3 select-none">
        <span className="w-2 h-2 bg-term-amber shadow-[0_0_8px_rgba(180,92,255,0.9)]" />
        <span className="text-term-amber font-bold tracking-[0.35em] text-[18px]">ABDEL KHADER</span>
      </div>
      {children}
    </div>
  );
}
