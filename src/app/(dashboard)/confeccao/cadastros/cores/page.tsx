"use client";

import { Palette } from "lucide-react";
import { PaginaCadastroSimples } from "@/components/confeccao/pagina-cadastro-simples";

export default function CoresPage() {
  return (
    <PaginaCadastroSimples
      endpoint="/api/confeccao/cores"
      titulo="Cores"
      descricao="Cores específicas dos tecidos da confecção (separado do catálogo de SKUs)"
      singular="cor"
      plural="cores"
      icone={<Palette className="size-8 text-pink-500" />}
      nomeMax={40}
    />
  );
}
