"use client";

// Mini-form para cadastrar fornecedor sem sair da tela de uma OP.
// Pede só nome + número (WhatsApp). Endereço/categoria extra ficam pra
// completar depois em Cadastros > Fornecedores. A `categoriaInicial` vem
// do contexto da subtask (tecido / corte / costura / risco / vies) — sem
// ela o usuário tem que escolher manualmente.

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  ConfeccaoFornecedor,
  ConfeccaoFornecedorCategoria,
} from "@/lib/db/schema";

const CATEGORIA_LABEL: Record<ConfeccaoFornecedorCategoria, string> = {
  risco: "Risco",
  tecido: "Tecido",
  corte: "Corte",
  costura: "Costura",
  vies: "Viés",
};

const CATEGORIAS: ConfeccaoFornecedorCategoria[] = [
  "risco",
  "tecido",
  "corte",
  "costura",
  "vies",
];

export interface FormFornecedorRapidoProps {
  categoriaInicial?: ConfeccaoFornecedorCategoria;
  onCreated: (item: ConfeccaoFornecedor) => void;
  onCancel: () => void;
}

export function FormFornecedorRapido({
  categoriaInicial,
  onCreated,
  onCancel,
}: FormFornecedorRapidoProps) {
  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [categoria, setCategoria] = useState<ConfeccaoFornecedorCategoria | "">(
    categoriaInicial ?? "",
  );
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const nomeT = nome.trim();
    const whatsappT = whatsapp.trim();
    if (nomeT.length < 2) {
      toast.error("Informe o nome (mín. 2 caracteres)");
      return;
    }
    if (whatsappT.length < 8) {
      toast.error("Informe o número (mín. 8 dígitos)");
      return;
    }
    if (!categoria) {
      toast.error("Selecione a categoria");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/confeccao/fornecedores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: nomeT,
          categorias: [categoria],
          whatsapp: whatsappT,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao cadastrar fornecedor");
        return;
      }
      onCreated(data.item as ConfeccaoFornecedor);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="fr-nome">Nome *</Label>
        <Input
          id="fr-nome"
          autoFocus
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          maxLength={120}
          placeholder="Ex.: Malharia Silva"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="fr-whatsapp">Número (WhatsApp) *</Label>
        <Input
          id="fr-whatsapp"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          required
          placeholder="(11) 99999-9999"
        />
      </div>

      {!categoriaInicial && (
        <div className="space-y-2">
          <Label htmlFor="fr-categoria">Categoria *</Label>
          <select
            id="fr-categoria"
            value={categoria}
            onChange={(e) =>
              setCategoria(e.target.value as ConfeccaoFornecedorCategoria)
            }
            className="w-full h-9 rounded-md border bg-transparent px-3 text-sm"
          >
            <option value="">Selecionar…</option>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {CATEGORIA_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Endereço e demais dados podem ser completados depois em{" "}
        <strong>Cadastros &gt; Fornecedores</strong>.
      </p>

      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={saving}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
