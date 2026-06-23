"use client";

// Conteúdo da subtask OPCOR (Corte) — RITM-10.
//
// Suporta múltiplas oficinas em paralelo. Mostra saldo de rolos vindo
// da Compra com validação em tempo real (alerta se excede saldo).
// Cada oficina tem config (pré-corte) + resultado (pós-corte).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ExternalLink,
  Info,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { LookupComCadastroInline } from "@/components/confeccao/lookup-com-cadastro-inline";
import { FormFornecedorRapido } from "@/components/confeccao/form-fornecedor-rapido";
import { BlocoLalamove } from "@/components/confeccao/bloco-lalamove";
import { UploadAnexo } from "@/components/confeccao/upload-anexo";
import { SubtaskStatusSelect } from "@/components/confeccao/subtask-status-select";
import { parsePesoFolhasColados } from "@/lib/confeccao/parse-peso-folhas-colados";
import type {
  ModoSeparacaoCorte,
  RoloRecebido,
  SubtaskCortePayload,
} from "@/lib/confeccao/schemas/payloads/corte";
import type {
  DistribuicaoOficina,
  SubtaskCompraPayload,
} from "@/lib/confeccao/schemas/payloads/compra";
import type {
  SubtaskRiscoPayload,
  TamanhoGradeRisco,
} from "@/lib/confeccao/schemas/payloads/risco";
import type { ConfeccaoSubtask } from "@/lib/db/schema";

interface SubtaskCorteProps {
  subtask: ConfeccaoSubtask;
  opNumero: string;
  contaId: string;
  onAlterado: () => void;
}

interface OficinaState {
  id: string; // chave local pra mapping React (não bate com oficinaId)
  oficinaId: string;
  oficinaNome: string;
  modoSeparacao: ModoSeparacaoCorte;
  rolosEnviadosPorCor: Record<string, string>;
  // RITM-34: rolos pesados/folhados pelo cortador, indexados por corId.
  // Cada entry da lista vai virar 1 item em payload.rolosRecebidos.
  // Comprimento da lista por cor pode ser menor que enviadosPorCor[cor]
  // enquanto cortador preenche; conclusão exige count match.
  rolosRecebidos: Record<string, Array<{ peso: string; folhas: string }>>;
  folhasEnfesto: string;
  rendimentoTotal: string;
  rendimentoMatriz: Record<string, Record<TamanhoGradeRisco, string>>; // [corId][tamanho] = "qtd"
  descartes: Array<{ corId: string; qtdRolos: string; justificativa: string }>;
  precoPorPeca: string;
  observacoes: string;
}

const MODO_LABEL: Record<ModoSeparacaoCorte, string> = {
  por_cor: "Separar por cor",
  sem_separacao: "Sem separação",
};

function novaOficina(): OficinaState {
  return {
    id: Math.random().toString(36).slice(2),
    oficinaId: "",
    oficinaNome: "",
    modoSeparacao: "por_cor",
    rolosEnviadosPorCor: {},
    rolosRecebidos: {},
    folhasEnfesto: "",
    rendimentoTotal: "",
    rendimentoMatriz: {},
    descartes: [],
    precoPorPeca: "",
    observacoes: "",
  };
}

