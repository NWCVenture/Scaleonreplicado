"use client";

// Guarda de navegação pra formulários com alterações não salvas.
//
// Enquanto `ativo`:
//  - cliques em links internos (abas da OP, sidebar, etc.) pedem
//    confirmação antes de navegar — o App Router não tem bloqueio de
//    rota nativo, então interceptamos o clique na fase de captura;
//  - reload/fechar guia dispara o prompt nativo via beforeunload.
//
// Links target="_blank" não perdem estado e passam direto.

import { useEffect } from "react";

const MENSAGEM =
  "Há alterações não salvas nesta subtask. Sair mesmo assim?";

export function useAlteracoesNaoSalvas(ativo: boolean) {
  useEffect(() => {
    if (!ativo) return;

    const aoSairDaPagina = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    const aoClicarCaptura = (e: MouseEvent) => {
      const alvo = e.target as HTMLElement | null;
      const link = alvo?.closest?.("a[href]");
      if (!link) return;
      if (link.getAttribute("target") === "_blank") return;
      const href = link.getAttribute("href") ?? "";
      if (!href.startsWith("/")) return; // externos ficam pro beforeunload
      if (!window.confirm(MENSAGEM)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", aoSairDaPagina);
    document.addEventListener("click", aoClicarCaptura, true);
    return () => {
      window.removeEventListener("beforeunload", aoSairDaPagina);
      document.removeEventListener("click", aoClicarCaptura, true);
    };
  }, [ativo]);
}
