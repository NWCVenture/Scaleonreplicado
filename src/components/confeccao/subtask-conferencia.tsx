"use client";

// Conteúdo da subtask OPCONF (Conferência) — RITM-13.
//
// Container de subconferências (uma por retirada). Cada subconferência
// tem 3 blocos: quantitativa (contagem oculta), inspeção visual,
// destinação. Subtask só fecha quando todas concluídas + todas
// oficinas da Costura finalizadas.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LookupUsuarioConta } from "@/components/confeccao/lookup-usuario-conta";
import { UploadAnexo } from "@/components/confeccao/upload-anexo";
import { SubtaskStatusSelect } from "@/components/confeccao/subtask-status-select";
import {
  compararMatrizes,
  somarMatriz,
  TIPOS_DEFEITO,
  type DestinoReprovadas,
  type MatrizPecas,
  type TipoDefeito,
} from "@/lib/confeccao/schemas/subconferencia";
import {
  TAMANHOS_GRADE_RISCO,
  type TamanhoGradeRisco,
} from "@/lib/confeccao/schemas/payloads/risco";
import type { ConfeccaoSubtask } from "@/lib/db/schema";

interface SubtaskConferenciaProps {
  subtask: ConfeccaoSubtask;
  opNumero: string;
  contaId: string;
  onAlterado: () => void;
}

interface CorRef {
  id: string;
  nome: string;
}

// A peça chega da Costura já etiquetada — o tamanho recebido pode ser
// qualquer um da grade comercial (ex.: P etiquetado a partir de M),
// independente dos tamanhos cortados no Risco.
const TAMANHOS_TODOS: TamanhoGradeRisco[] = [...TAMANHOS_GRADE_RISCO];

interface SubconferenciaItem {
  id: string;
  numero: string;
  status: "em_andamento" | "concluida" | "bloqueada" | "pendente" | "cancelada";
  retiradaId: string;
  retiradaNumero: string;
  retiradaTipo: "parcial" | "final";
  retiradaData: string;
  retiradaPecasPorTamanhoCor: MatrizPecas;
  oficinaId: string;
  oficinaNome: string;
  pecasRecebidas: MatrizPecas | null;
  divergenciaConfirmada: boolean;
  oficinaResponsavelDivergenciaId: string | null;
  quantidadeRevelada: boolean;
  responsavelInspecaoId: string | null;
  aprovadas: MatrizPecas | null;
  reprovadas: MatrizPecas | null;
  tiposDefeito: TipoDefeito[] | null;
  dataInspecao: string | null;
  destinoReprovadas: DestinoReprovadas | null;
  localizacaoArmazem: string | null;
  concluidaEm: string | null;
}

