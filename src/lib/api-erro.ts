// Mensagem legível para falhas de chamada de API nas telas.
//
// Motivo: rotas com escopo de conta respondem 401 quando a sessão não tem
// conta ativa selecionada (ver `requireContaAtiva` em src/lib/tenancy.ts).
// As telas mostravam "Erro ao ..." genérico, então o operador não tinha como
// saber que bastava escolher a conta no menu lateral — o mesmo texto aparecia
// para sessão expirada, falha de rede e erro do servidor.

export const CODIGO_SEM_CONTA_ATIVA = "SEM_CONTA_ATIVA";
export const CODIGO_SEM_SESSAO = "SEM_SESSAO";

export const MSG_SEM_CONTA_ATIVA =
  "Nenhuma conta ativa selecionada. Escolha a conta no menu lateral e tente novamente.";

type CorpoDeErro = { error?: unknown; code?: unknown } | null | undefined;

export function mensagemDeErro(
  status: number,
  corpo: CorpoDeErro,
  fallback: string,
): string {
  const code = typeof corpo?.code === "string" ? corpo.code : null;
  if (code === CODIGO_SEM_CONTA_ATIVA) return MSG_SEM_CONTA_ATIVA;
  if (code === CODIGO_SEM_SESSAO) return "Sessão expirada. Entre novamente.";

  const erro = typeof corpo?.error === "string" ? corpo.error : null;
  if (erro) return erro;
  if (status === 401) return "Sessão expirada. Entre novamente.";
  return fallback;
}

/** Lê o corpo da resposta com falha e devolve a mensagem para o toast. */
export async function erroDaResposta(
  res: Response,
  fallback: string,
): Promise<string> {
  const corpo = (await res.json().catch(() => null)) as CorpoDeErro;
  return mensagemDeErro(res.status, corpo, fallback);
}
