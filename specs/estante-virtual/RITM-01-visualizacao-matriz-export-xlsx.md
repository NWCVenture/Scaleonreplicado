# RITM-01 — Visualização Matriz (inline) + Export XLSX pivotado

> **Bloqueia:** —
> **Depende de:** módulo `estante-virtual` existente (página de detalhe em `src/app/(dashboard)/estante-virtual/page.tsx`, helpers em `src/lib/estante-utils.ts`).
> **Dependência externa:** `exceljs` (adicionar ao `package.json`).

---

## Princípio inegociável: reusar o módulo, não duplicar

- A entrada da camada de agregação é o array `EstanteFardoItem[]` **já carregado em memória** pela página de detalhe (`/api/estantes/[id]`). **Não há upload de CSV, não há parsing de arquivo, não há regex de nome de arquivo.**
- A ordem canônica de produto / cor / tamanho vem de `PRODUTO_ORDER`, `COR_ORDER`, `TAMANHO_ORDER` em `src/lib/estante-utils.ts`. **Não criar `ORDEM_COR`/`ORDEM_TAMANHO` novos.**
- Parsing de SKU usa `parseSKUParts(sku)` já existente. **Não reimplementar.**
- Ordenação de SKUs usa `compareSKU(a, b)` já existente. **Não reimplementar.**
- XLSX gerado client-side com **`exceljs`** (suporta freeze, negrito, formatos). Não usar `xlsx`/SheetJS.

---

## Objetivo

Operador na página de detalhe da estante alterna entre **Lista** (visão atual, agrupada por SKU) e **Matriz** (nova visão consolidada). Na Matriz, vê KPIs estendidos, matriz cor × tamanho, lista de caixas parciais (a consolidar) e exporta XLSX pivotado.

Ao fim do RITM:

- Toggle "Lista / Matriz" no header da página de detalhe.
- View Matriz renderiza KPIs + matriz cor×tamanho + caixas parciais.
- Botão "Baixar Relatório" vira **dropdown** com duas opções: **CSV** (cru, comportamento atual) e **XLSX** (pivotado, 5 abas). Ambos disponíveis em qualquer view (Lista ou Matriz).
- Função pura de agregação testada com fixture calibrado.
- Avisos (caixa >60, SKU fora do padrão, cor/tamanho desconhecido) exibidos em banner colapsável.

**Não inclui:**

- Upload de CSV externo (a fonte é sempre o estado da página).
- Rota nova (`/estoque/estante` ou similar) — tudo dentro de `/estante-virtual`.
- Consolidação de múltiplas estantes.
- Filtro por clique em célula da matriz (cortado do MVP — adicionar depois se demandado).
- Gráficos (barras por cor/tamanho) — opcional, só se `recharts` já estiver instalado; senão fica de fora.
- Persistência do agregado no Postgres (é derivado, gerado on-the-fly).
- Remover o export CSV atual — ele continua disponível como uma das opções do dropdown.

---

## Arquivos a criar / modificar

| Arquivo | Mudança |
|---|---|
| `src/lib/estante-virtual/agregar.ts` | **Novo** — função pura `agregarFardos(fardos, opts?)` + tipos. |
| `src/lib/estante-virtual/agregar.test.ts` | **Novo** — testes com fixture calibrado. |
| `src/lib/estante-virtual/exportar-xlsx.ts` | **Novo** — `exportarEstanteXlsx(agregado, fardos, nomeEstante)` usando `exceljs`. |
| `src/components/estante-virtual/matriz-view.tsx` | **Novo** — view Matriz completa (KPIs + matriz + parciais + banner de avisos). |
| `src/app/(dashboard)/estante-virtual/page.tsx` | Adicionar state `viewModoDetalhe: "lista" \| "matriz"`, toggle no header, renderizar `<MatrizView>` ou `<FardosAgrupados>`. Trocar o botão "Baixar Relatório" por um `DropdownMenu` shadcn com itens "CSV (cru)" e "XLSX (pivotado)". Manter `downloadCSV` existente; novo handler `handleExportXlsx` chama `exportarEstanteXlsx`. |
| `package.json` | Adicionar `exceljs` (`^4.x`). |

