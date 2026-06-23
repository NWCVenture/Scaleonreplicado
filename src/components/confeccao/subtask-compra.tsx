"use client";

// Subtask OPBUY (Compra de Tecido) — RITM-29 (multi-fornecedor + spill rolos).
//
// UI no estilo planilha do OP TEMPLATE.xlsm:
//  - Top-level: tipo tecido, destinatário do corte (oficina), gramatura, largura.
//  - 1..N cards de Fornecedor. Cada card tem:
//    - Header: lookup do fornecedor (cadastro inline), WhatsApp, observações.
//    - Tabela de cores: cor | kgs contr. | qtd rolos | R$/kg | kg real | diff.
//    - Embaixo: spill de pesos por rolo — digito qtd=N gera N inputs de peso.
//  - Summary global ao vivo: contratado vs recebido + custo total.
//
// Subtask abre direto em em_andamento (sem botão "Iniciar"). "Pré"/"pós"
// descontinuados — tudo é editável o tempo todo enquanto status != concluida.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/lib/auth-client";
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { LookupComCadastroInline } from "@/components/confeccao/lookup-com-cadastro-inline";
import { FormFornecedorRapido } from "@/components/confeccao/form-fornecedor-rapido";
import { BlocoLalamove } from "@/components/confeccao/bloco-lalamove";
import { UploadAnexo } from "@/components/confeccao/upload-anexo";
import { WhatsappTemplatePicker } from "@/components/confeccao/whatsapp-template-picker";
import { ModalDistribuicaoCompra } from "@/components/confeccao/modal-distribuicao-compra";
import type { ConfeccaoSubtask } from "@/lib/db/schema";
import type {
  CorContratada,
  DistribuicaoOficina,
  FornecedorCompra,
  SubtaskCompraPayload,
} from "@/lib/confeccao/schemas/payloads/compra";
import { calcularSaldoDistribuicao } from "@/lib/confeccao/schemas/payloads/compra";
import { parsePesosColados } from "@/lib/confeccao/parse-pesos-colados";
import { cn } from "@/lib/utils";

interface SubtaskCompraProps {
  subtask: ConfeccaoSubtask;
  opNumero: string;
  contaId: string;
  onAlterado: () => void;
}

// ──────────────────────────────────────────────────────────────────────
// Estado local — sempre strings porque inputs aceitam parcial ("12,").
// montarPayload() converte pra number na hora de salvar.
// ──────────────────────────────────────────────────────────────────────

interface CorState {
  corId: string;
  corNome: string;
  kgsContratados: string;
  qtdRolosContratados: string;
  precoPorKg: string;
  pesosRolos: string[]; // length sincronizado com qtdRolosContratados
}

interface FornecedorState {
  fornecedorId: string;
  fornecedorNome: string;
  whatsapp: string | null;
  observacoes: string;
  cores: CorState[];
}

function normalizarNumero(v: string): number {
  // aceita "12,5" e "12.5" — usuário pode digitar com vírgula
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}


function corVazia(corId: string, corNome: string): CorState {
  return {
    corId,
    corNome,
    kgsContratados: "",
    qtdRolosContratados: "",
    precoPorKg: "",
    pesosRolos: [],
  };
}

function corStateFromPayload(c: CorContratada, corNome: string): CorState {
  return {
    corId: c.corId,
    corNome,
    kgsContratados: String(c.kgsContratados),
    qtdRolosContratados: String(c.qtdRolosContratados),
    precoPorKg: String(c.precoPorKg),
    pesosRolos: c.pesosRolos.map((p) => String(p)),
  };
}

function fornecedorStateFromPayload(
  f: FornecedorCompra,
  fornecedorNome: string,
  whatsapp: string | null,
): FornecedorState {
  return {
    fornecedorId: f.fornecedorId,
    fornecedorNome,
    whatsapp,
    observacoes: f.observacoes ?? "",
    cores: f.cores.map((c) => corStateFromPayload(c, "")),
  };
}

