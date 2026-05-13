"use client";

import { Scissors } from "lucide-react";
import { PaginaCadastroSimples } from "@/components/confeccao/pagina-cadastro-simples";

export default function TiposTecidoPage() {
  return (
    <PaginaCadastroSimples
      endpoint="/api/confeccao/tipos-tecido"
      titulo="Tipos de Tecido"
      descricao="Catálogo de tipos (Helanca, Moletinho, Dry-fit, etc.)"
      singular="tipo de tecido"
      plural="tipos de tecido"
      icone={<Scissors className="size-8 text-amber-500" />}
      nomeMax={60}
    />
  );
}