Nenhum componente existente é removido. `<FardosAgrupados>`, `<HistoricoView>`, `<ModalScanner>` etc. ficam intocados.

---

## §1. Camada de agregação — `src/lib/estante-virtual/agregar.ts`

### Tipos

```ts
import type { EstanteFardoItem } from "@/app/(dashboard)/estante-virtual/page"; // ou mover pra src/types

export const CAIXA_PADRAO = 60;

export type TipoAviso =
  | "caixa_acima_padrao"
  | "sku_invalido"
  | "cor_desconhecida"
  | "tamanho_desconhecido";

export interface Aviso {
  tipo: TipoAviso;
  mensagem: string;
  fardoId?: string;
}

export interface ResumoSku {
  sku: string;
  produto: string;
  cor: string;
  tamanho: string;
  pecas: number;
  numFardos: number;        // nº de registros desse SKU
  fardosCheios: number;     // registros com qtd == CAIXA_PADRAO (e qtd > 60 também conta como cheio + aviso)
  fardosParciais: number;   // registros com qtd <  CAIXA_PADRAO
}

export interface CaixaParcial {
  fardoId: string;
  sku: string;
  cor: string;
  tamanho: string;
  lote: string;
  quantidade: number;
  faltaParaCheia: number;   // CAIXA_PADRAO - quantidade
}

export interface EstanteAgregada {
  totalPecas: number;
  totalFardos: number;
  fardosCheios: number;
  fardosParciais: number;
  ocupacaoPct: number;             // capa em 100. Se há fardo >60, exibir aviso.
  lotes: string[];                 // únicos, ordenados
  porSku: ResumoSku[];             // ordenado por compareSKU
  matriz: Record<string, Record<string, number>>;  // matriz[cor][tamanho] = peças
  totaisPorCor: Record<string, number>;
  totaisPorTamanho: Record<string, number>;
  coresOrdenadas: string[];        // ordem canônica COR_ORDER, desconhecidas no fim alfabética
  tamanhosOrdenados: string[];     // ordem canônica TAMANHO_ORDER, desconhecidos no fim alfanumérica
  caixasParciais: CaixaParcial[];  // ordenado por faltaParaCheia DESC
  avisos: Aviso[];
}
```

### Regras de agregação

1. Para cada fardo: extrair `{produto, cor, tam}` via `parseSKUParts(sku)`.
   - Se `produto`, `cor` ou `tam` vier vazio (SKU com menos de 3 tokens) → adicionar aviso `sku_invalido`, **incluir nos totais**, usar `"?"` como placeholder do campo faltante na matriz/grupo.
   - Se `cor` não está em `COR_ORDER` → aviso `cor_desconhecida` (uma vez por cor, não por fardo).
   - Se `tam` não está em `TAMANHO_ORDER` → aviso `tamanho_desconhecido` (uma vez por tamanho).
2. Classificar fardo:
   - `quantidade == CAIXA_PADRAO` → cheio.
   - `quantidade <  CAIXA_PADRAO` → parcial.
   - `quantidade >  CAIXA_PADRAO` → cheio + aviso `caixa_acima_padrao` (mensagem com id e qtd).
3. `porSku`: agrupar por SKU exato, somar `pecas`, contar fardos/cheios/parciais. Ordenar por `compareSKU`.
4. `matriz[cor][tamanho]`: soma de `quantidade` (não nº de fardos). Inicializar com 0 para todas as combinações `coresOrdenadas × tamanhosOrdenados`.
5. `totaisPorCor` / `totaisPorTamanho`: somatórios das margens da matriz.
6. `coresOrdenadas`: cores que apareceram nos fardos, ordenadas — primeiro as que estão em `COR_ORDER` na ordem canônica, depois as desconhecidas em ordem alfabética. Idem para `tamanhosOrdenados` (alfanumérica para suportar numéricos futuros tipo `33`, `34`).
7. `caixasParciais`: uma entrada por fardo parcial, ordenado por `faltaParaCheia DESC` (mais vazia primeiro).
8. `ocupacaoPct`: `min(100, round((totalPecas / (totalFardos * CAIXA_PADRAO)) * 100))`. Quando há fardo >60, o número real pode passar — exibir aviso, mas o KPI fica capado.
9. `lotes`: lotes únicos extraídos dos fardos, ordenados alfabeticamente.

