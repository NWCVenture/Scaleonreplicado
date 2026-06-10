import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function copyToClipboard(text: string): Promise<void> {
  // Caminho preferencial: Clipboard API. Pode rejeitar se o documento perdeu
  // foco, se o contexto não for seguro (HTTP) ou se a permissão foi negada —
  // nesses casos caímos no fallback em vez de propagar o erro pra UI.
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // segue pro fallback
    }
  }
  if (typeof document === "undefined") {
    throw new Error("Clipboard indisponível");
  }
  // Fallback: textarea oculto + execCommand. O execCommand("copy") retorna
  // false silenciosamente se não houver seleção válida — antes o código
  // descartava esse retorno e resolvia a Promise como se tivesse copiado.
  const prevActive = document.activeElement as HTMLElement | null;
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.top = "0";
  el.style.left = "0";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.focus();
  el.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    document.body.removeChild(el);
    prevActive?.focus?.();
  }
  if (!ok) {
    throw new Error("Falha ao copiar para a área de transferência");
  }
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
