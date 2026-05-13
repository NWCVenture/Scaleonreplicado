"use client";

// Formulário compartilhado de criar/editar fornecedor.
// Usado pela página de listagem (modal) e pelo cadastro inline em outros lugares.

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  ConfeccaoFornecedor,
  ConfeccaoFornecedorCategoria,
} from "@/lib/db/schema";

const CATEGORIAS: { value: ConfeccaoFornecedorCategoria; label: string }[] = [
  { value: "risco", label: "Risco" },
  { value: "tecido", label: "Tecido" },
  { value: "corte", label: "Corte" },
  { value: "costura", label: "Costura" },
  { value: "vies", label: "Viés" },
];

export interface FormFornecedorState {
  nome: string;
  categorias: ConfeccaoFornecedorCategoria[];
  whatsapp: string;
  telefoneE164: string;
  enderecoRua: string;
  enderecoNumero: string;
  enderecoComplemento: string;
  enderecoBairro: string;
  enderecoCep: string;
  enderecoCidade: string;
  enderecoEstado: string;
  contatoNome: string;
  observacoes: string;
}

function emptyForm(): FormFornecedorState {
  return {
    nome: "",
    categorias: [],
    whatsapp: "",
    telefoneE164: "",
    enderecoRua: "",
    enderecoNumero: "",
    enderecoComplemento: "",
    enderecoBairro: "",
    enderecoCep: "",
    enderecoCidade: "",
    enderecoEstado: "",
    contatoNome: "",
    observacoes: "",
  };
}

export function fornecedorParaForm(
  f: ConfeccaoFornecedor,
): FormFornecedorState {
  return {
    nome: f.nome,
    categorias: f.categorias,
    whatsapp: f.whatsapp,
    telefoneE164: f.telefoneE164 ?? "",
    enderecoRua: f.enderecoRua,
    enderecoNumero: f.enderecoNumero,
    enderecoComplemento: f.enderecoComplemento ?? "",
    enderecoBairro: f.enderecoBairro,
    enderecoCep: f.enderecoCep,
    enderecoCidade: f.enderecoCidade,
    enderecoEstado: f.enderecoEstado,
    contatoNome: f.contatoNome ?? "",
    observacoes: f.observacoes ?? "",
  };
}

export interface FormFornecedorProps {
  initial?: FormFornecedorState;
  fornecedorId?: string; // se existe, PATCH; senão POST
  onSuccess: (fornecedor: ConfeccaoFornecedor) => void;
  onCancel: () => void;
}

export function FormFornecedor({
  initial,
  fornecedorId,
  onSuccess,
  onCancel,
}: FormFornecedorProps) {
  const [form, setForm] = useState<FormFornecedorState>(initial ?? emptyForm());
  const [saving, setSaving] = useState(false);

  function set<K extends keyof FormFornecedorState>(
    key: K,
    value: FormFornecedorState[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleCategoria(cat: ConfeccaoFornecedorCategoria) {
    setForm((prev) => ({
      ...prev,
      categorias: prev.categorias.includes(cat)
        ? prev.categorias.filter((c) => c !== cat)
        : [...prev.categorias, cat],
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.categorias.length === 0) {
      toast.error("Selecione pelo menos uma categoria");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nome: form.nome.trim(),
        categorias: form.categorias,
        whatsapp: form.whatsapp.trim(),
        telefoneE164: form.telefoneE164.trim() || null,
        enderecoRua: form.enderecoRua.trim(),
        enderecoNumero: form.enderecoNumero.trim(),
        enderecoComplemento: form.enderecoComplemento.trim() || null,
        enderecoBairro: form.enderecoBairro.trim(),
        enderecoCep: form.enderecoCep.trim(),
        enderecoCidade: form.enderecoCidade.trim(),
        enderecoEstado: form.enderecoEstado.trim().toUpperCase(),
        contatoNome: form.contatoNome.trim() || null,
        observacoes: form.observacoes.trim() || null,
      };
      const url = fornecedorId
        ? `/api/confeccao/fornecedores/${fornecedorId}`
        : `/api/confeccao/fornecedores`;
      const method = fornecedorId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao salvar");
        return;
      }
      toast.success(fornecedorId ? "Atualizado" : "Criado");
      onSuccess(data.item as ConfeccaoFornecedor);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
      <div className="space-y-2">
        <Label htmlFor="nome">Nome *</Label>
        <Input
          id="nome"
          value={form.nome}
          onChange={(e) => set("nome", e.target.value)}
          required
          maxLength={120}
        />
      </div>

      <div className="space-y-2">
        <Label>Categorias *</Label>
        <div className="grid grid-cols-2 gap-2">
          {CATEGORIAS.map((c) => (
            <label
              key={c.value}
              className="flex items-center gap-2 text-sm rounded border p-2 cursor-pointer hover:bg-accent/40"
            >
              <Checkbox
                checked={form.categorias.includes(c.value)}
                onCheckedChange={() => toggleCategoria(c.value)}
              />
              {c.label}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="whatsapp">WhatsApp *</Label>
          <Input
            id="whatsapp"
            placeholder="(11) 99999-9999"
            value={form.whatsapp}
            onChange={(e) => set("whatsapp", e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tel">Telefone E.164 (Lalamove API)</Label>
          <Input
            id="tel"
            placeholder="+5511999999999"
            value={form.telefoneE164}
            onChange={(e) => set("telefoneE164", e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-2">
          <Label htmlFor="rua">Rua *</Label>
          <Input
            id="rua"
            value={form.enderecoRua}
            onChange={(e) => set("enderecoRua", e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="num">Número *</Label>
          <Input
            id="num"
            value={form.enderecoNumero}
            onChange={(e) => set("enderecoNumero", e.target.value)}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="compl">Complemento</Label>
          <Input
            id="compl"
            value={form.enderecoComplemento}
            onChange={(e) => set("enderecoComplemento", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bairro">Bairro *</Label>
          <Input
            id="bairro"
            value={form.enderecoBairro}
            onChange={(e) => set("enderecoBairro", e.target.value)}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2">
          <Label htmlFor="cep">CEP *</Label>
          <Input
            id="cep"
            placeholder="01310-100"
            value={form.enderecoCep}
            onChange={(e) => set("enderecoCep", e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cidade">Cidade *</Label>
          <Input
            id="cidade"
            value={form.enderecoCidade}
            onChange={(e) => set("enderecoCidade", e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="estado">UF *</Label>
          <Input
            id="estado"
            placeholder="SP"
            maxLength={2}
            value={form.enderecoEstado}
            onChange={(e) =>
              set("enderecoEstado", e.target.value.toUpperCase())
            }
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="contato">Pessoa de contato</Label>
        <Input
          id="contato"
          value={form.contatoNome}
          onChange={(e) => set("contatoNome", e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="obs">Observações</Label>
        <Textarea
          id="obs"
          value={form.observacoes}
          onChange={(e) => set("observacoes", e.target.value)}
          rows={3}
          maxLength={1000}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
