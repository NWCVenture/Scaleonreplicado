// Persistência de bipes (RITM-17).
//
// Responsabilidades:
//   - INSERT em central_envios_bipagem_pacote (com mapeamento de categoria)
//   - detect duplicação cross-session
//   - INSERT em central_envios_notificacao na sessão da outra ponta
//
// Não decide. Caller já tem o resultado do classificador e a ação
// (no caso de cancelado).

import { and, eq, gt, inArray, ne } from "drizzle-orm";
import {
  centralEnviosBipagemPacote,
  centralEnviosNotificacao,
  sessaoCentralEnvios,
  user,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import type {
  CategoriaBipe,
  CategoriaRastreador,
  ResultadoClassificacao,
  ResultadoRastreador,
} from "./types";
import type { CentralEnviosBipagemCategoria } from "@/lib/db/schema";

type Tx = Parameters<
  Parameters<typeof import("@/lib/db").db.transaction>[0]
>[0];

// Duplicação cross-session só se aplica quando o pacote físico "saiu" —
// não disparar pra duplicado, fora_lote, desconhecida, etc.
const CATEGORIAS_QUE_DUPLICAM = new Set<CentralEnviosBipagemCategoria>([
  "OK",
  "CANCELADO_ENVIADO_MESMO_ASSIM",
  "LOCALIZADOR_ACHADO",
]);

const JANELA_DUP_HORAS = 48;

export type DuplicacaoCrossSessao = {
  outraSessaoId: string;
  outroUsuarioId: string;
  outroUsuarioNome: string | null;
  outroBipadoEm: string;
};

export type ResultadoPersistencia = {
  bipagemId: string | null;
  persistido: boolean;
  categoriaPersistida: CentralEnviosBipagemCategoria | null;
  duplicacoesCrossSessao: DuplicacaoCrossSessao[];
};

/**
 * Persiste um único resultado de classificação. Devolve `bipagemId=null`
 * + `persistido=false` quando categoria é CANCELADO bloqueante (esperando
 * decisão via `decidir-cancelado`).
 */
export async function persistirBipe(args: {
  tx: Tx;
  contaId: string;
  sessaoId: string;
  usuarioId: string;
  resultado: ResultadoClassificacao;
}): Promise<ResultadoPersistencia> {
  const { tx, contaId, sessaoId, usuarioId, resultado } = args;

  // CANCELADO bloqueante: não persiste, aguarda decisão.
  if (resultado.categoria === "CANCELADO" && resultado.bloqueante) {
    return {
      bipagemId: null,
      persistido: false,
      categoriaPersistida: null,
      duplicacoesCrossSessao: [],
    };
  }

  const categoriaPersistida = mapearCategoria(resultado.categoria);
  return insertBipe({
    tx,
    contaId,
    sessaoId,
    usuarioId,
    resultado,
    categoriaPersistida,
    acaoCancelado: null,
  });
}

/**
 * Persiste um resultado do modo rastreador (sempre persiste — nunca
 * bloqueante).
 */
export async function persistirRastreador(args: {
  tx: Tx;
  contaId: string;
  sessaoId: string;
  usuarioId: string;
  resultado: ResultadoRastreador;
}): Promise<ResultadoPersistencia> {
  const { tx, contaId, sessaoId, usuarioId, resultado } = args;
  const categoriaPersistida: CentralEnviosBipagemCategoria =
    resultado.categoria === "LOCALIZADOR_ACHADO"
      ? "LOCALIZADOR_ACHADO"
      : "LOCALIZADOR_LIVRE";
  return insertBipe({
    tx,
    contaId,
    sessaoId,
    usuarioId,
    resultado: {
      categoria: "OK" as CategoriaBipe, // placeholder — não usado
      codigoBipado: resultado.codigoBipado,
      trackingId: resultado.trackingId,
      orderId: resultado.pedido?.orderId ?? null,
      pedido: resultado.pedido,
      transportadora: resultado.transportadora,
      bloqueante: false,
    },
    categoriaPersistida,
    acaoCancelado: null,
  });
}

/**
 * Persiste a decisão do operador para um CANCELADO. Caller já validou
 * que o tracking ainda está cancelado no snapshot atual.
 */
export async function persistirDecisaoCancelado(args: {
  tx: Tx;
  contaId: string;
  sessaoId: string;
  usuarioId: string;
  resultado: ResultadoClassificacao;
  acao: "RETIRADO" | "ENVIADO_MESMO_ASSIM";
}): Promise<ResultadoPersistencia> {
  const { tx, contaId, sessaoId, usuarioId, resultado, acao } = args;
  const categoriaPersistida: CentralEnviosBipagemCategoria =
    acao === "RETIRADO"
      ? "CANCELADO_RETIRADO"
      : "CANCELADO_ENVIADO_MESMO_ASSIM";
  return insertBipe({
    tx,
    contaId,
    sessaoId,
    usuarioId,
    resultado,
    categoriaPersistida,
    acaoCancelado: acao,
  });
}

async function insertBipe(args: {
  tx: Tx;
  contaId: string;
  sessaoId: string;
  usuarioId: string;
  resultado:
    | ResultadoClassificacao
    | (Omit<ResultadoClassificacao, "categoria"> & { categoria: CategoriaBipe });
  categoriaPersistida: CentralEnviosBipagemCategoria;
  acaoCancelado: "RETIRADO" | "ENVIADO_MESMO_ASSIM" | null;
}): Promise<ResultadoPersistencia> {
  const {
    tx,
    contaId,
    sessaoId,
    usuarioId,
    resultado,
    categoriaPersistida,
    acaoCancelado,
  } = args;

  const bipagemId = generateId();
  await tx.insert(centralEnviosBipagemPacote).values({
    id: bipagemId,
    sessaoId,
    codigoBipado: resultado.codigoBipado,
    trackingId: resultado.trackingId,
    orderId: resultado.orderId,
    canal: resultado.pedido?.canal ?? null,
    canalVendaId: null,
    categoria: categoriaPersistida,
    transportadora:
      resultado.transportadora === "DESCONHECIDA"
        ? null
        : resultado.transportadora,
    acaoCancelado,
    usuarioId,
    contaId,
  });

  // Cross-session só pra categorias que representam pacote físico saindo.
  let duplicacoes: DuplicacaoCrossSessao[] = [];
  if (
    resultado.trackingId &&
    CATEGORIAS_QUE_DUPLICAM.has(categoriaPersistida)
  ) {
    duplicacoes = await detectarDuplicacoesCrossSessao({
      tx,
      contaId,
      sessaoId,
      trackingId: resultado.trackingId,
    });
    if (duplicacoes.length > 0) {
      await notificarDuplicacoes({
        tx,
        contaId,
        trackingId: resultado.trackingId,
        orderId: resultado.orderId,
        bipadoEmAtual: new Date(),
        duplicacoes,
      });
    }
  }

  return {
    bipagemId,
    persistido: true,
    categoriaPersistida,
    duplicacoesCrossSessao: duplicacoes,
  };
}

async function detectarDuplicacoesCrossSessao(args: {
  tx: Tx;
  contaId: string;
  sessaoId: string;
  trackingId: string;
}): Promise<DuplicacaoCrossSessao[]> {
  const { tx, contaId, sessaoId, trackingId } = args;
  const limite = new Date(Date.now() - JANELA_DUP_HORAS * 60 * 60 * 1000);

  const rows = await tx
    .select({
      bipagemOutraId: centralEnviosBipagemPacote.id,
      outraSessaoId: centralEnviosBipagemPacote.sessaoId,
      outroBipadoEm: centralEnviosBipagemPacote.bipadoEm,
      outroUsuarioId: sessaoCentralEnvios.usuarioId,
      outroUsuarioNome: user.name,
    })
    .from(centralEnviosBipagemPacote)
    .innerJoin(
      sessaoCentralEnvios,
      eq(sessaoCentralEnvios.id, centralEnviosBipagemPacote.sessaoId),
    )
    .innerJoin(user, eq(user.id, sessaoCentralEnvios.usuarioId))
    .where(
      and(
        eq(centralEnviosBipagemPacote.contaId, contaId),
        eq(centralEnviosBipagemPacote.trackingId, trackingId),
        ne(centralEnviosBipagemPacote.sessaoId, sessaoId),
        inArray(
          centralEnviosBipagemPacote.categoria,
          Array.from(CATEGORIAS_QUE_DUPLICAM),
        ),
        gt(centralEnviosBipagemPacote.bipadoEm, limite),
      ),
    );

  return rows.map((r) => ({
    outraSessaoId: r.outraSessaoId,
    outroUsuarioId: r.outroUsuarioId,
    outroUsuarioNome: r.outroUsuarioNome ?? null,
    outroBipadoEm: r.outroBipadoEm.toISOString(),
  }));
}

async function notificarDuplicacoes(args: {
  tx: Tx;
  contaId: string;
  trackingId: string;
  orderId: string | null;
  bipadoEmAtual: Date;
  duplicacoes: DuplicacaoCrossSessao[];
}): Promise<void> {
  const { tx, contaId, trackingId, orderId, bipadoEmAtual, duplicacoes } = args;

  // Notifica cada outra sessão: o operador de lá vai ver no próximo poll
  // que alguém bipou o mesmo tracking depois dele. A própria sessão
  // recebe os dados na resposta da API — não cria notificação pra si.
  const rows = duplicacoes.map((d) => ({
    id: generateId(),
    sessaoDestinoId: d.outraSessaoId,
    tipo: "DUPLICACAO_CROSS_SESSAO" as const,
    payload: {
      trackingId,
      orderId,
      outroBipadoEm: bipadoEmAtual.toISOString(),
    },
    contaId,
  }));

  if (rows.length > 0) {
    await tx.insert(centralEnviosNotificacao).values(rows);
  }
}

function mapearCategoria(c: CategoriaBipe): CentralEnviosBipagemCategoria {
  switch (c) {
    case "OK":
      return "OK";
    case "DUPLICADO":
      return "DUPLICADO";
    case "FORA_LOTE":
      return "FORA_LOTE";
    case "DESCONHECIDA":
      return "DESCONHECIDA";
    case "CANCELADO":
      // Não deveria chegar aqui — caller deve ter detectado bloqueante.
      // Persiste como RETIRADO por padrão pra não perder o registro,
      // mas é defensivo: o caminho normal é `persistirDecisaoCancelado`.
      throw new Error(
        "mapearCategoria: CANCELADO bloqueante não deve persistir sem ação",
      );
  }
}

