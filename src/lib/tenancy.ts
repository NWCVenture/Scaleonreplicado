import { headers } from "next/headers";
import { eq, and, sql } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "./db";
import {
  usuarioConta,
  conta,
  session as sessionTable,
  type PapelConta,
} from "./db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Executa `fn` dentro de uma transação com `app.conta_atual` setado via set_config.
 * Qualquer SELECT/INSERT/UPDATE/DELETE em tabelas operacionais vai ser filtrado
 * automaticamente pelo RLS em `conta_id = current_setting('app.conta_atual')`.
 *
 * Usar em TODAS as queries de dados operacionais. Queries de Better-Auth (user,
 * session, account, verification) e tenancy (conta, usuario_conta, convite) não
 * têm RLS — use `db` diretamente nessas.
 */
export async function withConta<T>(
  contaId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.conta_atual', ${contaId}, true)`);
    return fn(tx);
  });
}

/**
 * Versão "request-scoped": resolve a conta ativa da sessão e executa a query
 * dentro dela. Lança 403 se não houver conta ativa.
 */
export async function withContaAtiva<T>(
  fn: (tx: Tx, contaId: string) => Promise<T>,
): Promise<T> {
  const { contaId } = await requireContaAtiva();
  return withConta(contaId, (tx) => fn(tx, contaId));
}

/**
 * Retorna o ID da conta ativa no contexto da sessão atual.
 * Lança erro se não houver sessão válida ou se a conta ativa não estiver definida.
 *
 * Ordem de resolução:
 *  1. session.contaAtivaId (se já setado)
 *  2. Único vínculo usuario_conta ativo (auto-seleção)
 *  3. null — usuário precisa escolher
 */
export async function getContaAtiva(): Promise<{
  sessionId: string;
  userId: string;
  contaId: string | null;
  isAutoAssigned: boolean;
}> {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });

  if (!session) {
    throw new Error("Sessão não encontrada.");
  }

  const contaAtivaId = (session.session as { contaAtivaId?: string | null })
    .contaAtivaId;

  if (contaAtivaId) {
    return {
      sessionId: session.session.id,
      userId: session.user.id,
      contaId: contaAtivaId,
      isAutoAssigned: false,
    };
  }

  const vinculos = await db
    .select({ contaId: usuarioConta.contaId })
    .from(usuarioConta)
    .where(
      and(eq(usuarioConta.usuarioId, session.user.id), eq(usuarioConta.ativo, true)),
    );

  if (vinculos.length === 1) {
    await db
      .update(sessionTable)
      .set({ contaAtivaId: vinculos[0].contaId })
      .where(eq(sessionTable.id, session.session.id));

    return {
      sessionId: session.session.id,
      userId: session.user.id,
      contaId: vinculos[0].contaId,
      isAutoAssigned: true,
    };
  }

  return {
    sessionId: session.session.id,
    userId: session.user.id,
    contaId: null,
    isAutoAssigned: false,
  };
}

/**
 * Requer conta ativa — lança erro se não houver.
 * Usar em API routes para garantir isolamento.
 */
export async function requireContaAtiva(): Promise<{
  sessionId: string;
  userId: string;
  contaId: string;
}> {
  const ctx = await getContaAtiva();
  if (!ctx.contaId) {
    throw new Error("Nenhuma conta ativa selecionada.");
  }
  return {
    sessionId: ctx.sessionId,
    userId: ctx.userId,
    contaId: ctx.contaId,
  };
}

/**
 * Lista as contas que o usuário atual pode acessar (para UI do seletor).
 */
export async function listarContasDoUsuario(userId: string) {
  return db
    .select({
      id: conta.id,
      nome: conta.nome,
      plano: conta.plano,
      status: conta.status,
      emailPrincipal: conta.emailPrincipal,
      papel: usuarioConta.papel,
    })
    .from(usuarioConta)
    .innerJoin(conta, eq(usuarioConta.contaId, conta.id))
    .where(and(eq(usuarioConta.usuarioId, userId), eq(usuarioConta.ativo, true)));
}

/**
 * Papéis que conferem privilégio administrativo dentro de uma conta.
 * Usar `isAdminPapel(papel)` para checagens de permissão.
 */
const PAPEIS_ADMIN: ReadonlySet<PapelConta> = new Set<PapelConta>([
  "owner",
  "admin",
]);

export function isAdminPapel(papel: PapelConta | null | undefined): boolean {
  return papel != null && PAPEIS_ADMIN.has(papel);
}

/**
 * Retorna o papel do usuário atual na conta ativa.
 * Retorna `null` se não houver conta ativa ou vínculo.
 */
export async function getPapelAtivo(): Promise<{
  userId: string;
  contaId: string | null;
  papel: PapelConta | null;
}> {
  const ctx = await getContaAtiva();
  if (!ctx.contaId) {
    return { userId: ctx.userId, contaId: null, papel: null };
  }

  const [vinculo] = await db
    .select({ papel: usuarioConta.papel })
    .from(usuarioConta)
    .where(
      and(
        eq(usuarioConta.usuarioId, ctx.userId),
        eq(usuarioConta.contaId, ctx.contaId),
        eq(usuarioConta.ativo, true),
      ),
    )
    .limit(1);

  return {
    userId: ctx.userId,
    contaId: ctx.contaId,
    papel: vinculo?.papel ?? null,
  };
}

export async function requirePapelAtivo(): Promise<{
  userId: string;
  contaId: string;
  papel: PapelConta;
}> {
  const ctx = await getPapelAtivo();
  if (!ctx.contaId || !ctx.papel) {
    throw new Error("Nenhuma conta ativa ou vínculo válido.");
  }
  return { userId: ctx.userId, contaId: ctx.contaId, papel: ctx.papel };
}

export async function requireAdminAtivo(): Promise<{
  userId: string;
  contaId: string;
  papel: PapelConta;
}> {
  const ctx = await requirePapelAtivo();
  if (!isAdminPapel(ctx.papel)) {
    throw new Error("Acesso negado: requer papel admin ou owner.");
  }
  return ctx;
}

/**
 * Troca a conta ativa na sessão atual.
 * Valida que o usuário tem vínculo com a conta antes de trocar.
 */
export async function trocarContaAtiva(
  sessionId: string,
  userId: string,
  novaContaId: string,
): Promise<void> {
  const vinculo = await db
    .select()
    .from(usuarioConta)
    .where(
      and(
        eq(usuarioConta.usuarioId, userId),
        eq(usuarioConta.contaId, novaContaId),
        eq(usuarioConta.ativo, true),
      ),
    )
    .limit(1);

  if (vinculo.length === 0) {
    throw new Error("Usuário não tem acesso a essa conta.");
  }

  await db
    .update(sessionTable)
    .set({ contaAtivaId: novaContaId })
    .where(eq(sessionTable.id, sessionId));
}