export function SubtaskConferencia({
  subtask,
  opNumero,
  contaId,
  onAlterado,
}: SubtaskConferenciaProps) {
  const router = useRouter();

  const podeEditar =
    subtask.status === "em_andamento" || subtask.status === "pendente";

  const [subconfs, setSubconfs] = useState<SubconferenciaItem[]>([]);
  const [cores, setCores] = useState<CorRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());

  const fetchTudo = useCallback(async () => {
    setLoading(true);
    try {
      // Subconferências
      const res = await fetch(
        `/api/confeccao/subtasks/${subtask.id}/subconferencias`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { items: SubconferenciaItem[] };
      setSubconfs(data.items);

      // Auto-expande primeira em_andamento
      setExpandidas((prev) => {
        if (prev.size > 0) return prev;
        const ativa = data.items.find((s) => s.status === "em_andamento");
        return ativa ? new Set([ativa.id]) : new Set();
      });

      // Cores fixas da OP: as contratadas na Compra (OPBUY)
      const resOp = await fetch(`/api/confeccao/ops/${opNumero}`, {
        cache: "no-store",
      });
      const idsCores: string[] = [];
      if (resOp.ok) {
        const opData = (await resOp.json()) as {
          subtasks: Array<{ prefixo: string; payload: unknown }>;
        };
        const compra = opData.subtasks.find((s) => s.prefixo === "OPBUY")
          ?.payload as
          | { fornecedores?: Array<{ cores?: Array<{ corId: string }> }> }
          | undefined;
        for (const f of compra?.fornecedores ?? []) {
          for (const c of f.cores ?? []) {
            if (c.corId && !idsCores.includes(c.corId)) idsCores.push(c.corId);
          }
        }
      }
      // União com cores já registradas nas subconferências, pra dado
      // antigo não sumir da grade
      for (const s of data.items) {
        for (const m of [
          s.pecasRecebidas,
          s.aprovadas,
          s.reprovadas,
          s.retiradaPecasPorTamanhoCor,
        ]) {
          for (const porCor of Object.values(m ?? {})) {
            for (const corId of Object.keys(porCor)) {
              if (!idsCores.includes(corId)) idsCores.push(corId);
            }
          }
        }
      }

      // Resolve nomes; se a Compra não tem cores, cai pro catálogo completo
      const resCor = await fetch(
        `/api/confeccao/cores?pageSize=100&incluirInativos=true`,
        { cache: "no-store" },
      );
      if (resCor.ok) {
        const dataCor = (await resCor.json()) as {
          items: Array<{ id: string; nome: string }>;
        };
        if (idsCores.length > 0) {
          const nomes = new Map(dataCor.items.map((c) => [c.id, c.nome]));
          setCores(idsCores.map((id) => ({ id, nome: nomes.get(id) ?? "?" })));
        } else {
          setCores(dataCor.items);
        }
      }
    } catch {
      toast.error("Erro ao carregar dados da Conferência");
    } finally {
      setLoading(false);
    }
  }, [subtask.id, opNumero]);

  useEffect(() => {
    void fetchTudo();
  }, [fetchTudo]);

  function toggleExpand(id: string) {
    setExpandidas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground p-4">Carregando…</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="font-medium">Conferência</h3>
          <p className="text-xs text-muted-foreground">
            Container de subconferências (uma por retirada da Costura). Cada
            uma tem 3 blocos: quantitativa, inspeção visual, destinação.
          </p>
        </div>
        <SubtaskStatusSelect
          subtaskId={subtask.id}
          subtaskNumero={subtask.numero}
          status={subtask.status}
          onMudou={() => {
            onAlterado();
            router.refresh();
          }}
        />
      </div>

      {subconfs.length === 0 ? (
        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            Nenhuma subconferência ainda. Aguarde a primeira retirada da
            Costura — ela cria a primeira subconferência aqui automaticamente.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {subconfs.map((sc) => (
            <SubconferenciaCard
              key={sc.id}
              sc={sc}
              opNumero={opNumero}
              contaId={contaId}
              cores={cores}
              expandido={expandidas.has(sc.id)}
              podeEditar={podeEditar}
              onToggle={() => toggleExpand(sc.id)}
              onAlterada={fetchTudo}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Card de uma subconferência (3 blocos)
// ============================================================

function SubconferenciaCard({
  sc,
  opNumero,
  contaId,
  cores,
  expandido,
  podeEditar,
  onToggle,
  onAlterada,
}: {
  sc: SubconferenciaItem;
  opNumero: string;
  contaId: string;
  cores: CorRef[];
  expandido: boolean;
  podeEditar: boolean;
  onToggle: () => void;
  onAlterada: () => void;
}) {
  const concluida = sc.status === "concluida";
  const editavel = podeEditar && !concluida;

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          className="w-full flex items-center justify-between"
          onClick={onToggle}
        >
          <div className="flex items-center gap-2">
            {expandido ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
            <CardTitle className="text-base font-mono">{sc.numero}</CardTitle>
            <Badge variant={sc.retiradaTipo === "final" ? "secondary" : "outline"}>
              {sc.retiradaTipo === "final" ? "Final" : "Parcial"}
            </Badge>
            {concluida && (
              <Badge variant="default">
                <Check className="size-3 mr-1" />
                Concluída
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {sc.oficinaNome} • {new Date(sc.retiradaData).toLocaleDateString("pt-BR")}
          </div>
        </button>
      </CardHeader>
      {expandido && (
        <CardContent className="space-y-6">
          <Bloco1Contagem
            sc={sc}
            cores={cores}
            editavel={editavel}
            onAlterada={onAlterada}
          />
          <Bloco2Inspecao
            sc={sc}
            opNumero={opNumero}
            contaId={contaId}
            cores={cores}
            tamanhos={TAMANHOS_TODOS}
            editavel={editavel}
            onAlterada={onAlterada}
          />
          <Bloco3Destinacao
            sc={sc}
            editavel={editavel}
            onAlterada={onAlterada}
          />
          {!concluida && editavel && (
            <ConcluirSubconferenciaBotao sc={sc} onAlterada={onAlterada} />
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ============================================================
// Bloco 1 — Conferência quantitativa (contagem oculta)
// ============================================================

// Contagem espelhando a ficha física, com UMA TABELA POR COR: cada tabela
// tem linhas de lançamento (fardo) com tamanho + quantidade. Linhas com o
// mesmo tamanho somam na matriz salva. Preencheu a última linha da tabela
// da cor, outra nasce abaixo herdando o tamanho.
interface LinhaContagem {
  id: string;
  tamanho: TamanhoGradeRisco | "";
  valor: string;
}

// Uma única linha inicial: as próximas nascem na digitação e herdam o
// tamanho da anterior — com várias linhas pré-criadas o tamanho viria
// vazio e teria que ser selecionado à mão em cada uma.
const LINHAS_INICIAIS = 1;

function novaLinhaContagem(
  tamanho: TamanhoGradeRisco | "" = "",
): LinhaContagem {
  return { id: Math.random().toString(36).slice(2), tamanho, valor: "" };
}

// Linha conta como "preenchida" quando tem quantidade digitada. O tamanho
// sozinho não conta — a linha nova herda o tamanho da anterior, e isso
// não pode disparar outra linha em cascata.
function linhaPreenchida(l: LinhaContagem): boolean {
  return l.valor.trim() !== "";
}

// Garante o mínimo de linhas e sempre uma linha vazia no fim da tabela.
function completarLinhas(linhas: LinhaContagem[]): LinhaContagem[] {
  const out = [...linhas];
  while (
    out.length < LINHAS_INICIAIS ||
    linhaPreenchida(out[out.length - 1])
  ) {
    out.push(novaLinhaContagem(out[out.length - 1]?.tamanho ?? ""));
  }
  return out;
}

function Bloco1Contagem({
  sc,
  cores,
  editavel,
  onAlterada,
}: {
  sc: SubconferenciaItem;
  cores: CorRef[];
  editavel: boolean;
  onAlterada: () => void;
}) {
  // corId → linhas da tabela daquela cor. Contagem já salva volta como
  // uma linha por tamanho (a soma); o detalhe fardo a fardo vive só
  // durante a digitação.
  const [linhasPorCor, setLinhasPorCor] = useState<
    Record<string, LinhaContagem[]>
  >(() => {
    const r: Record<string, LinhaContagem[]> = {};
    for (const c of cores) {
      const daCor: LinhaContagem[] = [];
      if (sc.pecasRecebidas) {
        for (const t of TAMANHOS_TODOS) {
          const n = sc.pecasRecebidas[t]?.[c.id];
          if (n === undefined) continue;
          daCor.push({
            id: Math.random().toString(36).slice(2),
            tamanho: t,
            valor: String(n),
          });
        }
      }
      r[c.id] = completarLinhas(daCor);
    }
    return r;
  });
  const [salvando, setSalvando] = useState(false);
  const gradeRef = useRef<HTMLDivElement>(null);

  // Toda mutação passa por aqui: preencheu a última linha da tabela da
  // cor, uma nova nasce abaixo (herdando o tamanho).
  function atualizarLinhas(
    corId: string,
    updater: (prev: LinhaContagem[]) => LinhaContagem[],
  ) {
    setLinhasPorCor((prev) => ({
      ...prev,
      [corId]: completarLinhas(updater(prev[corId] ?? [])),
    }));
  }

  function setLinhaTamanho(corId: string, id: string, t: TamanhoGradeRisco) {
    atualizarLinhas(corId, (prev) =>
      prev.map((l) => (l.id === id ? { ...l, tamanho: t } : l)),
    );
  }

  function setLinhaValor(corId: string, id: string, v: string) {
    atualizarLinhas(corId, (prev) =>
      prev.map((l) => (l.id === id ? { ...l, valor: v } : l)),
    );
  }

  function removerLinha(corId: string, id: string) {
    atualizarLinhas(corId, (prev) => prev.filter((l) => l.id !== id));
  }

  // Navegação estilo planilha: Enter/↑↓ andam nas linhas da mesma cor,
  // ←→ pulam pra tabela da cor vizinha (mesma linha; se a vizinha for
  // mais curta, cai na última). preventDefault também mata o
  // incrementar/decrementar do input number nas setas ↑↓. rAF espera o
  // render — a linha de baixo pode ter acabado de nascer.
  function aoNavegarTeclado(
    e: KeyboardEvent<HTMLInputElement>,
    corIdx: number,
    linhaIdx: number,
  ) {
    let destino: [number, number];
    switch (e.key) {
      case "Enter":
      case "ArrowDown":
        destino = [corIdx, linhaIdx + 1];
        break;
      case "ArrowUp":
        destino = [corIdx, linhaIdx - 1];
        break;
      case "ArrowLeft":
        destino = [corIdx - 1, linhaIdx];
        break;
      case "ArrowRight":
        destino = [corIdx + 1, linhaIdx];
        break;
      default:
        return;
    }
    e.preventDefault();
    requestAnimationFrame(() => {
      let alvo = gradeRef.current?.querySelector<HTMLInputElement>(
        `input[data-celula="${destino[0]}-${destino[1]}"]`,
      );
      if (!alvo && destino[0] !== corIdx) {
        const daCor = gradeRef.current?.querySelectorAll<HTMLInputElement>(
          `input[data-celula^="${destino[0]}-"]`,
        );
        alvo =
          daCor && daCor.length > 0 ? daCor[daCor.length - 1] : undefined;
      }
      if (alvo) {
        alvo.focus();
        alvo.select();
      }
    });
  }

  function totalCor(corId: string): number {
    return (linhasPorCor[corId] ?? []).reduce((s, l) => {
      const n = Number(l.valor);
      return s + (l.valor.trim() && n > 0 ? n : 0);
    }, 0);
  }

  function montarMatriz(): MatrizPecas {
    const out: MatrizPecas = {};
    for (const c of cores) {
      for (const l of linhasPorCor[c.id] ?? []) {
        const n = Number(l.valor);
        if (!l.tamanho || !l.valor.trim() || !(n >= 0)) continue;
        out[l.tamanho] = out[l.tamanho] ?? {};
        out[l.tamanho][c.id] = (out[l.tamanho][c.id] ?? 0) + n;
      }
    }
    return out;
  }

  async function confirmarContagem() {
    const orfa = cores.some((c) =>
      (linhasPorCor[c.id] ?? []).some((l) => !l.tamanho && l.valor.trim()),
    );
    if (orfa) {
      toast.error("Há linha com quantidade preenchida sem tamanho selecionado");
      return;
    }
    setSalvando(true);
    try {
      const res = await fetch(`/api/confeccao/subconferencias/${sc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pecasRecebidas: montarMatriz() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao salvar contagem");
        return;
      }
      toast.success("Contagem registrada");
      onAlterada();
    } finally {
      setSalvando(false);
    }
  }

  async function revelarDivergencias() {
    const res = await fetch(`/api/confeccao/subconferencias/${sc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantidadeRevelada: true }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Erro");
      return;
    }
    onAlterada();
  }

  // Esperado = peças da retirada. Vazio = fluxo novo (retirada não
  // informa "esperado"; conferência é a única fonte da contagem).
  const esperado = sc.retiradaPecasPorTamanhoCor;
  const temEsperado = Object.keys(esperado).length > 0;
  const divergencias =
    sc.pecasRecebidas && temEsperado
      ? compararMatrizes(sc.pecasRecebidas, esperado)
      : [];

  const contagemFeita = !!sc.pecasRecebidas;
  const podeRevelar = temEsperado && contagemFeita && !sc.quantidadeRevelada;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">
          Bloco 1 — Conferência quantitativa
        </Label>
        {temEsperado && contagemFeita && (
          <Badge variant={sc.quantidadeRevelada ? "secondary" : "outline"}>
            {sc.quantidadeRevelada ? (
              <>
                <Eye className="size-3 mr-1" />
                Comparação revelada
              </>
            ) : (
              <>
                <EyeOff className="size-3 mr-1" />
                Esperado oculto
              </>
            )}
          </Badge>
        )}
      </div>

      {!contagemFeita && (
        <p className="text-xs text-muted-foreground">
          {temEsperado
            ? "Conte as peças sem ver o esperado. Após confirmar, o sistema vai mostrar se há divergência (com opção de recontagem antes de revelar)."
            : "Conte as peças que chegaram. A retirada não tem quantidade esperada — esta contagem é o número oficial."}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Uma tabela por cor: cada linha é um lançamento da ficha (ex.: um
        fardo) com tamanho e quantidade. Linhas com o mesmo tamanho são
        somadas. Preencheu a última linha, uma nova nasce embaixo já com o
        tamanho herdado. Enter e ↑↓ andam nas linhas; ←→ pulam pra cor
        vizinha.
      </p>

      <div ref={gradeRef} className="flex flex-wrap gap-4 items-start">
        {cores.map((c, corIdx) => (
          <div key={c.id} className="rounded border p-2 space-y-1">
            <div className="px-1 text-xs font-semibold">{c.nome}</div>
            <table className="text-sm">
              <thead>
                <tr>
                  <th className="text-left p-1 text-xs text-muted-foreground">
                    Tamanho
                  </th>
                  <th className="p-1 text-xs text-muted-foreground text-center">
                    Qtd
                  </th>
                  <th className="w-7" />
                </tr>
              </thead>
              <tbody>
                {(linhasPorCor[c.id] ?? []).map((l, linhaIdx) => (
                  <tr key={l.id}>
                    <td className="p-1">
                      <Select
                        value={l.tamanho}
                        onValueChange={(v) =>
                          setLinhaTamanho(c.id, l.id, v as TamanhoGradeRisco)
                        }
                        disabled={!editavel}
                      >
                        <SelectTrigger className="h-7 w-20 text-xs">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {TAMANHOS_TODOS.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-1 text-center">
                      <Input
                        type="number"
                        min="0"
                        data-celula={`${corIdx}-${linhaIdx}`}
                        value={l.valor}
                        onChange={(e) =>
                          setLinhaValor(c.id, l.id, e.target.value)
                        }
                        onKeyDown={(e) =>
                          aoNavegarTeclado(e, corIdx, linhaIdx)
                        }
                        disabled={!editavel}
                        className="h-7 text-xs w-16 text-center px-1 mx-auto"
                      />
                    </td>
                    <td className="p-1">
                      {editavel && linhaPreenchida(l) && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removerLinha(c.id, l.id)}
                          className="size-6"
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t">
                  <td className="p-1 text-xs font-medium">Total</td>
                  <td className="p-1 text-center text-xs font-medium tabular-nums">
                    {totalCor(c.id)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        ))}
      </div>

      <div className="text-xs font-semibold tabular-nums">
        Total geral: {cores.reduce((s, c) => s + totalCor(c.id), 0)}
      </div>

      {temEsperado && sc.quantidadeRevelada && divergencias.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 p-2 space-y-1">
          <p className="text-xs font-medium text-red-800">
            Divergências vs. esperado da retirada
          </p>
          {divergencias.map((d) => (
            <p
              key={`${d.tamanho}|${d.corId}`}
              className={cn(
                "text-xs tabular-nums",
                d.diferenca > 0 ? "text-emerald-700" : "text-red-700",
              )}
            >
              {d.tamanho} · {cores.find((c) => c.id === d.corId)?.nome ?? "?"}{" "}
              — contado {d.recebido}, esperado {d.esperado} (
              {d.diferenca > 0 ? "+" : ""}
              {d.diferenca})
            </p>
          ))}
        </div>
      )}
      {temEsperado && sc.quantidadeRevelada && divergencias.length === 0 && (
        <p className="text-xs text-emerald-700">
          Sem divergências vs. esperado da retirada.
        </p>
      )}

      {editavel && (
        <div className="flex flex-wrap gap-2 items-center">
          <Button
            size="sm"
            variant={contagemFeita ? "outline" : "default"}
            onClick={confirmarContagem}
            disabled={salvando}
          >
            {salvando
              ? "Salvando…"
              : contagemFeita
                ? "Atualizar contagem"
                : "Confirmar contagem"}
          </Button>
          {podeRevelar && divergencias.length > 0 && (
            <Button size="sm" variant="secondary" onClick={revelarDivergencias}>
              <Eye className="size-3.5" />
              Revelar comparação ({divergencias.length}{" "}
              divergências)
            </Button>
          )}
          {podeRevelar && divergencias.length === 0 && (
            <Button size="sm" variant="secondary" onClick={revelarDivergencias}>
              <Check className="size-3.5" />
              Sem divergência — revelar comparação
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Bloco 2 — Inspeção visual
// ============================================================

function Bloco2Inspecao({
  sc,
  opNumero,
  contaId,
  cores,
  tamanhos,
  editavel,
  onAlterada,
}: {
  sc: SubconferenciaItem;
  opNumero: string;
  contaId: string;
  cores: CorRef[];
  tamanhos: TamanhoGradeRisco[];
  editavel: boolean;
  onAlterada: () => void;
}) {
  const [responsavelId, setResponsavelId] = useState(
    sc.responsavelInspecaoId ?? "",
  );
  const [aprovadasMatriz, setAprovadasMatriz] = useState<
    Record<string, Record<string, string>>
  >(() => {
    const r: Record<string, Record<string, string>> = {};
    if (sc.aprovadas) {
      for (const [t, m] of Object.entries(sc.aprovadas)) {
        for (const [c, n] of Object.entries(m)) {
          r[t] = r[t] ?? {};
          r[t][c] = String(n);
        }
      }
    }
    return r;
  });
  const [reprovadasMatriz, setReprovadasMatriz] = useState<
    Record<string, Record<string, string>>
  >(() => {
    const r: Record<string, Record<string, string>> = {};
    if (sc.reprovadas) {
      for (const [t, m] of Object.entries(sc.reprovadas)) {
        for (const [c, n] of Object.entries(m)) {
          r[t] = r[t] ?? {};
          r[t][c] = String(n);
        }
      }
    }
    return r;
  });
  const [tiposDefeito, setTiposDefeito] = useState<TipoDefeito[]>(
    sc.tiposDefeito ?? [],
  );
  const [salvando, setSalvando] = useState(false);

  function setCelulaApr(t: string, c: string, v: string) {
    setAprovadasMatriz((prev) => ({
      ...prev,
      [t]: { ...(prev[t] ?? {}), [c]: v },
    }));
  }
  function setCelulaRep(t: string, c: string, v: string) {
    setReprovadasMatriz((prev) => ({
      ...prev,
      [t]: { ...(prev[t] ?? {}), [c]: v },
    }));
  }

  function montar(m: Record<string, Record<string, string>>): MatrizPecas {
    const out: MatrizPecas = {};
    for (const [t, mm] of Object.entries(m)) {
      for (const [c, v] of Object.entries(mm)) {
        const n = Number(v);
        if (v.trim() && n >= 0) {
          out[t] = out[t] ?? {};
          out[t][c] = n;
        }
      }
    }
    return out;
  }

  function toggleDefeito(d: TipoDefeito) {
    setTiposDefeito((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  }

  async function salvar() {
    setSalvando(true);
    try {
      const res = await fetch(`/api/confeccao/subconferencias/${sc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responsavelInspecaoId: responsavelId || null,
          aprovadas: montar(aprovadasMatriz),
          reprovadas: montar(reprovadasMatriz),
          tiposDefeito,
          dataInspecao: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao salvar inspeção");
        return;
      }
      toast.success("Inspeção salva");
      onAlterada();
    } finally {
      setSalvando(false);
    }
  }

  const totalApr = somarMatriz(montar(aprovadasMatriz));
  const totalRep = somarMatriz(montar(reprovadasMatriz));
  const totalRecebido = sc.pecasRecebidas ? somarMatriz(sc.pecasRecebidas) : 0;
  const inconsistente =
    totalRecebido > 0 && totalApr + totalRep > totalRecebido;

  return (
    <div className="space-y-3 border-t pt-4">
      <Label className="text-sm font-semibold">Bloco 2 — Inspeção visual</Label>

      <div className="space-y-2">
        <Label className="text-xs">Responsável pela inspeção</Label>
        <LookupUsuarioConta
          value={responsavelId}
          onChange={(id) => setResponsavelId(id)}
          disabled={!editavel}
          className="w-full max-w-md"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MatrizInput
          titulo="Aprovadas"
          matriz={aprovadasMatriz}
          cores={cores}
          tamanhos={tamanhos}
          editavel={editavel}
          onChange={setCelulaApr}
          total={totalApr}
        />
        <MatrizInput
          titulo="Reprovadas"
          matriz={reprovadasMatriz}
          cores={cores}
          tamanhos={tamanhos}
          editavel={editavel}
          onChange={setCelulaRep}
          total={totalRep}
          totalClasse="text-red-700"
        />
      </div>

      {inconsistente && (
        <div className="text-xs text-amber-700 flex items-center gap-1">
          <AlertTriangle className="size-3" />
          Aprovadas + reprovadas ({totalApr + totalRep}) excede total recebido
          ({totalRecebido})
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-xs">Tipos de defeito encontrados</Label>
        <div className="flex flex-wrap gap-1">
          {TIPOS_DEFEITO.map((d) => (
            <label
              key={d}
              className={cn(
                "flex items-center gap-1.5 text-xs rounded border px-2 py-1 cursor-pointer",
                tiposDefeito.includes(d)
                  ? "bg-primary/10 border-primary/40"
                  : "hover:bg-accent/40",
              )}
            >
              <Checkbox
                checked={tiposDefeito.includes(d)}
                onCheckedChange={() => toggleDefeito(d)}
                disabled={!editavel}
              />
              {d}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Fotos de defeitos</Label>
        <UploadAnexo
          subtaskId={sc.id}
          opNumero={opNumero}
          subtaskNumero={sc.numero}
          categoria="foto_defeito"
          contaId={contaId}
          label="Anexar foto"
          multiple
          disabled={!editavel}
        />
      </div>

      {editavel && (
        <Button size="sm" variant="outline" onClick={salvar} disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar inspeção"}
        </Button>
      )}
    </div>
  );
}

function MatrizInput({
  titulo,
  matriz,
  cores,
  tamanhos,
  editavel,
  onChange,
  total,
  totalClasse,
}: {
  titulo: string;
  matriz: Record<string, Record<string, string>>;
  cores: CorRef[];
  tamanhos: TamanhoGradeRisco[];
  editavel: boolean;
  onChange: (t: string, c: string, v: string) => void;
  total: number;
  totalClasse?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{titulo}</Label>
        <span className={cn("text-xs tabular-nums", totalClasse)}>
          total: {total}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs w-full">
          <thead>
            <tr>
              <th className="text-left p-1 text-muted-foreground">Cor</th>
              {tamanhos.map((t) => (
                <th
                  key={t}
                  className="p-1 text-muted-foreground text-center"
                >
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cores.map((c) => (
              <tr key={c.id}>
                <td className="p-1 font-medium">{c.nome}</td>
                {tamanhos.map((t) => (
                  <td key={t} className="p-1">
                    <Input
                      type="number"
                      min="0"
                      value={matriz[t]?.[c.id] ?? ""}
                      onChange={(e) => onChange(t, c.id, e.target.value)}
                      disabled={!editavel}
                      className="h-6 text-xs w-14 text-center px-1"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// Bloco 3 — Destinação
// ============================================================

function Bloco3Destinacao({
  sc,
  editavel,
  onAlterada,
}: {
  sc: SubconferenciaItem;
  editavel: boolean;
  onAlterada: () => void;
}) {
  const [localizacaoArmazem, setLocalizacaoArmazem] = useState(
    sc.localizacaoArmazem ?? "",
  );
  const [destinoReprovadas, setDestinoReprovadas] = useState<DestinoReprovadas | "">(
    sc.destinoReprovadas ?? "",
  );
  const [salvando, setSalvando] = useState(false);

  const temAprovadas = (sc.aprovadas && somarMatriz(sc.aprovadas) > 0) || false;
  const temReprovadas =
    (sc.reprovadas && somarMatriz(sc.reprovadas) > 0) || false;

  async function salvar() {
    setSalvando(true);
    try {
      const res = await fetch(`/api/confeccao/subconferencias/${sc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          localizacaoArmazem: localizacaoArmazem.trim() || null,
          destinoReprovadas: destinoReprovadas || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao salvar destinação");
        return;
      }
      toast.success("Destinação salva");
      onAlterada();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <Label className="text-sm font-semibold">Bloco 3 — Destinação</Label>

      {temAprovadas && (
        <div className="space-y-2">
          <Label className="text-xs">
            Localização das peças aprovadas no armazém
          </Label>
          <p className="text-xs text-muted-foreground">
            Texto livre. As aprovadas vão pra fardo via Estante Virtual
            (fluxo separado, não automático).
          </p>
          <Textarea
            value={localizacaoArmazem}
            onChange={(e) => setLocalizacaoArmazem(e.target.value)}
            disabled={!editavel}
            rows={2}
            placeholder="Ex: Prateleira A12, Bay 3"
            maxLength={500}
          />
        </div>
      )}

      {temReprovadas && (
        <div className="space-y-2">
          <Label className="text-xs">Destino das peças reprovadas</Label>
          <Select
            value={destinoReprovadas}
            onValueChange={(v) =>
              setDestinoReprovadas(v as DestinoReprovadas)
            }
            disabled={!editavel}
          >
            <SelectTrigger className="max-w-xs">
              <SelectValue placeholder="Selecionar destino…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="doacao">Doação</SelectItem>
              <SelectItem value="descarte">Descarte</SelectItem>
              <SelectItem value="retrabalho">
                Retrabalho (volta pra oficina — V2)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {!temAprovadas && !temReprovadas && (
        <p className="text-xs text-muted-foreground">
          Preencha aprovadas/reprovadas no Bloco 2 antes de definir destinação.
        </p>
      )}

      {editavel && (temAprovadas || temReprovadas) && (
        <Button size="sm" variant="outline" onClick={salvar} disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar destinação"}
        </Button>
      )}
    </div>
  );
}

// ============================================================
// Botão de conclusão da subconferência
// ============================================================

function ConcluirSubconferenciaBotao({
  sc,
  onAlterada,
}: {
  sc: SubconferenciaItem;
  onAlterada: () => void;
}) {
  const [concluindo, setConcluindo] = useState(false);
  async function concluir() {
    setConcluindo(true);
    try {
      const res = await fetch(
        `/api/confeccao/subconferencias/${sc.id}/concluir`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao concluir subconferência");
        return;
      }
      toast.success(`Subconferência ${sc.numero} concluída`);
      onAlterada();
    } finally {
      setConcluindo(false);
    }
  }
  return (
    <div className="border-t pt-4 flex justify-end">
      <Button onClick={concluir} disabled={concluindo}>
        <CheckCircle2 className="size-3.5" />
        {concluindo ? "Concluindo…" : `Concluir subconferência ${sc.numero}`}
      </Button>
    </div>
  );
}
