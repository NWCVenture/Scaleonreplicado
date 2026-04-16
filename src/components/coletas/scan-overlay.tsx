"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import type { TransportadoraLabel } from "@/types/coletas";
import { CARRIER_COLORS, CARRIER_DISPLAY } from "@/types/coletas";

interface ScanOverlayProps {
  visible: boolean;
  content: {
    id: string;
    isDup: boolean;
    carrier?: TransportadoraLabel;
  };
  onHide: () => void;
}

export function ScanOverlay({ visible, content, onHide }: ScanOverlayProps) {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => onHide(), 1500);
    return () => clearTimeout(timer);
  }, [visible, onHide]);

  if (!visible) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] animate-in slide-in-from-top-4 fade-in duration-300">
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border-2 backdrop-blur-md",
          content.isDup
            ? "bg-zinc-900/90 border-amber-500 text-amber-400"
            : "bg-zinc-900/90 border-green-500 text-green-400",
        )}
      >
        <div
          className={cn(
            "w-3 h-3 rounded-full animate-pulse",
            content.isDup ? "bg-amber-500" : "bg-green-500",
          )}
        />
        <span className="font-bold font-mono text-lg">
          {content.isDup ? "Duplicado" : "Bipado"}
        </span>
        <span className="font-mono text-sm opacity-75">{content.id}</span>
        {!content.isDup && content.carrier && (
          <span
            className={cn(
              "text-xs font-bold px-2 py-0.5 rounded border",
              CARRIER_COLORS[content.carrier],
            )}
          >
            {CARRIER_DISPLAY[content.carrier]}
          </span>
        )}
      </div>
    </div>
  );
}