### Assinatura

```ts
export function agregarFardos(
  fardos: EstanteFardoItem[],
  opts?: { caixaPadrao?: number },
): EstanteAgregada
```

`caixaPadrao` default = `CAIXA_PADRAO`. Útil em teste e futura configuração.

---

## §2. View Matriz — `src/components/estante-virtual/matriz-view.tsx`

Props:

```ts
interface MatrizViewProps {
  fardos: EstanteFardoItem[];
  nomeEstante: string;
  ultimaBipagem: string | null;
}
```

Layout (de cima pra baixo, dentro do `<div className="space-y-4">` que já envolve a view de detalhe):

1. **Banner de avisos** (se `agregado.avisos.length > 0`): colapsável, padrão `<Alert variant="warning">` shadcn. Mostra contagem (ex: "3 avisos") e expande pra lista de mensagens.
2. **KPIs estendidos** (grid de 5): Total peças · Total fardos · Cheios · Parciais · Ocupação (com barra de progresso). Mesma vibe visual dos KPIs atuais da página de detalhe.
3. **Matriz cor × tamanho**: tabela. Linhas = cores (ordenadas), colunas = tamanhos (ordenados), última linha e última coluna = totais (negrito). Sem heatmap colorido (evita confusão com cor do produto e simplifica a primeira entrega). Células com 0 exibidas com cor reduzida (`text-muted-foreground/40`).
4. **Caixas a consolidar**: tabela das parciais ordenada por `faltaParaCheia` desc. Colunas: SKU · Cor · Tam · Lote · Qtd · Falta. Se vazio, exibir "Sem caixas parciais — todos os fardos estão cheios."

A matriz e a tabela de parciais devem ser legíveis em mobile (overflow-x-auto se necessário, mas totais sempre visíveis).

### Estado e cálculo

- Hook `useMemo(() => agregarFardos(fardos), [fardos])` no topo do componente. Recalcula só quando `fardos` muda.

---

## §3. Export XLSX — `src/lib/estante-virtual/exportar-xlsx.ts`

```ts
import ExcelJS from "exceljs";

export async function exportarEstanteXlsx(
  agregado: EstanteAgregada,
  fardosBrutos: EstanteFardoItem[],
  nomeEstante: string,
): Promise<void>
```

Comportamento: gera workbook, faz download client-side (`Blob` + `URL.createObjectURL`).

**Nome do arquivo:** `estante_${nomeEstante}_${ddMMyyyy}.xlsx` (mesmo padrão do CSV atual, mantendo consistência).

**Abas** (na ordem):

1. **Resumo** — pares chave/valor: Estante, Data de geração, Lotes (joined `", "`), Total peças, Total fardos, Cheios, Parciais, Ocupação %. Linha em branco. Lista de avisos abaixo (se houver), com tipo + mensagem.
2. **Matriz** — header: vazio, depois `tamanhosOrdenados`, depois "Total". Linhas: cor, valores por tamanho, total da linha. Linha final: "Total", valores `totaisPorTamanho`, `totalPecas`. Freeze do header (`worksheet.views = [{state: 'frozen', xSplit: 1, ySplit: 1}]`). Totais em **negrito**.
3. **Por SKU** — header: SKU · Produto · Cor · Tamanho · Peças · Fardos · Cheios · Parciais. Linhas = `agregado.porSku`. Freeze header.
4. **Caixas parciais** — header: SKU · Cor · Tamanho · Lote · Quantidade · Falta p/ cheia. Linhas = `agregado.caixasParciais`. Freeze header.
5. **Bruto** — header: SKU · Lote · Quantidade · Adicionado por · Data. Linhas = `fardosBrutos` (mesmo formato do CSV atual). Auditoria.

