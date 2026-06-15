import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function syncCopyViaExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;
  // Synchronous copy via hidden textarea + execCommand("copy"). Funciona em
  // todos os navegadores modernos e — diferente de navigator.clipboard —
  // não depende de document.hasFocus() nem é sensível a focus thrashing
  // (ex.: polling de auto-focus do scanner Coletas roubando foco no meio
  // do clique). Ficar com o caminho síncrono primeiro evita a intermitência.
  const prevActive = document.activeElement as HTMLElement | null;
  const prevSelection = document.getSelection()?.rangeCount
    ? document.getSelection()?.getRangeAt(0).cloneRange()
    : null;
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.top = "0";
  el.style.left = "0";
  el.style.opacity = "0";
  el.style.pointerEvents = "none";
  document.body.appendChild(el);
  el.focus();
  el.select();
  el.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(el);
    if (prevSelection) {
      const sel = document.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(prevSelection);
    }
    prevActive?.focus?.();
  }
  return ok;
}

export async function copyToClipboard(text: string): Promise<void> {
  // Estratégia: caminho síncrono via execCommand PRIMEIRO. É mais confiável
  // dentro de um gesto do usuário, não depende de document.hasFocus() e não
  // sofre com auto-focus polling do scanner do módulo Coletas — que estava
  // causando intermitência no botão Copiar. Async Clipboard API fica como
  // fallback caso execCommand seja bloqueado (alguns iframes/sandboxes).
  if (syncCopyViaExecCommand(text)) return;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // segue
    }
  }
  throw new Error("Falha ao copiar para a área de transferência");
}

export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function formatDate(date: Date | string | number): string {
  const d = new Date(date);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