export function SubtaskCompra({
  subtask,
  opNumero,
  contaId,
  onAlterado,
}: SubtaskCompraProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const { isAdmin } = usePapelAtivo();
  const payload = (subtask.payload ?? {}) as SubtaskCompraPayload;

  const podeEditar =
    subtask.status === "em_andamento" || subtask.status === "pendente";
  const readOnly =
    subtask.status === "concluida" || subtask.status === "cancelada";

  // ── Top-level ─────────────────────────────────────────────────────
  const [tipoTecidoId, setTipoTecidoId] = useState(
    payload.tipoTecidoId ?? "",
  );
  // RITM-32: distribuição multi-oficina substitui destinatarioCorteId.
  const [distribuicaoOficinas, setDistribuicaoOficinas] = useState<
    DistribuicaoOficina[]
  >(payload.distribuicaoOficinas ?? []);
  const [modalDistribuicaoOpen, setModalDistribuicaoOpen] = useState(false);
  const [gramaturaGM2, setGramaturaGM2] = useState(
    payload.gramaturaGM2 !== undefined ? String(payload.gramaturaGM2) : "",
  );
  const [toleranciaMatchingPct, setToleranciaMatchingPct] = useState(
    payload.toleranciaMatchingPct !== undefined
      ? String(payload.toleranciaMatchingPct)
      : "",
  );
  const [larguraRoloCm, setLarguraRoloCm] = useState(
    payload.larguraRoloCm !== undefined ? String(payload.larguraRoloCm) : "",
  );
  const [observacoes, setObservacoes] = useState(payload.observacoes ?? "");

  // ── Fornecedores ──────────────────────────────────────────────────
  const [fornecedores, setFornecedores] = useState<FornecedorState[]>(() =>
    (payload.fornecedores ?? []).map((f) =>
      fornecedorStateFromPayload(f, "", null),
    ),
  );

  // ── Refs e nav teclado dos inputs de peso de rolo (RITM-31) ──────
  // Map<"idxF-idxC-idxR", HTMLInputElement>. Crescer um pouco com refs
  // zumbis é ok — pra OPs típicas falamos de dezenas de entries.
  const pesoInputRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());
  // Espelho de `fornecedores` pra closures dos callbacks lerem versão
  // atualizada sem precisar invalidar useCallback a cada render.
  const fornecedoresRef = useRef(fornecedores);
  useEffect(() => {
    fornecedoresRef.current = fornecedores;
  }, [fornecedores]);

  const registerPesoRef = useCallback(
    (key: string, el: HTMLInputElement | null) => {
      if (el) pesoInputRefs.current.set(key, el);
      else pesoInputRefs.current.delete(key);
    },
    [],
  );

  const focarPesoProximo = useCallback(
    (idxF: number, idxC: number, idxR: number, direcao: 1 | -1) => {
      const fs = fornecedoresRef.current;
      const focar = (key: string) => {
        const el = pesoInputRefs.current.get(key);
        if (el) {
          el.focus();
          el.select();
        }
      };

      const fornecedor = fs[idxF];
      if (!fornecedor) return;

      // (a) Mesma cor, rolo adjacente
      const cor = fornecedor.cores[idxC];
      if (cor) {
        const proxR = idxR + direcao;
        if (proxR >= 0 && proxR < cor.pesosRolos.length) {
          focar(`${idxF}-${idxC}-${proxR}`);
          return;
        }
      }

      // (b) Cor seguinte/anterior no mesmo fornecedor (com pesosRolos > 0)
      let proxIdxC = idxC + direcao;
      while (proxIdxC >= 0 && proxIdxC < fornecedor.cores.length) {
        const proxCor = fornecedor.cores[proxIdxC];
        if (proxCor.pesosRolos.length > 0) {
          const proxR = direcao === 1 ? 0 : proxCor.pesosRolos.length - 1;
          focar(`${idxF}-${proxIdxC}-${proxR}`);
          return;
        }
        proxIdxC += direcao;
      }

      // (c) Próximo fornecedor (primeira/última cor com pesosRolos > 0)
      let proxIdxF = idxF + direcao;
      while (proxIdxF >= 0 && proxIdxF < fs.length) {
        const proxF = fs[proxIdxF];
        const ordem =
          direcao === 1
            ? proxF.cores.map((c, i) => ({ c, i }))
            : proxF.cores.map((c, i) => ({ c, i })).reverse();
        for (const { c, i } of ordem) {
          if (c.pesosRolos.length > 0) {
            const proxR = direcao === 1 ? 0 : c.pesosRolos.length - 1;
            focar(`${proxIdxF}-${i}-${proxR}`);
            return;
          }
        }
        proxIdxF += direcao;
      }

      // (d) Nada adiante — blur do input atual
      const atual = pesoInputRefs.current.get(`${idxF}-${idxC}-${idxR}`);
      atual?.blur();
    },
    [],
  );

  // Loading flags
  const [salvando, setSalvando] = useState(false);
  const [concluindo, setConcluindo] = useState(false);

  // ── Hidrata nomes de cor a partir do API ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ids = new Set<string>();
      for (const f of fornecedores) {
        for (const c of f.cores) ids.add(c.corId);
      }
      if (ids.size === 0) return;
      const res = await fetch(
        `/api/confeccao/cores?pageSize=100&incluirInativos=true`,
        { cache: "no-store" },
      );
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as {
        items: Array<{ id: string; nome: string }>;
      };
      const mapa = new Map(data.items.map((i) => [i.id, i.nome]));
      setFornecedores((prev) =>
        prev.map((f) => ({
          ...f,
          cores: f.cores.map((c) => ({
            ...c,
            corNome: c.corNome || (mapa.get(c.corId) ?? "?"),
          })),
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
    // Re-hidrata se a quantidade de fornecedores ou de cores muda
  }, [
    fornecedores.length,
    fornecedores.reduce((s, f) => s + f.cores.length, 0),
  ]);

  // ── Hidrata nomes/WhatsApp dos fornecedores ──────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (let i = 0; i < fornecedores.length; i++) {
        const f = fornecedores[i];
        if (!f.fornecedorId || f.fornecedorNome) continue;
        const res = await fetch(
          `/api/confeccao/fornecedores/${f.fornecedorId}`,
          { cache: "no-store" },
        );
        if (!res.ok || cancelled) continue;
        const data = (await res.json()) as {
          item: { id: string; nome: string; whatsapp: string | null };
        };
        setFornecedores((prev) =>
          prev.map((x, idx) =>
            idx === i
              ? {
                  ...x,
                  fornecedorNome: data.item.nome,
                  whatsapp: data.item.whatsapp ?? null,
                }
              : x,
          ),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fornecedores.map((f) => f.fornecedorId).join("|")]);

  // ── Mutações de fornecedores/cores ────────────────────────────────

  function adicionarFornecedor(fornecedorId: string, nome: string) {
    if (fornecedores.some((f) => f.fornecedorId === fornecedorId)) {
      toast.info("Fornecedor já adicionado — edite o card existente.");
      return;
    }
    setFornecedores((prev) => [
      ...prev,
      {
        fornecedorId,
        fornecedorNome: nome,
        whatsapp: null,
        observacoes: "",
        cores: [],
      },
    ]);
  }

  function removerFornecedor(idx: number) {
    setFornecedores((prev) => prev.filter((_, i) => i !== idx));
  }

  function atualizarObservacoesFornecedor(idx: number, v: string) {
    setFornecedores((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, observacoes: v } : f)),
    );
  }

  function adicionarCorAoFornecedor(
    idxFornecedor: number,
    corId: string,
    corNome: string,
  ) {
    setFornecedores((prev) => {
      const f = prev[idxFornecedor];
      if (!f) return prev;
      if (f.cores.some((c) => c.corId === corId)) {
        toast.info("Cor já existe neste fornecedor — edite a linha.");
        return prev;
      }
      return prev.map((x, i) =>
        i === idxFornecedor ? { ...x, cores: [...x.cores, corVazia(corId, corNome)] } : x,
      );
    });
  }

  function removerCor(idxFornecedor: number, idxCor: number) {
    setFornecedores((prev) =>
      prev.map((f, i) =>
        i === idxFornecedor
          ? { ...f, cores: f.cores.filter((_, j) => j !== idxCor) }
          : f,
      ),
    );
  }

  function atualizarCampoCor(
    idxFornecedor: number,
    idxCor: number,
    campo: "kgsContratados" | "precoPorKg",
    valor: string,
  ) {
    setFornecedores((prev) =>
      prev.map((f, i) =>
        i === idxFornecedor
          ? {
              ...f,
              cores: f.cores.map((c, j) =>
                j === idxCor ? { ...c, [campo]: valor } : c,
              ),
            }
          : f,
      ),
    );
  }

  // Sincroniza pesosRolos quando qtdRolosContratados muda.
  // Pad com strings vazias se cresceu; trunca do fim se diminuiu
  // (com confirm se vai descartar peso não-vazio).
  function atualizarQtdRolos(
    idxFornecedor: number,
    idxCor: number,
    valor: string,
  ) {
    const n = valor === "" ? 0 : Math.max(0, Math.floor(Number(valor) || 0));

    setFornecedores((prev) =>
      prev.map((f, i) => {
        if (i !== idxFornecedor) return f;
        return {
          ...f,
          cores: f.cores.map((c, j) => {
            if (j !== idxCor) return c;
            const atual = c.pesosRolos;
            let novo: string[];
            if (n > atual.length) {
              novo = [...atual, ...Array(n - atual.length).fill("")];
            } else if (n < atual.length) {
              const descartados = atual.slice(n);
              const algumPreenchido = descartados.some((p) => p.trim());
              if (algumPreenchido) {
                if (
                  !window.confirm(
                    `Reduzir pra ${n} rolos vai descartar ${descartados.length} peso(s) já preenchido(s). Continuar?`,
                  )
                ) {
                  return c; // mantém estado anterior
                }
              }
              novo = atual.slice(0, n);
            } else {
              novo = atual;
            }
            return {
              ...c,
              qtdRolosContratados: valor,
              pesosRolos: novo,
            };
          }),
        };
      }),
    );
  }

  function atualizarPesoRolo(
    idxFornecedor: number,
    idxCor: number,
    idxRolo: number,
    valor: string,
  ) {
    setFornecedores((prev) =>
      prev.map((f, i) =>
        i === idxFornecedor
          ? {
              ...f,
              cores: f.cores.map((c, j) =>
                j === idxCor
                  ? {
                      ...c,
                      pesosRolos: c.pesosRolos.map((p, k) =>
                        k === idxRolo ? valor : p,
                      ),
                    }
                  : c,
              ),
            }
          : f,
      ),
    );
  }

  // RITM-30: cola N pesos a partir de `idxRoloInicial`. Expande
  // pesosRolos + qtdRolosContratados se a colagem passar do tamanho
  // atual — comportamento Excel-like (copio coluna de 30, colo,
  // sistema reconhece e abre 30 slots).
  function colarPesos(
    idxFornecedor: number,
    idxCor: number,
    idxRoloInicial: number,
    valores: number[],
  ) {
    if (valores.length === 0) return;
    setFornecedores((prev) =>
      prev.map((f, i) => {
        if (i !== idxFornecedor) return f;
        return {
          ...f,
          cores: f.cores.map((c, j) => {
            if (j !== idxCor) return c;
            const novo = [...c.pesosRolos];
            for (let k = 0; k < valores.length; k++) {
              const pos = idxRoloInicial + k;
              const str = String(valores[k]);
              if (pos < novo.length) {
                novo[pos] = str;
              } else {
                // expande com strings vazias até pos, depois grava
                while (novo.length < pos) novo.push("");
                novo.push(str);
              }
            }
            const cresceu = novo.length > c.pesosRolos.length;
            return {
              ...c,
              pesosRolos: novo,
              qtdRolosContratados: cresceu
                ? String(novo.length)
                : c.qtdRolosContratados,
            };
          }),
        };
      }),
    );
  }

  // ── Montagem do payload ───────────────────────────────────────────
  const payloadAtual = useMemo<SubtaskCompraPayload>(() => {
    const out: SubtaskCompraPayload = {
      fornecedores: fornecedores.map<FornecedorCompra>((f) => ({
        fornecedorId: f.fornecedorId,
        observacoes: f.observacoes.trim() || undefined,
        cores: f.cores.map<CorContratada>((c) => ({
          corId: c.corId,
          kgsContratados: normalizarNumero(c.kgsContratados),
          qtdRolosContratados: Math.max(
            0,
            Math.floor(normalizarNumero(c.qtdRolosContratados)),
          ),
          precoPorKg: normalizarNumero(c.precoPorKg),
          pesosRolos: c.pesosRolos
            .filter((p) => p.trim() !== "")
            .map((p) => normalizarNumero(p)),
        })),
      })),
    };
    if (tipoTecidoId) out.tipoTecidoId = tipoTecidoId;
    if (distribuicaoOficinas.length > 0)
      out.distribuicaoOficinas = distribuicaoOficinas;
    if (gramaturaGM2.trim()) out.gramaturaGM2 = normalizarNumero(gramaturaGM2);
    if (larguraRoloCm.trim()) out.larguraRoloCm = normalizarNumero(larguraRoloCm);
    if (toleranciaMatchingPct.trim())
      out.toleranciaMatchingPct = normalizarNumero(toleranciaMatchingPct);
    if (observacoes.trim()) out.observacoes = observacoes;
    return out;
  }, [
    fornecedores,
    tipoTecidoId,
    distribuicaoOficinas,
    gramaturaGM2,
    larguraRoloCm,
    toleranciaMatchingPct,
    observacoes,
  ]);

  // ── Auto-save debounced (800ms) ───────────────────────────────────
  const ultimoPayloadEnviadoRef = useRef<string>(JSON.stringify(payload));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (readOnly) return;
    const serializado = JSON.stringify(payloadAtual);
    if (serializado === ultimoPayloadEnviadoRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void salvarPayload(payloadAtual).then(() => {
        ultimoPayloadEnviadoRef.current = serializado;
      });
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [payloadAtual, readOnly]);

  const salvarPayload = useCallback(
    async (p: SubtaskCompraPayload) => {
      setSalvando(true);
      try {
        const res = await fetch(
          `/api/confeccao/subtasks/${subtask.id}/payload`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payload: p }),
          },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? "Erro ao salvar");
          return false;
        }
        return true;
      } finally {
        setSalvando(false);
      }
    },
    [subtask.id],
  );

  // ── Conclusão ─────────────────────────────────────────────────────
  async function concluir() {
    setConcluindo(true);
    try {
      // Garante último estado salvo antes de concluir
      const ok = await salvarPayload(payloadAtual);
      if (!ok) return;
      const res = await fetch(
        `/api/confeccao/subtasks/${subtask.id}/concluir`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao concluir");
        return;
      }
      toast.success(
        data.subtask?.proximaDesbloqueada
          ? `Concluída. Próxima desbloqueada: ${data.subtask.proximaDesbloqueada.numero}`
          : "Subtask concluída",
      );
      onAlterado();
      router.refresh();
    } finally {
      setConcluindo(false);
    }
  }

  // ── Mapa corId → nome (pra passar ao modal de distribuição) ──────
  const coresNomes = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fornecedores) {
      for (const c of f.cores) {
        if (c.corNome) m.set(c.corId, c.corNome);
      }
    }
    return m;
  }, [fornecedores]);

  // ── Saldo de distribuição (RITM-32) ───────────────────────────────
  const saldoDistribuicao = useMemo(
    () => calcularSaldoDistribuicao(payloadAtual),
    [payloadAtual],
  );
  const saldoTotalDescasado = useMemo(() => {
    let s = 0;
    for (const { saldo } of saldoDistribuicao.values()) s += saldo;
    return s;
  }, [saldoDistribuicao]);
  const distribuicaoCompleta =
    saldoDistribuicao.size > 0 &&
    Array.from(saldoDistribuicao.values()).every((v) => v.saldo === 0);
  const distribuicaoVazia = distribuicaoOficinas.length === 0;
  const temContratado = saldoDistribuicao.size > 0;

  // ── Summary derivado ──────────────────────────────────────────────
  const summary = useMemo(() => {
    let contratado = 0;
    let recebido = 0;
    let custo = 0;
    let temPeso = false;
    for (const f of fornecedores) {
      for (const c of f.cores) {
        contratado += normalizarNumero(c.kgsContratados);
        for (const p of c.pesosRolos) {
          if (p.trim() === "") continue;
          const n = normalizarNumero(p);
          recebido += n;
          custo += n * normalizarNumero(c.precoPorKg);
          temPeso = true;
        }
      }
    }
    const diff = temPeso ? recebido - contratado : null;
    const diffPct =
      diff !== null && contratado > 0 ? diff / contratado : null;
    return { contratado, recebido: temPeso ? recebido : null, diff, diffPct, custo: temPeso ? custo : null };
  }, [fornecedores]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="font-medium">Compra de Tecido</h3>
          <p className="text-xs text-muted-foreground">
            Multi-fornecedor. Digite a qtd de rolos contratada e o sistema
            gera os campos de peso. Salvamento automático.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {salvando && (
            <span className="text-xs text-muted-foreground">salvando…</span>
          )}
          {podeEditar && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setModalDistribuicaoOpen(true)}
              disabled={!temContratado}
              title={
                !temContratado
                  ? "Preencha qtd. de rolos contratados antes de planejar a distribuição"
                  : undefined
              }
            >
              {distribuicaoVazia ? (
                "Planejar distribuição"
              ) : distribuicaoCompleta ? (
                <span className="text-emerald-700">
                  ✓ Distribuição completa
                </span>
              ) : saldoTotalDescasado > 0 ? (
                <span className="text-amber-700">
                  ⚠ {saldoTotalDescasado} rolo(s) sem destino
                </span>
              ) : (
                <span className="text-destructive">
                  ⚠ {-saldoTotalDescasado} rolo(s) excedente(s)
                </span>
              )}
            </Button>
          )}
          {podeEditar && (
            <Button
              onClick={concluir}
              disabled={
                concluindo ||
                salvando ||
                !temContratado ||
                !distribuicaoCompleta
              }
              size="sm"
              title={
                !temContratado
                  ? "Adicione cores e qtd. de rolos antes de concluir"
                  : !distribuicaoCompleta
                    ? "Distribua todos os rolos entre oficinas antes de concluir"
                    : undefined
              }
            >
              <CheckCircle2 className="size-3.5" />
              {concluindo ? "Concluindo…" : "Concluir"}
            </Button>
          )}
        </div>
      </div>

      {/* ── Config top-level ───────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Configuração do tecido</CardTitle>
          <CardDescription>
            Tipo, gramatura e largura — valem para toda a OP independente
            de quantos fornecedores. O destino do tecido (oficinas) é
            planejado no botão &ldquo;Planejar distribuição&rdquo; acima.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Tipo de tecido</Label>
            <LookupComCadastroInline
              endpoint="/api/confeccao/tipos-tecido"
              value={tipoTecidoId}
              onChange={(id) => setTipoTecidoId(id)}
              entidadeLabel="tipo de tecido"
              permiteCadastrar={isAdmin}
              cadastroInlineRender={
                isAdmin
                  ? ({ onCreated, onCancel }) => (
                      <CriarTipoTecidoForm
                        onCreated={onCreated}
                        onCancel={onCancel}
                      />
                    )
                  : undefined
              }
              disabled={!podeEditar}
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <Label>Gramatura (g/m²)</Label>
            <Input
              type="number"
              step="1"
              inputMode="numeric"
              value={gramaturaGM2}
              onChange={(e) => setGramaturaGM2(e.target.value)}
              disabled={!podeEditar}
              placeholder="220"
            />
          </div>
          <div className="space-y-2">
            <Label>Largura do rolo (cm)</Label>
            <Input
              type="number"
              step="0.5"
              inputMode="decimal"
              value={larguraRoloCm}
              onChange={(e) => setLarguraRoloCm(e.target.value)}
              disabled={!podeEditar}
              placeholder="180"
            />
          </div>
          {/* RITM-34: tolerância usada na view Matching de Rolos */}
          <div className="space-y-2">
            <Label>Tolerância matching de rolos (%)</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="100"
              inputMode="decimal"
              value={toleranciaMatchingPct}
              onChange={(e) => setToleranciaMatchingPct(e.target.value)}
              disabled={!podeEditar}
              placeholder="5"
            />
            <p className="text-[11px] text-muted-foreground">
              Diferença máxima permitida entre peso do fornecedor e do
              cortador antes de marcar alerta. Default 5%.
            </p>
          </div>
          <div className="md:col-span-2 space-y-2">
            <Label>Observações gerais</Label>
            <Textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={2}
              maxLength={2000}
              disabled={!podeEditar}
              placeholder="Acabamento, prazo, etc."
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Fornecedores ───────────────────────────────────────── */}
      {fornecedores.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Nenhum fornecedor adicionado ainda.
          </CardContent>
        </Card>
      )}

      {fornecedores.map((f, idxF) => (
        <FornecedorCard
          key={`${f.fornecedorId}-${idxF}`}
          fornecedor={f}
          idxFornecedor={idxF}
          opNumero={opNumero}
          subtaskId={subtask.id}
          subtaskNumero={subtask.numero}
          podeEditar={podeEditar}
          isAdmin={isAdmin}
          onRemover={() => removerFornecedor(idxF)}
          onObservacoesChange={(v) => atualizarObservacoesFornecedor(idxF, v)}
          onAdicionarCor={(corId, corNome) =>
            adicionarCorAoFornecedor(idxF, corId, corNome)
          }
          onRemoverCor={(idxC) => removerCor(idxF, idxC)}
          onAtualizarCampoCor={(idxC, campo, v) =>
            atualizarCampoCor(idxF, idxC, campo, v)
          }
          onAtualizarQtdRolos={(idxC, v) => atualizarQtdRolos(idxF, idxC, v)}
          onAtualizarPesoRolo={(idxC, idxR, v) =>
            atualizarPesoRolo(idxF, idxC, idxR, v)
          }
          onColarPesos={(idxC, idxR, valores) =>
            colarPesos(idxF, idxC, idxR, valores)
          }
          registerPesoRef={registerPesoRef}
          focarPesoProximo={focarPesoProximo}
        />
      ))}

      {podeEditar && (
        <LookupComCadastroInline
          endpoint="/api/confeccao/fornecedores"
          extraQuery={{ categoria: "tecido" }}
          value=""
          onChange={(id, item) =>
            adicionarFornecedor(id, (item as { nome: string }).nome ?? "?")
          }
          entidadeLabel="fornecedor"
          placeholder="+ Adicionar fornecedor de tecido"
          permiteCadastrar={isAdmin}
          cadastroInlineRender={
            isAdmin
              ? ({ onCreated, onCancel }) => (
                  <FormFornecedorRapido
                    categoriaInicial="tecido"
                    onCreated={onCreated}
                    onCancel={onCancel}
                  />
                )
              : undefined
          }
          className="w-full"
        />
      )}

      {/* ── Summary global ──────────────────────────────────────── */}
      <Card className="bg-amber-50/60 border-amber-200">
        <CardContent className="py-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Contratado
              </div>
              <div className="font-semibold tabular-nums">
                {summary.contratado.toLocaleString("pt-BR", {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}{" "}
                kg
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Recebido
              </div>
              <div
                className={cn(
                  "font-semibold tabular-nums",
                  summary.diffPct !== null &&
                    Math.abs(summary.diffPct) > 0.05 &&
                    "text-amber-700",
                  summary.diffPct !== null &&
                    summary.diffPct < -0.1 &&
                    "text-destructive",
                )}
              >
                {summary.recebido === null
                  ? "—"
                  : `${summary.recebido.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`}
                {summary.diff !== null && summary.diffPct !== null && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    ({summary.diff > 0 ? "+" : ""}
                    {(summary.diffPct * 100).toLocaleString("pt-BR", {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                    %)
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Custo total
              </div>
              <div className="font-semibold tabular-nums">
                {summary.custo === null
                  ? "—"
                  : summary.custo.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Anexos ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Anexos</CardTitle>
        </CardHeader>
        <CardContent>
          <UploadAnexo
            subtaskId={subtask.id}
            opNumero={opNumero}
            subtaskNumero={subtask.numero}
            categoria="nf_compra"
            contaId={contaId}
            label="Nota Fiscal"
            disabled={!podeEditar || !session}
          />
        </CardContent>
      </Card>

      {/* ── Lalamove ────────────────────────────────────────────── */}
      <BlocoLalamove
        subtaskId={subtask.id}
        contaId={contaId}
        opNumero={opNumero}
        subtaskNumero={subtask.numero}
        readOnly={readOnly}
      />

      {/* ── Modal de distribuição multi-oficina (RITM-32) ───────── */}
      <ModalDistribuicaoCompra
        open={modalDistribuicaoOpen}
        onOpenChange={setModalDistribuicaoOpen}
        payload={payloadAtual}
        coresNomes={coresNomes}
        isAdmin={isAdmin}
        disabled={!podeEditar}
        onSalvar={(dist) => {
          setDistribuicaoOficinas(dist);
        }}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Card de fornecedor
// ──────────────────────────────────────────────────────────────────────

function FornecedorCard(props: {
  fornecedor: FornecedorState;
  idxFornecedor: number;
  opNumero: string;
  subtaskId: string;
  subtaskNumero: string;
  podeEditar: boolean;
  isAdmin: boolean;
  onRemover: () => void;
  onObservacoesChange: (v: string) => void;
  onAdicionarCor: (corId: string, corNome: string) => void;
  onRemoverCor: (idxCor: number) => void;
  onAtualizarCampoCor: (
    idxCor: number,
    campo: "kgsContratados" | "precoPorKg",
    valor: string,
  ) => void;
  onAtualizarQtdRolos: (idxCor: number, valor: string) => void;
  onAtualizarPesoRolo: (idxCor: number, idxRolo: number, valor: string) => void;
  onColarPesos: (idxCor: number, idxRoloInicial: number, valores: number[]) => void;
  registerPesoRef: (key: string, el: HTMLInputElement | null) => void;
  focarPesoProximo: (
    idxF: number,
    idxC: number,
    idxR: number,
    direcao: 1 | -1,
  ) => void;
}) {
  const {
    fornecedor: f,
    idxFornecedor,
    podeEditar,
    isAdmin,
    onRemover,
    onObservacoesChange,
    onAdicionarCor,
    onRemoverCor,
    onAtualizarCampoCor,
    onAtualizarQtdRolos,
    onAtualizarPesoRolo,
    onColarPesos,
    registerPesoRef,
    focarPesoProximo,
  } = props;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              Fornecedor #{idxFornecedor + 1}: {f.fornecedorNome || "(carregando)"}
            </CardTitle>
            <CardDescription>
              Cores compradas deste fornecedor.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {f.whatsapp && (
              <WhatsappTemplatePicker
                categoria="tecido"
                opNumero={props.opNumero}
                subtaskId={props.subtaskId}
                telefone={f.whatsapp}
                destinatarioNome={f.fornecedorNome}
                fornecedorId={f.fornecedorId}
                mensagemFallback={`Olá, {fornecedor_nome}. Sobre a OP {op_numero} (${props.subtaskNumero}):\n\nGostaria de confirmar o pedido de tecido. Aguardo retorno.`}
                contexto={`Compra de Tecido — OP ${props.opNumero}`}
                label="WhatsApp"
              />
            )}
            {podeEditar && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRemover}
                title="Remover fornecedor"
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Tabela de cores */}
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-1.5">Cor</th>
                <th className="text-right p-1.5">Kgs contratados</th>
                <th className="text-right p-1.5">Qtd rolos</th>
                <th className="text-right p-1.5">R$/kg</th>
                <th className="text-right p-1.5">Kg real</th>
                <th className="text-right p-1.5">Diff</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {f.cores.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="text-center py-3 text-xs text-muted-foreground italic"
                  >
                    Sem cores. Adicione abaixo.
                  </td>
                </tr>
              )}
              {f.cores.map((c, idxC) => {
                const kgsContratados = normalizarNumero(c.kgsContratados);
                const kgsReais = c.pesosRolos.reduce(
                  (s, p) => s + (p.trim() ? normalizarNumero(p) : 0),
                  0,
                );
                const algumPeso = c.pesosRolos.some((p) => p.trim() !== "");
                const diff = algumPeso ? kgsReais - kgsContratados : null;
                const diffPct =
                  diff !== null && kgsContratados > 0
                    ? diff / kgsContratados
                    : null;
                return (
                  <tr key={c.corId} className="border-b last:border-0">
                    <td className="p-1.5">
                      <Badge variant="outline" className="font-normal">
                        {c.corNome || "?"}
                      </Badge>
                    </td>
                    <td className="p-1.5 text-right">
                      <Input
                        type="number"
                        step="0.1"
                        inputMode="decimal"
                        value={c.kgsContratados}
                        onChange={(e) =>
                          onAtualizarCampoCor(
                            idxC,
                            "kgsContratados",
                            e.target.value,
                          )
                        }
                        disabled={!podeEditar}
                        className="w-24 h-8 text-right text-sm tabular-nums"
                      />
                    </td>
                    <td className="p-1.5 text-right">
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        inputMode="numeric"
                        value={c.qtdRolosContratados}
                        onChange={(e) =>
                          onAtualizarQtdRolos(idxC, e.target.value)
                        }
                        disabled={!podeEditar}
                        className="w-20 h-8 text-right text-sm tabular-nums"
                      />
                    </td>
                    <td className="p-1.5 text-right">
                      <Input
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        value={c.precoPorKg}
                        onChange={(e) =>
                          onAtualizarCampoCor(idxC, "precoPorKg", e.target.value)
                        }
                        disabled={!podeEditar}
                        className="w-24 h-8 text-right text-sm tabular-nums"
                      />
                    </td>
                    <td className="p-1.5 text-right text-sm tabular-nums">
                      {algumPeso
                        ? kgsReais.toLocaleString("pt-BR", {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })
                        : "—"}
                    </td>
                    <td
                      className={cn(
                        "p-1.5 text-right text-xs tabular-nums",
                        diffPct === null && "text-muted-foreground",
                        diffPct !== null &&
                          Math.abs(diffPct) > 0.05 &&
                          "text-amber-700",
                        diffPct !== null &&
                          diffPct < -0.1 &&
                          "text-destructive",
                      )}
                    >
                      {diffPct === null
                        ? "—"
                        : `${diffPct > 0 ? "+" : ""}${(diffPct * 100).toFixed(1)}%`}
                    </td>
                    <td className="p-1.5 text-right">
                      {podeEditar && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onRemoverCor(idxC)}
                          className="h-7 w-7"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {podeEditar && (
          <LookupComCadastroInline
            endpoint="/api/confeccao/cores"
            value=""
            onChange={(id, item) =>
              onAdicionarCor(id, (item as { nome: string }).nome ?? "?")
            }
            entidadeLabel="cor"
            placeholder="+ Adicionar cor"
            permiteCadastrar={isAdmin}
            cadastroInlineRender={
              isAdmin
                ? ({ onCreated, onCancel }) => (
                    <CriarCorForm onCreated={onCreated} onCancel={onCancel} />
                  )
                : undefined
            }
            className="w-56 h-8"
          />
        )}

        {/* Spill de pesos por cor — lista vertical com nav por teclado (RITM-31) */}
        {f.cores
          .filter((c) => c.pesosRolos.length > 0)
          .map((c) => {
            // recupera idx original na lista (filter pode reordenar)
            const idxC = f.cores.findIndex((x) => x.corId === c.corId);
            const preenchidos = c.pesosRolos.filter(
              (p) => p.trim() !== "",
            ).length;
            const somaKg = c.pesosRolos.reduce(
              (s, p) => s + (p.trim() ? normalizarNumero(p) : 0),
              0,
            );
            return (
              <div
                key={c.corId}
                className="rounded border bg-muted/20 p-3 space-y-2"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    Pesos dos rolos · {c.corNome || "?"} ·{" "}
                    <span className="tabular-nums">
                      {preenchidos}/{c.pesosRolos.length}
                    </span>{" "}
                    informados ·{" "}
                    <span className="tabular-nums">
                      {somaKg.toLocaleString("pt-BR", {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}
                    </span>{" "}
                    kg
                  </div>
                  <div className="text-[10px] text-muted-foreground/70">
                    Enter avança · ↑/↓ navega · Ctrl+V cola coluna do Excel
                  </div>
                </div>
                <div
                  className="flex flex-col gap-1 max-w-xs"
                  role="list"
                  aria-label={`Pesos dos rolos da cor ${c.corNome || "?"}`}
                >
                  {c.pesosRolos.map((p, idxR) => (
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
                          registerPesoRef(
                            `${idxFornecedor}-${idxC}-${idxR}`,
                            el,
                          )
                        }
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        value={p}
                        onChange={(e) =>
                          onAtualizarPesoRolo(idxC, idxR, e.target.value)
                        }
                        onFocus={(e) => e.currentTarget.select()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            focarPesoProximo(
                              idxFornecedor,
                              idxC,
                              idxR,
                              e.shiftKey ? -1 : 1,
                            );
                          } else if (e.key === "ArrowDown") {
                            e.preventDefault();
                            focarPesoProximo(idxFornecedor, idxC, idxR, 1);
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            focarPesoProximo(idxFornecedor, idxC, idxR, -1);
                          }
                          // Tab: comportamento nativo
                        }}
                        onPaste={(e) => {
                          const texto =
                            e.clipboardData.getData("text/plain") ?? "";
                          const valores = parsePesosColados(texto);
                          if (valores.length <= 1) return; // 0 ou 1 valor: default
                          e.preventDefault();
                          onColarPesos(idxC, idxR, valores);
                          toast.success(
                            `${valores.length} pesos colados a partir do rolo R${idxR + 1}`,
                          );
                        }}
                        disabled={!podeEditar}
                        placeholder="kg"
                        className="h-8 text-sm text-right tabular-nums w-28"
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

        {/* Observações por fornecedor */}
        <div className="space-y-2">
          <Label className="text-xs">Observações deste fornecedor</Label>
          <Textarea
            value={f.observacoes}
            onChange={(e) => onObservacoesChange(e.target.value)}
            rows={2}
            maxLength={2000}
            disabled={!podeEditar}
            placeholder="Pedido, prazo de entrega, condições especiais…"
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Forms de cadastro inline (idênticos ao original)
// ──────────────────────────────────────────────────────────────────────

function CriarTipoTecidoForm({
  onCreated,
  onCancel,
}: {
  onCreated: (item: { id: string; nome: string }) => void;
  onCancel: () => void;
}) {
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSalvando(true);
        try {
          const res = await fetch(`/api/confeccao/tipos-tecido`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome: nome.trim() }),
          });
          const data = await res.json();
          if (!res.ok) {
            toast.error(data.error ?? "Erro");
            return;
          }
          onCreated(data.item);
        } finally {
          setSalvando(false);
        }
      }}
    >
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          autoFocus
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvando || !nome.trim()}>
          {salvando ? "Salvando…" : "Criar"}
        </Button>
      </div>
    </form>
  );
}

function CriarCorForm({
  onCreated,
  onCancel,
}: {
  onCreated: (item: { id: string; nome: string }) => void;
  onCancel: () => void;
}) {
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSalvando(true);
        try {
          const res = await fetch(`/api/confeccao/cores`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome: nome.trim() }),
          });
          const data = await res.json();
          if (!res.ok) {
            toast.error(data.error ?? "Erro");
            return;
          }
          onCreated(data.item);
        } finally {
          setSalvando(false);
        }
      }}
    >
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          autoFocus
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvando || !nome.trim()}>
          {salvando ? "Salvando…" : "Criar"}
        </Button>
      </div>
    </form>
  );
}
