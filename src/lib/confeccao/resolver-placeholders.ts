// Resolver de placeholders pra templates WhatsApp (RITM-16).
//
// Placeholders disponíveis:
//   {op_numero}         — número da OP
//   {produto}           — produto da OP
//   {tipo_tecido}       — tipo de tecido da Compra
//   {cor}               — cores (separadas por vírgula)
//   {kg_total}          — peso total recebido (Compra.pos)
//   {qtd_rolos}         — quantidade total de rolos
//   {largura_rolo}      — largura do rolo da Compra
//   {tamanhos}          — tamanhos da grade do Risco (P, M, G, ...)
//   {proporcao}         — proporção da grade (ex: "4M+5G+3GG")
//   {prazo}             — primeiro prazo de produção da Costura (PT-BR)
//   {fornecedor_nome}   — nome do fornecedor destinatário (passado pelo caller)
//   {tamanho_bandeira}  — tamanho da bandeira (Viés)
//   {etiquetagem}       — descrição da etiquetagem cruzada (Costura)

import type { SubtaskCompraPayload } from "./schemas/payloads/compra";
import type { SubtaskCortePayload } from "./schemas/payloads/corte";
import type { SubtaskCosturaPayload } from "./schemas/payloads/costura";
import type { SubtaskRiscoPayload } from "./schemas/payloads/risco";
import type { SubtaskViesPayload } from "./schemas/payloads/vies";

export interface ContextoPlaceholders {
  opNumero: string;
  produtoNome: string;
  fornecedorNome?: string;
  // Payloads das subtasks (qualquer um pode estar undefined se ainda
  // não preenchido)
  compra?: SubtaskCompraPayload | null;
  risco?: SubtaskRiscoPayload | null;
  corte?: SubtaskCortePayload | null;
  vies?: SubtaskViesPayload | null;
  costura?: SubtaskCosturaPayload | null;
  // Catálogos (id → nome) para resolver placeholders semânticos
  tipoTecidoNomes?: Map<string, string>;
  corNomes?: Map<string, string>;
}

const PLACEHOLDERS: Array<{
  key: string;
  resolver: (ctx: ContextoPlaceholders) => string;
}> = [
  { key: "op_numero", resolver: (c) => c.opNumero },
  { key: "produto", resolver: (c) => c.produtoNome },
  { key: "fornecedor_nome", resolver: (c) => c.fornecedorNome ?? "" },

  // Compra
  {
    key: "tipo_tecido",
    resolver: (c) => {
      const id = c.compra?.pre?.tipoTecidoId;
      if (!id) return "";
      return c.tipoTecidoNomes?.get(id) ?? "";
    },
  },
  {
    key: "cor",
    resolver: (c) => {
      const ids = c.compra?.pre?.cores?.map((co) => co.corId) ?? [];
      if (ids.length === 0 && c.vies?.corId) {
        return c.corNomes?.get(c.vies.corId) ?? "";
      }
      const nomes = ids
        .map((id) => c.corNomes?.get(id))
        .filter((n): n is string => Boolean(n));
      return nomes.join(", ");
    },
  },
  {
    key: "kg_total",
    resolver: (c) => {
      const total = (c.compra?.pos?.rolosRecebidos ?? []).reduce(
        (s, r) => s + r.pesos.reduce((s2, p) => s2 + p, 0),
        0,
      );
      return total > 0 ? total.toFixed(2) : "";
    },
  },
  {
    key: "qtd_rolos",
    resolver: (c) => {
      const total = (c.compra?.pos?.rolosRecebidos ?? []).reduce(
        (s, r) => s + r.pesos.length,
        0,
      );
      return total > 0 ? String(total) : "";
    },
  },
  {
    key: "largura_rolo",
    resolver: (c) =>
      c.compra?.pos?.larguraRoloCm !== undefined
        ? `${c.compra.pos.larguraRoloCm}cm`
        : "",
  },

  // Risco
  {
    key: "tamanhos",
    resolver: (c) =>
      (c.risco?.tamanhos ?? []).map((t) => t.tamanho).join(", "),
  },
  {
    key: "proporcao",
    resolver: (c) =>
      (c.risco?.tamanhos ?? [])
        .map((t) => `${t.proporcao}${t.tamanho}`)
        .join("+"),
  },

  // Viés
  {
    key: "tamanho_bandeira",
    resolver: (c) =>
      c.vies?.tamanhoBandeiraCm !== undefined
        ? `${c.vies.tamanhoBandeiraCm}cm`
        : "",
  },

  // Costura
  {
    key: "prazo",
    resolver: (c) => {
      const primeiroPrazo = c.costura?.oficinas?.find(
        (o) => o.prazoProducao,
      )?.prazoProducao;
      if (!primeiroPrazo) return "";
      try {
        return new Date(primeiroPrazo).toLocaleString("pt-BR");
      } catch {
        return primeiroPrazo;
      }
    },
  },
  {
    key: "etiquetagem",
    resolver: (c) => {
      const linhas: string[] = [];
      for (const o of c.costura?.oficinas ?? []) {
        for (const e of o.etiquetagem ?? []) {
          linhas.push(
            `${e.quantidade}× ${e.tamanhoEtiqueta} (de ${e.fonteGradeCorte})`,
          );
        }
      }
      return linhas.join("; ");
    },
  },
];

/**
 * Substitui todos os placeholders no corpo. Placeholders sem dado
 * disponível ficam como string vazia (não exibe "{kg_total}" literal).
 */
export function resolverPlaceholders(
  corpo: string,
  contexto: ContextoPlaceholders,
): string {
  let resultado = corpo;
  for (const { key, resolver } of PLACEHOLDERS) {
    const valor = resolver(contexto);
    resultado = resultado.replace(new RegExp(`\\{${key}\\}`, "g"), valor);
  }
  return resultado;
}

/**
 * Retorna lista de placeholders disponíveis (chave + descrição) — usado
 * pelo editor de templates pra mostrar "variáveis disponíveis".
 */
export function listarPlaceholdersDisponiveis(): Array<{
  key: string;
  descricao: string;
}> {
  return [
    { key: "op_numero", descricao: "Número da OP (ex: OP05260001)" },
    { key: "produto", descricao: "Nome do produto" },
    { key: "fornecedor_nome", descricao: "Nome do fornecedor destinatário" },
    { key: "tipo_tecido", descricao: "Tipo de tecido da Compra" },
    { key: "cor", descricao: "Cores separadas por vírgula" },
    { key: "kg_total", descricao: "Peso total em KG" },
    { key: "qtd_rolos", descricao: "Quantidade total de rolos" },
    { key: "largura_rolo", descricao: "Largura do rolo (cm)" },
    { key: "tamanhos", descricao: "Tamanhos da grade do Risco" },
    { key: "proporcao", descricao: "Proporção da grade (ex: 4M+5G+3GG)" },
    { key: "prazo", descricao: "Prazo de produção da Costura" },
    { key: "tamanho_bandeira", descricao: "Tamanho da bandeira (Viés)" },
    {
      key: "etiquetagem",
      descricao: "Etiquetagem cruzada (Costura)",
    },
  ];
}
