export const SIZES = ["P", "M", "G", "GG", "EGG"] as const;
export type Size = (typeof SIZES)[number];

export function extractSize(sku: string): Size | null {
  const parts = sku.trim().toUpperCase().split(/\s+/);
  for (const part of parts) {
    if ((SIZES as readonly string[]).includes(part)) return part as Size;
  }
  return null;
}

export function replaceSize(sku: string, newSize: Size): string {
  const parts = sku.trim().toUpperCase().split(/\s+/);
  const current = extractSize(sku);
  if (!current) return `${sku.trim().toUpperCase()} ${newSize}`;
  return parts.map((p) => (p === current ? newSize : p)).join(" ");
}

export type AlteracaoEstoqueRecord = {
  id: string;
  saidas: Array<{ sku: string; quantidade: number }>;
  entradas: Array<{ sku: string; quantidade: number }>;
  codigoPacote: string | null;
  usuarioId: string | null;
  usuarioNome: string | null;
  revisado: boolean;
  revisadoPor: string | null;
  revisadoPorNome: string | null;
  revisadoEm: string | null;
  createdAt: string;
};

export function formatItens(
  itens: Array<{ sku: string; quantidade: number }>,
): string {
  return itens.map((i) => `${i.sku} (${i.quantidade})`).join(", ");
}

