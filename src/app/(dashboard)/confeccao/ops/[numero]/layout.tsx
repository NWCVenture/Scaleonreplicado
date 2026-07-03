"use client";

// Layout das páginas da OP — persiste entre navegações de aba, então o
// OpContextoProvider busca a OP uma vez e as trocas de página são
// instantâneas. A barra de abas é renderizada pelo provider.

import { use } from "react";
import { OpContextoProvider } from "@/components/confeccao/op-contexto";

export default function OpLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ numero: string }>;
}) {
  const { numero } = use(params);
  return <OpContextoProvider numero={numero}>{children}</OpContextoProvider>;
}