export function SubtaskCorte({
  subtask,
  opNumero,
  contaId,
  onAlterado,
}: SubtaskCorteProps) {
  const router = useRouter();
  const { isAdmin } = usePapelAtivo();
  const payload = (subtask.payload ?? {}) as SubtaskCortePayload;

  const podeEditar =
    subtask.status === "em_andamento" || subtask.status === "pendente";
  const readOnly =
    subtask.status === "concluida" || subtask.status === "cancelada";

  // Contexto vindo de OPBUY (Compra) e OPRIS (Risco)
  const [coresContext, setCoresContext] = useState<
    Array<{ id: string; nome: string; rolosDisponiveis: number }>
  >([]);
  const [tamanhosDoRisco, setTamanhosDoRisco] = useState<TamanhoGradeRisco[]>(
    [],
  );
  // RITM-33: plano de distribuição vindo da Compra (read-only no Corte).
  const [distribuicaoCompra, setDistribuicaoCompra] = useState<
    DistribuicaoOficina[]
  >([]);
  /** Mapa oficinaId → nome amigável (hidratado do /api/fornecedores). */
  const [oficinasNomes, setOficinasNomes] = useState<Map<string, string>>(
    () => new Map(),
  );
  /** true quando a Compra definiu distribuicaoOficinas — UI vira read-only
   *  pros blocos derivados do plano (oficinas, rolosEnviadosPorCor). */
  const planDriven = distribuicaoCompra.length > 0;

  // Oficinas
  const [oficinas, setOficinas] = useState<OficinaState[]>(() => {
    if (!payload.oficinas || payload.oficinas.length === 0)
      return [novaOficina()];
    return payload.oficinas.map((o) => {
      const matriz: OficinaState["rendimentoMatriz"] = {};
      for (const entry of o.rendimentoPorTamanhoCor ?? []) {
        matriz[entry.corId] = matriz[entry.corId] ?? ({} as Record<
          TamanhoGradeRisco,
          string
        >);
        matriz[entry.corId][entry.tamanho] = String(entry.quantidade);
      }
      const rolos: Record<string, string> = {};
      for (const [c, n] of Object.entries(o.rolosEnviadosPorCor)) {
        rolos[c] = String(n);
      }
      // RITM-34: agrupa rolosRecebidos por corId, mantendo ordem original
      const recebidos: Record<
        string,
        Array<{ peso: string; folhas: string }>
      > = {};
      for (const r of o.rolosRecebidos ?? []) {
        if (!recebidos[r.corId]) recebidos[r.corId] = [];
        recebidos[r.corId].push({
          peso: String(r.pesoCortador),
          folhas: String(r.folhasRendidas),
        });
      }
      return {
        id: Math.random().toString(36).slice(2),
        oficinaId: o.oficinaId,
        oficinaNome: "",
        modoSeparacao: o.modoSeparacao,
        rolosEnviadosPorCor: rolos,
        rolosRecebidos: recebidos,
        folhasEnfesto:
          o.folhasEnfesto !== undefined ? String(o.folhasEnfesto) : "",
        rendimentoTotal:
          o.rendimentoTotal !== undefined ? String(o.rendimentoTotal) : "",
        rendimentoMatriz: matriz,
        descartes: (o.rolosDescartados ?? []).map((d) => ({
          corId: d.corId,
          qtdRolos: String(d.qtdRolos),
          justificativa: d.justificativa,
        })),
        precoPorPeca:
          o.precoPorPeca !== undefined ? String(o.precoPorPeca) : "",
        observacoes: o.observacoes ?? "",
      };
    });
  });

  const [salvando, setSalvando] = useState(false);

  // Busca contexto da OP (cores+rolos da Compra, tamanhos do Risco)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/confeccao/ops/${opNumero}`, {
        cache: "no-store",
      });
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as {
        subtasks: Array<{ prefixo: string; payload: unknown }>;
      };
      const compra = data.subtasks.find((s) => s.prefixo === "OPBUY")
        ?.payload as SubtaskCompraPayload | undefined;
      const risco = data.subtasks.find((s) => s.prefixo === "OPRIS")
        ?.payload as SubtaskRiscoPayload | undefined;

      // Mapa cor → rolos disponíveis (qtd de pesos informados, agregando
      // cross-fornecedor — RITM-29).
      const rolosPorCor = new Map<string, number>();
      for (const f of compra?.fornecedores ?? []) {
        for (const c of f.cores) {
          rolosPorCor.set(
            c.corId,
            (rolosPorCor.get(c.corId) ?? 0) + c.pesosRolos.length,
          );
        }
      }
      // Hidrata nomes
      const idsCor = Array.from(rolosPorCor.keys());
      const nomesCor = new Map<string, string>();
      if (idsCor.length > 0) {
        const resCor = await fetch(
          `/api/confeccao/cores?pageSize=100&incluirInativos=true`,
          { cache: "no-store" },
        );
        if (resCor.ok && !cancelled) {
          const dataCor = (await resCor.json()) as {
            items: Array<{ id: string; nome: string }>;
          };
          for (const c of dataCor.items) nomesCor.set(c.id, c.nome);
        }
      }

      // RITM-33: plano de distribuição da Compra (oficinas + rolos).
      const distribuicao = compra?.distribuicaoOficinas ?? [];
      const oficinasMapa = new Map<string, string>();
      if (distribuicao.length > 0) {
        const resFor = await fetch(
          `/api/confeccao/fornecedores?pageSize=200&incluirInativos=true`,
          { cache: "no-store" },
        );
        if (resFor.ok && !cancelled) {
          const dataFor = (await resFor.json()) as {
            items: Array<{ id: string; nome: string }>;
          };
          for (const f of dataFor.items) oficinasMapa.set(f.id, f.nome);
        }
      }

      if (!cancelled) {
        setCoresContext(
          Array.from(rolosPorCor.entries()).map(([id, qtd]) => ({
            id,
            nome: nomesCor.get(id) ?? "?",
            rolosDisponiveis: qtd,
          })),
        );
        setTamanhosDoRisco((risco?.tamanhos ?? []).map((t) => t.tamanho));
        setDistribuicaoCompra(distribuicao);
        setOficinasNomes(oficinasMapa);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opNumero]);

  // Soma de rolos enviados por cor (todas as oficinas)
  function totalEnviadoPorCor(corId: string): number {
    return oficinas.reduce((sum, o) => {
      const v = Number(o.rolosEnviadosPorCor[corId] ?? 0);
      return sum + (isNaN(v) ? 0 : v);
    }, 0);
  }

  function corExcede(corId: string): boolean {
    const enviado = totalEnviadoPorCor(corId);
    const disponivel =
      coresContext.find((c) => c.id === corId)?.rolosDisponiveis ?? 0;
    return enviado > disponivel;
  }

  function setOficinaCampo<K extends keyof OficinaState>(
    idx: number,
    campo: K,
    valor: OficinaState[K],
  ) {
    setOficinas((prev) =>
      prev.map((o, i) => (i === idx ? { ...o, [campo]: valor } : o)),
    );
  }

  function setRolosEnviados(idx: number, corId: string, valor: string) {
    setOficinas((prev) =>
      prev.map((o, i) =>
        i === idx
          ? {
              ...o,
              rolosEnviadosPorCor: {
                ...o.rolosEnviadosPorCor,
                [corId]: valor,
              },
            }
          : o,
      ),
    );
  }

  function setRendimentoCelula(
    idx: number,
    corId: string,
    tamanho: TamanhoGradeRisco,
    valor: string,
  ) {
    setOficinas((prev) =>
      prev.map((o, i) =>
        i === idx
          ? {
              ...o,
              rendimentoMatriz: {
                ...o.rendimentoMatriz,
                [corId]: {
                  ...(o.rendimentoMatriz[corId] ?? {}),
                  [tamanho]: valor,
                } as Record<TamanhoGradeRisco, string>,
              },
            }
          : o,
      ),
    );
  }

  // ── RITM-34: rolosRecebidos (peso/folhas pelo cortador) ────────────
  // Refs pra nav teclado: key = `${idxOficina}-${corId}-${idxRolo}-${campo}`
  const rrInputRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());
  const registerRrRef = useCallback(
    (key: string, el: HTMLInputElement | null) => {
      if (el) rrInputRefs.current.set(key, el);
      else rrInputRefs.current.delete(key);
    },
    [],
  );

  /** Lê n esperado de uma cor a partir do state (parsing string → int). */
  function nEsperadosCor(o: OficinaState, corId: string): number {
    const v = Number(o.rolosEnviadosPorCor[corId] ?? "");
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  }

  /** Set 1 campo (peso ou folhas) de 1 rolo. Cresce a lista até o índice. */
  function setRoloRecebidoCampo(
    idxOficina: number,
    corId: string,
    idxRolo: number,
    campo: "peso" | "folhas",
    valor: string,
  ) {
    setOficinas((prev) =>
      prev.map((o, i) => {
        if (i !== idxOficina) return o;
        const atual = o.rolosRecebidos[corId] ?? [];
        const lista =
          atual.length > idxRolo
            ? [...atual]
            : [
                ...atual,
                ...Array.from(
                  { length: idxRolo - atual.length + 1 },
                  () => ({ peso: "", folhas: "" }),
                ),
              ];
        lista[idxRolo] = { ...lista[idxRolo], [campo]: valor };
        return {
          ...o,
          rolosRecebidos: { ...o.rolosRecebidos, [corId]: lista },
        };
      }),
    );
  }

  /** Substitui várias linhas a partir de idxRolo (paste do Excel). */
  function colarRolosRecebidos(
    idxOficina: number,
    corId: string,
    idxRoloInicial: number,
    valores: Array<{ peso: number; folhas: number | null }>,
  ) {
    setOficinas((prev) =>
      prev.map((o, i) => {
        if (i !== idxOficina) return o;
        const n = nEsperadosCor(o, corId);
        const atual = o.rolosRecebidos[corId] ?? [];
        // Pad até max(n, idxInicial+valores.length)
        const tamFinal = Math.max(n, idxRoloInicial + valores.length);
        const lista: Array<{ peso: string; folhas: string }> = [];
        for (let k = 0; k < tamFinal; k++) {
          lista.push(atual[k] ?? { peso: "", folhas: "" });
        }
        for (let k = 0; k < valores.length; k++) {
          const dest = idxRoloInicial + k;
          if (dest >= n) break; // não passa do esperado
          const v = valores[k];
          lista[dest] = {
            peso: String(v.peso),
            folhas: v.folhas !== null ? String(v.folhas) : lista[dest]?.folhas ?? "",
          };
        }
        return {
          ...o,
          rolosRecebidos: { ...o.rolosRecebidos, [corId]: lista },
        };
      }),
    );
  }

  /** Limpa todos os rolos de uma cor (preserva slots, zera valores). */
  function limparRolosRecebidosCor(idxOficina: number, corId: string) {
    setOficinas((prev) =>
      prev.map((o, i) => {
        if (i !== idxOficina) return o;
        const n = nEsperadosCor(o, corId);
        const lista = Array.from({ length: n }, () => ({
          peso: "",
          folhas: "",
        }));
        return {
          ...o,
          rolosRecebidos: { ...o.rolosRecebidos, [corId]: lista },
        };
      }),
    );
  }

  /** Foca o próximo input dentro da mesma (oficina, cor). */
  const focarRoloProximo = useCallback(
    (
      idxOficina: number,
      corId: string,
      idxRolo: number,
      campo: "peso" | "folhas",
      direcao: 1 | -1,
    ) => {
      const focar = (key: string) => {
        const el = rrInputRefs.current.get(key);
        if (el) {
          el.focus();
          el.select();
        }
      };
      const prox = `${idxOficina}-${corId}-${idxRolo + direcao}-${campo}`;
      if (rrInputRefs.current.has(prox)) {
        focar(prox);
        return;
      }
      const atual = rrInputRefs.current.get(
        `${idxOficina}-${corId}-${idxRolo}-${campo}`,
      );
      atual?.blur();
    },
    [],
  );

  function adicionarOficina() {
    setOficinas((prev) => [...prev, novaOficina()]);
  }
  function removerOficina(idx: number) {
    setOficinas((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev,
    );
  }

  function adicionarDescarte(idx: number, corId: string) {
    setOficinas((prev) =>
      prev.map((o, i) =>
        i === idx
          ? {
              ...o,
              descartes: [
                ...o.descartes,
                { corId, qtdRolos: "1", justificativa: "" },
              ],
            }
          : o,
      ),
    );
  }
  function removerDescarte(idx: number, dIdx: number) {
    setOficinas((prev) =>
      prev.map((o, i) =>
        i === idx
          ? {
              ...o,
              descartes: o.descartes.filter((_, di) => di !== dIdx),
            }
          : o,
      ),
    );
  }

  function montarPayload(): SubtaskCortePayload {
    return {
      oficinas: oficinas
        .filter((o) => o.oficinaId)
        .map((o) => {
          const rolos: Record<string, number> = {};
          for (const [c, v] of Object.entries(o.rolosEnviadosPorCor)) {
            const n = Number(v);
            if (n > 0) rolos[c] = n;
          }
          const rendimentoArr: Array<{
            tamanho: TamanhoGradeRisco;
            corId: string;
            quantidade: number;
          }> = [];
          for (const [corId, mapaTam] of Object.entries(o.rendimentoMatriz)) {
            for (const [t, qtd] of Object.entries(mapaTam)) {
              const n = Number(qtd);
              if (qtd.trim() && n >= 0) {
                rendimentoArr.push({
                  tamanho: t as TamanhoGradeRisco,
                  corId,
                  quantidade: n,
                });
              }
            }
          }
          // RITM-34: rolosRecebidos flat (filtrado: só com peso > 0).
          const rolosRecebidos: RoloRecebido[] = [];
          for (const [corId, lista] of Object.entries(o.rolosRecebidos)) {
            for (const r of lista) {
              const peso = Number(r.peso.replace(",", "."));
              if (!Number.isFinite(peso) || peso <= 0) continue;
              const folhasNum = Number(r.folhas);
              const folhas =
                Number.isFinite(folhasNum) && folhasNum >= 0
                  ? Math.floor(folhasNum)
                  : 0;
              rolosRecebidos.push({
                corId,
                pesoCortador: peso,
                folhasRendidas: folhas,
              });
            }
          }
          return {
            oficinaId: o.oficinaId,
            modoSeparacao: o.modoSeparacao,
            rolosEnviadosPorCor: rolos,
            rolosRecebidos:
              rolosRecebidos.length > 0 ? rolosRecebidos : undefined,
            folhasEnfesto: o.folhasEnfesto
              ? Number(o.folhasEnfesto)
              : undefined,
            rendimentoTotal: o.rendimentoTotal
              ? Number(o.rendimentoTotal)
              : undefined,
            rendimentoPorTamanhoCor:
              rendimentoArr.length > 0 ? rendimentoArr : undefined,
            rolosDescartados:
              o.descartes.length > 0
                ? o.descartes
                    .filter(
                      (d) => d.corId && d.qtdRolos && d.justificativa.trim(),
                    )
                    .map((d) => ({
                      corId: d.corId,
                      qtdRolos: Number(d.qtdRolos),
                      justificativa: d.justificativa.trim(),
                    }))
                : undefined,
            precoPorPeca: o.precoPorPeca ? Number(o.precoPorPeca) : undefined,
            observacoes: o.observacoes.trim() || undefined,
          };
        }),
    };
  }

  const salvarPayload = useCallback(
    async (silent = false) => {
      setSalvando(true);
      try {
        const res = await fetch(
          `/api/confeccao/subtasks/${subtask.id}/payload`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payload: montarPayload() }),
          },
        );
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Erro ao salvar");
          return false;
        }
        if (!silent) toast.success("Salvo");
        onAlterado();
        return true;
      } finally {
        setSalvando(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [subtask.id, oficinas, onAlterado],
  );

  // RITM-34: auto-save debounced (800ms) só pra rolosRecebidos.
  // Outros campos continuam no fluxo manual "Salvar rascunho" pra manter
  // compatibilidade. Trigger é mudança no fingerprint dos rolosRecebidos.
  const rrFingerprint = useMemo(
    () =>
      oficinas
        .map((o) =>
          Object.entries(o.rolosRecebidos)
            .map(
              ([cor, lista]) =>
                `${cor}:${lista.map((r) => `${r.peso}/${r.folhas}`).join("|")}`,
            )
            .join(";"),
        )
        .join("§"),
    [oficinas],
  );
  const rrUltimoEnviadoRef = useRef<string>(rrFingerprint);
  const rrDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!podeEditar) return;
    if (rrFingerprint === rrUltimoEnviadoRef.current) return;
    if (rrDebounceRef.current) clearTimeout(rrDebounceRef.current);
    rrDebounceRef.current = setTimeout(() => {
      void salvarPayload(true).then((ok) => {
        if (ok) rrUltimoEnviadoRef.current = rrFingerprint;
      });
    }, 800);
    return () => {
      if (rrDebounceRef.current) clearTimeout(rrDebounceRef.current);
    };
  }, [rrFingerprint, podeEditar, salvarPayload]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="font-medium">Corte</h3>
          <p className="text-xs text-muted-foreground">
            Distribuição entre oficinas + resultados do corte. Suporta
            múltiplas oficinas em paralelo. Rendimento informado é imutável
            após conclusão.
          </p>
        </div>
        <SubtaskStatusSelect
          subtaskId={subtask.id}
          subtaskNumero={subtask.numero}
          status={subtask.status}
          onAntesDeMudar={async (alvo) => {
            // Antes de concluir: pre-save + validação client-side de saldo.
            if (alvo === "concluida") {
              const corExcedida = coresContext.find((c) => corExcede(c.id));
              if (corExcedida) {
                toast.error(
                  `Saldo excedido na cor ${corExcedida.nome}: ${totalEnviadoPorCor(corExcedida.id)} > ${corExcedida.rolosDisponiveis} disponíveis`,
                );
                return false;
              }
            }
            // Pre-save geral: garante que o servidor vê o rascunho atual
            const ok = await salvarPayload(true);
            return ok;
          }}
          onMudou={() => {
            onAlterado();
            router.refresh();
          }}
        />
      </div>

      {/* RITM-33: banner top sobre origem do plano */}
      {planDriven ? (
        <div className="flex items-start gap-2 rounded border bg-card p-3 text-sm">
          <Info className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
          <div className="flex-1">
            Plano de distribuição vem da Compra. Pra alterar oficinas ou
            rolos por cor, edite a{" "}
            <Link
              href={`/confeccao/ops/${opNumero}`}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Compra (OPBUY)
              <ExternalLink className="size-3" />
            </Link>
            .
          </div>
        </div>
      ) : coresContext.length > 0 ? (
        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            Plano de distribuição não disponível na Compra — editando
            oficinas manualmente. Recomendado: definir distribuição na
            Compra (clique &ldquo;Planejar distribuição&rdquo; na OPBUY).
          </div>
        </div>
      ) : null}

      {/* Saldo da Compra */}
      {coresContext.length === 0 ? (
        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            Subtask Compra ainda não definiu rolos recebidos — conclua-a
            primeiro pra ter saldo de rolos disponível aqui.
          </div>
        </div>
      ) : (
        <div className="rounded border bg-card p-3">
          <div className="flex items-center gap-2 text-sm font-medium mb-2">
            <Info className="size-4" />
            Saldo de rolos (da Compra)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            {coresContext.map((c) => {
              const enviado = totalEnviadoPorCor(c.id);
              const excede = corExcede(c.id);
              return (
                <div
                  key={c.id}
                  className={`rounded border p-2 ${excede ? "border-red-300 bg-red-50" : ""}`}
                >
                  <div className="font-medium">{c.nome}</div>
                  <div
                    className={`text-xs tabular-nums ${excede ? "text-red-700" : "text-muted-foreground"}`}
                  >
                    {enviado} / {c.rolosDisponiveis} rolos enviados
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {oficinas.map((o, idx) => (
        <Card key={o.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Oficina {idx + 1}
                {o.oficinaNome ? ` — ${o.oficinaNome}` : ""}
              </CardTitle>
              {podeEditar && !planDriven && oficinas.length > 1 && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => removerOficina(idx)}
                  className="size-7"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Config pré-corte */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Oficina de corte</Label>
                {planDriven ? (
                  <div className="h-9 px-3 flex items-center rounded border bg-muted/30 text-sm">
                    {o.oficinaNome ||
                      oficinasNomes.get(o.oficinaId) ||
                      "(carregando)"}
                  </div>
                ) : (
                  <LookupComCadastroInline
                    endpoint="/api/confeccao/fornecedores"
                    extraQuery={{ categoria: "corte" }}
                    value={o.oficinaId}
                    onChange={(id, item) => {
                      setOficinaCampo(idx, "oficinaId", id);
                      setOficinaCampo(idx, "oficinaNome", item.nome);
                    }}
                    entidadeLabel="oficina de corte"
                    permiteCadastrar={isAdmin}
                    cadastroInlineRender={
                      isAdmin
                        ? ({ onCreated, onCancel }) => (
                            <FormFornecedorRapido
                              categoriaInicial="corte"
                              onCreated={onCreated}
                              onCancel={onCancel}
                            />
                          )
                        : undefined
                    }
                    disabled={!podeEditar}
                    className="w-full"
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label>Modo de separação</Label>
                <Select
                  value={o.modoSeparacao}
                  onValueChange={(v) =>
                    setOficinaCampo(
                      idx,
                      "modoSeparacao",
                      v as ModoSeparacaoCorte,
                    )
                  }
                  disabled={!podeEditar}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["por_cor", "sem_separacao"] as const).map((m) => (
                      <SelectItem key={m} value={m}>
                        {MODO_LABEL[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>
                Rolos enviados por cor
                {planDriven && (
                  <span className="ml-2 text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                    da Compra
                  </span>
                )}
              </Label>
              {coresContext.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Defina os rolos recebidos na Compra primeiro.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {coresContext.map((c) => {
                    const valor = o.rolosEnviadosPorCor[c.id] ?? "";
                    return (
                      <div key={c.id} className="space-y-1">
                        <span className="text-xs text-muted-foreground">
                          {c.nome}
                        </span>
                        {planDriven ? (
                          <div className="h-8 px-3 flex items-center rounded border bg-muted/30 text-sm tabular-nums">
                            {valor === "" || valor === "0" ? "—" : valor}
                          </div>
                        ) : (
                          <Input
                            type="number"
                            min="0"
                            max={c.rolosDisponiveis}
                            value={valor}
                            onChange={(e) =>
                              setRolosEnviados(idx, c.id, e.target.value)
                            }
                            disabled={!podeEditar}
                            className="h-8 text-sm"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* RITM-34: Rolos recebidos pelo cortador (1 linha por rolo) */}
            {coresContext.length > 0 && (
              <div className="border-t pt-4 space-y-3">
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  Rolos recebidos pelo cortador
                </div>
                <p className="text-xs text-muted-foreground">
                  Cortador pesa cada rolo ao descer no enfesto e anota
                  quantas folhas o rolo rendeu. Sem etiqueta física — a
                  comparação com o peso do fornecedor é feita por ranking de
                  peso dentro de cada cor.
                </p>
                {coresContext.map((c) => {
                  const nEsperados = nEsperadosCor(o, c.id);
                  if (nEsperados <= 0) return null;
                  const lista = o.rolosRecebidos[c.id] ?? [];
                  const preenchidos = lista.filter(
                    (r) => r.peso.trim() !== "",
                  ).length;
                  return (
                    <div
                      key={c.id}
                      className="rounded border bg-muted/20 p-3 space-y-2"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <div className="text-xs font-medium text-muted-foreground">
                          {c.nome} ·{" "}
                          <span className="tabular-nums">
                            {preenchidos}/{nEsperados}
                          </span>{" "}
                          informados
                        </div>
                        <div className="text-[10px] text-muted-foreground/70">
                          Enter avança · ↑/↓ navega · Ctrl+V cola coluna ou
                          matriz (peso[Tab]folhas) do Excel
                        </div>
                        {podeEditar && preenchidos > 0 && (
                          <button
                            type="button"
                            className="text-[11px] text-muted-foreground hover:underline ml-auto"
                            onClick={() =>
                              limparRolosRecebidosCor(idx, c.id)
                            }
                          >
                            Limpar
                          </button>
                        )}
                      </div>
                      <div
                        className="flex flex-col gap-1"
                        role="list"
                        aria-label={`Rolos recebidos da cor ${c.nome}`}
                      >
                        {Array.from({ length: nEsperados }, (_, idxR) => {
                          const rolo = lista[idxR] ?? {
                            peso: "",
                            folhas: "",
                          };
                          return (
                            <div
                              key={idxR}
                              className="flex items-center gap-2"
                              role="listitem"
                            >
                              <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                                R{idxR + 1}
                              </span>
                              <Input
                                ref={(el) =>
                                  registerRrRef(
                                    `${idx}-${c.id}-${idxR}-peso`,
                                    el,
                                  )
                                }
                                type="number"
                                step="0.01"
                                inputMode="decimal"
                                value={rolo.peso}
                                placeholder="kg"
                                onChange={(e) =>
                                  setRoloRecebidoCampo(
                                    idx,
                                    c.id,
                                    idxR,
                                    "peso",
                                    e.target.value,
                                  )
                                }
                                onFocus={(e) => e.currentTarget.select()}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    // Enter no peso → folhas mesma linha
                                    const folhasEl = rrInputRefs.current.get(
                                      `${idx}-${c.id}-${idxR}-folhas`,
                                    );
                                    if (folhasEl) {
                                      folhasEl.focus();
                                      folhasEl.select();
                                    }
                                  } else if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    focarRoloProximo(
                                      idx,
                                      c.id,
                                      idxR,
                                      "peso",
                                      1,
                                    );
                                  } else if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    focarRoloProximo(
                                      idx,
                                      c.id,
                                      idxR,
                                      "peso",
                                      -1,
                                    );
                                  }
                                }}
                                onPaste={(e) => {
                                  const texto =
                                    e.clipboardData.getData("text/plain") ??
                                    "";
                                  const valores =
                                    parsePesoFolhasColados(texto);
                                  if (valores.length <= 1) return;
                                  e.preventDefault();
                                  colarRolosRecebidos(
                                    idx,
                                    c.id,
                                    idxR,
                                    valores,
                                  );
                                  toast.success(
                                    `${valores.length} rolo(s) colados a partir de R${idxR + 1}`,
                                  );
                                }}
                                disabled={!podeEditar}
                                className="h-8 text-sm text-right tabular-nums w-24"
                              />
                              <Input
                                ref={(el) =>
                                  registerRrRef(
                                    `${idx}-${c.id}-${idxR}-folhas`,
                                    el,
                                  )
                                }
                                type="number"
                                min="0"
                                step="1"
                                inputMode="numeric"
                                value={rolo.folhas}
                                placeholder="folhas"
                                onChange={(e) =>
                                  setRoloRecebidoCampo(
                                    idx,
                                    c.id,
                                    idxR,
                                    "folhas",
                                    e.target.value,
                                  )
                                }
                                onFocus={(e) => e.currentTarget.select()}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    // Enter em folhas → peso próximo rolo
                                    focarRoloProximo(
                                      idx,
                                      c.id,
                                      idxR,
                                      "peso",
                                      1,
                                    );
                                  } else if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    focarRoloProximo(
                                      idx,
                                      c.id,
                                      idxR,
                                      "folhas",
                                      1,
                                    );
                                  } else if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    focarRoloProximo(
                                      idx,
                                      c.id,
                                      idxR,
                                      "folhas",
                                      -1,
                                    );
                                  }
                                }}
                                disabled={!podeEditar}
                                className="h-8 text-sm text-right tabular-nums w-24"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pós-corte (resultado) */}
            <div className="border-t pt-4 space-y-4">
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                Resultado (pós-corte)
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Folhas do enfesto (papagaio)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={o.folhasEnfesto}
                    onChange={(e) =>
                      setOficinaCampo(idx, "folhasEnfesto", e.target.value)
                    }
                    disabled={!podeEditar}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Rendimento total (peças)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={o.rendimentoTotal}
                    onChange={(e) =>
                      setOficinaCampo(idx, "rendimentoTotal", e.target.value)
                    }
                    disabled={!podeEditar}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Preço por peça (R$)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={o.precoPorPeca}
                    onChange={(e) =>
                      setOficinaCampo(idx, "precoPorPeca", e.target.value)
                    }
                    disabled={!podeEditar}
                  />
                </div>
              </div>

              {/* Matriz tamanho × cor */}
              {tamanhosDoRisco.length > 0 && coresContext.length > 0 && (
                <div className="space-y-2">
                  <Label>Rendimento por tamanho × cor (peças)</Label>
                  <p className="text-xs text-muted-foreground">
                    Dados informados pela oficina. É o número oficial — não é
                    estimativa.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="text-sm w-full">
                      <thead>
                        <tr>
                          <th className="text-left p-1 text-xs text-muted-foreground">
                            Cor / Tamanho
                          </th>
                          {tamanhosDoRisco.map((t) => (
                            <th
                              key={t}
                              className="p-1 text-xs text-muted-foreground text-center"
                            >
                              {t}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {coresContext.map((c) => (
                          <tr key={c.id}>
                            <td className="p-1 text-xs font-medium">
                              {c.nome}
                            </td>
                            {tamanhosDoRisco.map((t) => (
                              <td key={t} className="p-1">
                                <Input
                                  type="number"
                                  min="0"
                                  value={
                                    o.rendimentoMatriz[c.id]?.[t] ?? ""
                                  }
                                  onChange={(e) =>
                                    setRendimentoCelula(
                                      idx,
                                      c.id,
                                      t,
                                      e.target.value,
                                    )
                                  }
                                  disabled={!podeEditar}
                                  className="h-7 text-xs w-16 text-center px-1"
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Descartes */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Rolos descartados por defeito</Label>
                  {podeEditar && coresContext.length > 0 && (
                    <Select
                      value=""
                      onValueChange={(v) => adicionarDescarte(idx, v)}
                    >
                      <SelectTrigger className="w-44 h-8 text-xs">
                        <SelectValue placeholder="+ Adicionar descarte" />
                      </SelectTrigger>
                      <SelectContent>
                        {coresContext.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                {o.descartes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum descarte. Compõe indicador &quot;Perdas&quot; no
                    relatório.
                  </p>
                ) : (
                  o.descartes.map((d, dIdx) => (
                    <div
                      key={dIdx}
                      className="flex items-start gap-2 rounded border p-2"
                    >
                      <Badge variant="outline" className="mt-1">
                        {coresContext.find((c) => c.id === d.corId)?.nome ??
                          "?"}
                      </Badge>
                      <Input
                        type="number"
                        min="1"
                        value={d.qtdRolos}
                        onChange={(e) =>
                          setOficinas((prev) =>
                            prev.map((oo, i) =>
                              i === idx
                                ? {
                                    ...oo,
                                    descartes: oo.descartes.map((x, di) =>
                                      di === dIdx
                                        ? { ...x, qtdRolos: e.target.value }
                                        : x,
                                    ),
                                  }
                                : oo,
                            ),
                          )
                        }
                        disabled={!podeEditar}
                        className="w-20 h-7 text-xs"
                      />
                      <Textarea
                        value={d.justificativa}
                        onChange={(e) =>
                          setOficinas((prev) =>
                            prev.map((oo, i) =>
                              i === idx
                                ? {
                                    ...oo,
                                    descartes: oo.descartes.map((x, di) =>
                                      di === dIdx
                                        ? {
                                            ...x,
                                            justificativa: e.target.value,
                                          }
                                        : x,
                                    ),
                                  }
                                : oo,
                            ),
                          )
                        }
                        rows={1}
                        disabled={!podeEditar}
                        placeholder="Justificativa obrigatória"
                        className="flex-1 text-xs"
                      />
                      {podeEditar && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removerDescarte(idx, dIdx)}
                          className="size-7"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Anexos da oficina */}
              <div className="space-y-2">
                <Label>Foto do papagaio (amostra do enfesto)</Label>
                <UploadAnexo
                  subtaskId={subtask.id}
                  opNumero={opNumero}
                  subtaskNumero={subtask.numero}
                  categoria="foto_papagaio"
                  contaId={contaId}
                  label="Anexar foto papagaio"
                  disabled={!podeEditar}
                />
              </div>

              {(o.descartes.length > 0 || podeEditar) && (
                <div className="space-y-2">
                  <Label>Fotos de defeitos (opcional)</Label>
                  <UploadAnexo
                    subtaskId={subtask.id}
                    opNumero={opNumero}
                    subtaskNumero={subtask.numero}
                    categoria="foto_defeito"
                    contaId={contaId}
                    label="Anexar foto defeito"
                    multiple
                    disabled={!podeEditar}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>Observações</Label>
                <Textarea
                  value={o.observacoes}
                  onChange={(e) =>
                    setOficinaCampo(idx, "observacoes", e.target.value)
                  }
                  rows={2}
                  disabled={!podeEditar}
                  maxLength={2000}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      {podeEditar && (
        <div className="flex justify-between items-center">
          {planDriven ? (
            <span className="text-xs text-muted-foreground">
              Oficinas vêm do plano da Compra
            </span>
          ) : (
            <Button variant="outline" size="sm" onClick={adicionarOficina}>
              <Plus className="size-3.5" />
              Adicionar oficina
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void salvarPayload()}
            disabled={salvando}
          >
            {salvando ? "Salvando…" : "Salvar rascunho"}
          </Button>
        </div>
      )}

      <BlocoLalamove
        subtaskId={subtask.id}
        contaId={contaId}
        opNumero={opNumero}
        subtaskNumero={subtask.numero}
        readOnly={readOnly}
      />
    </div>
  );
}
