// Helpers de busca de destinatários do RITM-17.
//
// Funções rodam fora da transação principal (após commit) com cliente
// `db` direto. Nenhuma escreve no banco. Falhas → logam e retornam vazio
// pra não quebrar o disparo de notificações.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  confeccaoOrdemProducao,
  confeccaoProduto,
  confeccaoSubtask,
  user,
  usuarioConta,
} from "@/lib/db/schema";

export interface DestinatarioBasico {
  id: string;
  name: string;
  email: string;
}

export async function buscarUsuario(
  id: string | null | undefined,
): Promise<DestinatarioBasico | null> {
  if (!id) return null;
  try {
    const [u] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, id));
    if (!u || !u.email) return null;
    return u;
  } catch (err) {
    console.warn("[email] buscarUsuario falhou:", (err as Error).message);
    return null;
  }
}

/**
 * Retorna usuários da conta com papel admin/owner e vínculo ativo.
 * Usado para o evento "OP concluída".
 */
export async function buscarAdminsConta(
  contaId: string,
): Promise<DestinatarioBasico[]> {
  try {
    const rows = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(usuarioConta)
      .innerJoin(user, eq(user.id, usuarioConta.usuarioId))
      .where(
        and(
          eq(usuarioConta.contaId, contaId),
          eq(usuarioConta.ativo, true),
          inArray(usuarioConta.papel, ["owner", "admin"]),
        ),
      );
    return rows.filter((r): r is DestinatarioBasico => Boolean(r.email));
  } catch (err) {
    console.warn("[email] buscarAdminsConta falhou:", (err as Error).message);
    return [];
  }
}

export interface OPInfo {
  id: string;
  numero: string;
  contaId: string;
  produtoNome: string;
  atribuidoAId: string;
  temVies: boolean;
  status: string;
}

export async function buscarOpPorId(opId: string): Promise<OPInfo | null> {
  try {
    const [row] = await db
      .select({
        id: confeccaoOrdemProducao.id,
        numero: confeccaoOrdemProducao.numero,
        contaId: confeccaoOrdemProducao.contaId,
        produtoNome: confeccaoProduto.nome,
        atribuidoAId: confeccaoOrdemProducao.atribuidoAId,
        temVies: confeccaoOrdemProducao.temVies,
        status: confeccaoOrdemProducao.status,
      })
      .from(confeccaoOrdemProducao)
      .innerJoin(
        confeccaoProduto,
        eq(confeccaoProduto.id, confeccaoOrdemProducao.produtoId),
      )
      .where(eq(confeccaoOrdemProducao.id, opId));
    return row ?? null;
  } catch (err) {
    console.warn("[email] buscarOpPorId falhou:", (err as Error).message);
    return null;
  }
}

export interface SubtaskInfo {
  id: string;
  numero: string;
  prefixo: string;
  atribuidoAId: string | null;
  ordemProducaoId: string;
}

export async function buscarSubtaskPorId(
  subtaskId: string,
): Promise<SubtaskInfo | null> {
  try {
    const [row] = await db
      .select({
        id: confeccaoSubtask.id,
        numero: confeccaoSubtask.numero,
        prefixo: confeccaoSubtask.prefixo,
        atribuidoAId: confeccaoSubtask.atribuidoAId,
        ordemProducaoId: confeccaoSubtask.ordemProducaoId,
      })
      .from(confeccaoSubtask)
      .where(eq(confeccaoSubtask.id, subtaskId));
    return row ?? null;
  } catch (err) {
    console.warn("[email] buscarSubtaskPorId falhou:", (err as Error).message);
    return null;
  }
}

/**
 * Busca subtask OPCONF (Conferência) da mesma OP. Usado no evento
 * "Retirada parcial registrada".
 */
export async function buscarConferenciaDaOP(
  ordemProducaoId: string,
): Promise<SubtaskInfo | null> {
  try {
    const [row] = await db
      .select({
        id: confeccaoSubtask.id,
        numero: confeccaoSubtask.numero,
        prefixo: confeccaoSubtask.prefixo,
        atribuidoAId: confeccaoSubtask.atribuidoAId,
        ordemProducaoId: confeccaoSubtask.ordemProducaoId,
      })
      .from(confeccaoSubtask)
      .where(
        and(
          eq(confeccaoSubtask.ordemProducaoId, ordemProducaoId),
          eq(confeccaoSubtask.prefixo, "OPCONF"),
        ),
      );
    return row ?? null;
  } catch (err) {
    console.warn(
      "[email] buscarConferenciaDaOP falhou:",
      (err as Error).message,
    );
    return null;
  }
}

export function opUrl(opNumero: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  return `${base}/confeccao/ops/${encodeURIComponent(opNumero)}`;
}