Larguras de coluna ajustadas (~12–25), sem estilos complexos além de negrito nos totais.

---

## §4. Integração na página

`src/app/(dashboard)/estante-virtual/page.tsx`:

1. Novo state: `const [viewModoDetalhe, setViewModoDetalhe] = useState<"lista" | "matriz">("lista")`.
2. No header da view de detalhe (próximo ao `<ChevronLeft />` ou alinhado à direita), adicionar um toggle (`<Tabs>` ou dois `<Button>` segmentados) com "Lista" e "Matriz".
3. Após o bloco de "Action buttons" (linha 593), renderizar condicionalmente:
   ```tsx
   {viewModoDetalhe === "lista" ? (
     <FardosAgrupados … />
   ) : (
     <MatrizView
       fardos={fardos}
       nomeEstante={selectedEstante.nome}
       ultimaBipagem={selectedEstante.ultimaBipagem}
     />
   )}
   ```
4. Manter `downloadCSV` existente. Adicionar `handleExportXlsx` que chama `exportarEstanteXlsx(agregarFardos(fardos), fardos, selectedEstante.nome)`.
5. Trocar o botão único "Baixar Relatório" por um `DropdownMenu` (shadcn) com `DropdownMenuTrigger` exibindo "Baixar Relatório ▾" e dois itens:
   - "CSV (cru)" → `downloadCSV`
   - "XLSX (pivotado)" → `handleExportXlsx`
   O dropdown fica visível em ambas as views (Lista e Matriz), mesma posição do botão atual.

---

## §5. Casos de borda

| Caso | Comportamento |
|---|---|
| Lista de fardos vazia | View Matriz renderiza KPIs zerados, matriz vazia ("Sem dados nesta estante."), sem download habilitado. |
| Fardo com `quantidade > 60` | Conta como cheio, soma `quantidade` real na matriz/totais, gera aviso `caixa_acima_padrao` (uma entrada por fardo). `ocupacaoPct` capado em 100. |
| SKU com 1 ou 2 tokens (ex: `LUA AZ` sem tamanho) | Aviso `sku_invalido`, campo faltante vira `"?"`, ainda aparece na matriz/grupo (linha/coluna "?"). Não derruba a view. |
| Cor não em `COR_ORDER` (ex: `VR`) | Aparece como linha na matriz após as conhecidas, em ordem alfabética entre as desconhecidas. Aviso `cor_desconhecida` uma vez por cor. |
| Tamanho não em `TAMANHO_ORDER` (ex: `XXG` ou `38`) | Idem cor — coluna no fim, aviso `tamanho_desconhecido` uma vez. |
| Múltiplos lotes na estante | `lotes` array com todos, mostrados no Resumo. Não há filtro por lote no MVP. |
| Estante com 5000+ fardos | Função pura roda em ms; XLSX deve gerar em <2s. Validar empiricamente. |

---

## §6. Testes obrigatórios — `src/lib/estante-virtual/agregar.test.ts`

Framework: Vitest (padrão do projeto).

Fixture base (calibrada, números fechados manualmente):

```ts
const fardosFixture: EstanteFardoItem[] = [
  // PT G — 2 cheios + 1 parcial(40)
  { id: "1", qrCode: "x", sku: "LUA PT G",  lote: "OP100", quantidade: 60, adicionadoPor: "u", createdAt: "..." },
  { id: "2", qrCode: "x", sku: "LUA PT G",  lote: "OP100", quantidade: 60, adicionadoPor: "u", createdAt: "..." },
  { id: "3", qrCode: "x", sku: "LUA PT G",  lote: "OP100", quantidade: 40, adicionadoPor: "u", createdAt: "..." },
  // AZ M — 1 cheio
  { id: "4", qrCode: "x", sku: "LUA AZ M",  lote: "OP100", quantidade: 60, adicionadoPor: "u", createdAt: "..." },
  // BR P — 1 parcial(25)
  { id: "5", qrCode: "x", sku: "LUA BR P",  lote: "OP101", quantidade: 25, adicionadoPor: "u", createdAt: "..." },
];
// Total esperado: 245 peças, 5 fardos, 3 cheios, 2 parciais
```

