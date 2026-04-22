"use client";

import { Lock, MousePointerClick, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MobileHeaderProps {
  isMobileMenuOpen: boolean;
  onToggleMenu: () => void;
  modoLivre: boolean;
  onToggleModoLivre: () => void;
}

export function MobileHeader({
  isMobileMenuOpen,
  onToggleMenu,
  modoLivre,
  onToggleModoLivre,
}: MobileHeaderProps) {
  return (
    <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-sidebar text-sidebar-foreground border-b border-sidebar-border flex items-center justify-between p-3 gap-2">
      <img src="/logo-full.png" alt="SCALEON" className="h-8 w-auto" />
      <button
        onClick={onToggleModoLivre}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors",
          modoLivre
            ? "bg-green-500/20 text-green-300 border border-green-500/40"
            : "bg-green-700/20 text-green-400 border border-green-700/40"
        )}
      >
        {modoLivre ? (
          <MousePointerClick className="h-3.5 w-3.5" />
        ) : (
          <Lock className="h-3.5 w-3.5" />
        )}
        {modoLivre ? "Livre" : "Scanner"}
      </button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleMenu}
        className="text-sidebar-foreground"
      >
        {isMobileMenuOpen ? (
          <X className="h-5 w-5" />
        ) : (
          <Menu className="h-5 w-5" />
        )}
      </Button>
    </div>
  );
}