function fmtDate(ts: string): string {
  return new Date(ts).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function filterByDate(
  registros: AlteracaoEstoqueRecord[],
  filtros?: { dataInicio?: string; dataFim?: string },
): AlteracaoEstoqueRecord[] {
  if (!filtros) return registros;
  return registros.filter((r) => {
    const d = new Date(r.createdAt);
    if (filtros.dataInicio && d < new Date(filtros.dataInicio)) return false;
    if (filtros.dataFim) {
      const fim = new Date(filtros.dataFim);
      fim.setHours(23, 59, 59, 999);
      if (d > fim) return false;
    }
    return true;
  });
}

export function gerarRelatorioGeral(
  registros: AlteracaoEstoqueRecord[],
  filtros?: { dataInicio?: string; dataFim?: string },
): string {
  const filtered = filterByDate(registros, filtros);
  const linhas: string[] = [
    "=".repeat(100),
    "RELATÓRIO GERAL DE ALTERAÇÕES DE ESTOQUE",
    "=".repeat(100),
    `Período: ${filtros?.dataInicio || "Início"} até ${filtros?.dataFim || "Fim"}`,
    `Total de registros: ${filtered.length}`,
    `Data de geração: ${new Date().toLocaleString("pt-BR")}`,
    "",
    "Data/Hora | Saída | Entrada | Pacote | Status | Revisado Por",
    "-".repeat(100),
  ];

  filtered.forEach((item) => {
    const data = fmtDate(item.createdAt);
    const saida = formatItens(item.saidas);
    const entrada = formatItens(item.entradas);
    const status = item.revisado ? "✓ Revisado" : "⏳ Pendente";
    const revisadoPor = item.revisadoPorNome || "-";
    const revisadoInfo = item.revisado && item.revisadoEm
      ? `${revisadoPor} em ${fmtDate(item.revisadoEm)}`
      : revisadoPor;
    linhas.push(
      `${data} | ${saida} → ${entrada} | ${item.codigoPacote || "-"} | ${status} | ${revisadoInfo}`,
    );
  });

  return linhas.join("\n");
}

export function gerarRelatorioResumido(
  registros: AlteracaoEstoqueRecord[],
  filtros?: { dataInicio?: string; dataFim?: string },
): string {
  const filtered = filterByDate(registros, filtros);
  const linhas: string[] = [
    "=".repeat(100),
    "RELATÓRIO RESUMIDO DE ALTERAÇÕES DE ESTOQUE",
    "=".repeat(100),
    `Período: ${filtros?.dataInicio || "Início"} até ${filtros?.dataFim || "Fim"}`,
    `Total de registros: ${filtered.length}`,
    `Data de geração: ${new Date().toLocaleString("pt-BR")}`,
    "",
    "SAÍDAS TOTAIS POR SKU:",
    "-".repeat(100),
  ];

  const saidasAgrupadas: Record<string, number> = {};
  filtered.forEach((item) => {
    item.saidas.forEach((s) => {
      saidasAgrupadas[s.sku] = (saidasAgrupadas[s.sku] || 0) + s.quantidade;
    });
  });

  Object.entries(saidasAgrupadas)
    .sort((a, b) => b[1] - a[1])
    .forEach(([sku, total]) => {
      linhas.push(`SAÍDA ${sku}: ${total}`);
    });

  linhas.push("", "ENTRADAS TOTAIS POR SKU:", "-".repeat(100));

  const entradasAgrupadas: Record<string, number> = {};
  filtered.forEach((item) => {
    item.entradas.forEach((e) => {
      entradasAgrupadas[e.sku] = (entradasAgrupadas[e.sku] || 0) + e.quantidade;
    });
  });

  Object.entries(entradasAgrupadas)
    .sort((a, b) => b[1] - a[1])
    .forEach(([sku, total]) => {
      linhas.push(`ENTRADA ${sku}: ${total}`);
    });

  const totalSaidas = Object.values(saidasAgrupadas).reduce(
    (sum, qtd) => sum + qtd,
    0,
  );
  const totalEntradas = Object.values(entradasAgrupadas).reduce(
    (sum, qtd) => sum + qtd,
    0,
  );

  linhas.push(
    "",
    "TOTAIS GERAIS:",
    "-".repeat(100),
    `Total de Saídas: ${totalSaidas}`,
    `Total de Entradas: ${totalEntradas}`,
    `Diferença: ${totalEntradas - totalSaidas}`,
  );

  return linhas.join("\n");
}

export function gerarRelatorioSaidas(
  registros: AlteracaoEstoqueRecord[],
): string {
  const date = new Date().toLocaleString("pt-BR");
  const linhas: string[] = [
    "=".repeat(80),
    "RELATÓRIO DE SAÍDAS",
    "=".repeat(80),
    `Gerado em: ${date}`,
    `Total de registros: ${registros.length}`,
    "",
    "Data/Hora              | SKU Saída                    | Qtd | Pacote",
    "-".repeat(80),
  ];

  const totaisSaida: Record<string, number> = {};
  registros.forEach((item) => {
    const data = fmtDate(item.createdAt);
    const skuSaida = formatItens(item.saidas);
    const qtdTotal = item.saidas.reduce((s, i) => s + i.quantidade, 0);
    linhas.push(
      `${data.padEnd(22)} | ${skuSaida.padEnd(28)} | ${String(qtdTotal).padEnd(3)} | ${item.codigoPacote || "-"}`,
    );
    item.saidas.forEach((i) => {
      totaisSaida[i.sku] = (totaisSaida[i.sku] || 0) + i.quantidade;
    });
  });

  linhas.push("", "=".repeat(80), "TOTAIS POR SKU (SAÍDA)", "=".repeat(80));
  Object.entries(totaisSaida)
    .sort((a, b) => b[1] - a[1])
    .forEach(([sku, qtd]) => {
      linhas.push(`${sku.padEnd(30)} : ${qtd} peças`);
    });

  return linhas.join("\n");
}

export function gerarRelatorioEntradas(
  registros: AlteracaoEstoqueRecord[],
): string {
  const date = new Date().toLocaleString("pt-BR");
  const linhas: string[] = [
    "=".repeat(80),
    "RELATÓRIO DE ENTRADAS",
    "=".repeat(80),
    `Gerado em: ${date}`,
    `Total de registros: ${registros.length}`,
    "",
    "Data/Hora              | SKU Entrada                  | Qtd | Pacote",
    "-".repeat(80),
  ];

  const totaisEntrada: Record<string, number> = {};
  registros.forEach((item) => {
    const data = fmtDate(item.createdAt);
    const skuEntrada = formatItens(item.entradas);
    const qtdTotal = item.entradas.reduce((s, i) => s + i.quantidade, 0);
    linhas.push(
      `${data.padEnd(22)} | ${skuEntrada.padEnd(28)} | ${String(qtdTotal).padEnd(3)} | ${item.codigoPacote || "-"}`,
    );
    item.entradas.forEach((i) => {
      totaisEntrada[i.sku] = (totaisEntrada[i.sku] || 0) + i.quantidade;
    });
  });

  linhas.push(
    "",
    "=".repeat(80),
    "TOTAIS POR SKU (ENTRADA)",
    "=".repeat(80),
  );
  Object.entries(totaisEntrada)
    .sort((a, b) => b[1] - a[1])
    .forEach(([sku, qtd]) => {
      linhas.push(`${sku.padEnd(30)} : ${qtd} peças`);
    });

  return linhas.join("\n");
}

export function downloadTxt(conteudo: string, filename: string): void {
  const blob = new Blob([conteudo], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