Cobrir:

- [ ] `totalPecas === 245`, `totalFardos === 5`, `fardosCheios === 3`, `fardosParciais === 2`.
- [ ] `matriz.PT.G === 160`, `matriz.AZ.M === 60`, `matriz.BR.P === 25`. Outras células = 0.
- [ ] `totaisPorCor.PT === 160`, `totalPorTamanho.G === 160`.
- [ ] `caixasParciais.length === 2`, ordenadas por `faltaParaCheia` desc: BR P (falta 35) antes de PT G (falta 20).
- [ ] `lotes === ["OP100", "OP101"]`.
- [ ] `coresOrdenadas` segue ordem `COR_ORDER` (AZ, BR, PT — não alfabética).
- [ ] `ocupacaoPct === round(245/(5*60)*100) === 82`.
- [ ] Fixture com 1 fardo `quantidade: 80` → conta como cheio, gera aviso `caixa_acima_padrao`, `ocupacaoPct` capado em 100.
- [ ] Fixture com SKU `"LUA AZ"` (2 tokens) → aviso `sku_invalido`, tamanho = `"?"`, aparece na matriz.
- [ ] Fixture com cor `"VR"` → aviso `cor_desconhecida` (uma só, mesmo com 3 fardos VR), aparece em `coresOrdenadas` após as conhecidas.
- [ ] Fixture vazia → totais zerados, matriz vazia, sem avisos.

Não testar `exportar-xlsx.ts` em unit (depende de DOM/Blob). Validar manualmente abrindo o XLSX gerado.

---

## §7. Critérios de aceite

- [ ] `npm test -- agregar` passa todos os casos da §6.
- [ ] Página `/estante-virtual` → detalhe de qualquer estante exibe toggle "Lista / Matriz".
- [ ] Em "Matriz": KPIs corretos, matriz com totais batendo somatórios, lista de parciais ordenada por falta desc, banner de avisos quando aplicável.
- [ ] Ordenação de cores/tamanhos segue `COR_ORDER`/`TAMANHO_ORDER` (visualmente verificável: PT antes de cor alfabeticamente anterior tipo "VR").
- [ ] Dropdown "Baixar Relatório" exibe duas opções: "CSV (cru)" e "XLSX (pivotado)".
- [ ] Item "CSV (cru)" mantém comportamento atual — mesmo conteúdo, mesmo nome de arquivo.
- [ ] Item "XLSX (pivotado)" gera arquivo com 5 abas; abrindo no Excel/LibreOffice:
  - [ ] Resumo bate os KPIs da tela.
  - [ ] Matriz tem freeze do header + negrito nos totais + valores conferindo com a UI.
  - [ ] Por SKU lista todos os SKUs com mesmas contagens.
  - [ ] Caixas parciais coincide com a lista da UI.
  - [ ] Bruto tem todos os registros originais.
- [ ] Nome do XLSX: `estante_<NOME>_<dd-MM-yyyy>.xlsx`.
- [ ] `localStorage` não é usado em momento algum (estado em memória apenas).
- [ ] Estante vazia não quebra a view.
- [ ] Performance: estante com ~200 fardos abre Matriz instantâneo; XLSX gera em <1s.
- [ ] `console.log` removido; código limpo.

---

## §8. Fora de escopo (não fazer agora)

- Consolidação de múltiplas estantes / visão de depósito inteiro.
- Persistência do agregado no Postgres.
- Filtro por clique em célula da matriz.
- Gráficos (barras por cor/tamanho).
- Filtro por lote dentro da view Matriz.
- Configuração de `CAIXA_PADRAO` por SKU/categoria.
- Heatmap colorido na matriz.
- Edição/baixa de estoque pela view (somente leitura/visualização e export).
