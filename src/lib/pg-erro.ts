// Leitura do erro do Postgres por baixo do embrulho do Drizzle.
//
// O Drizzle 0.45 encapsula qualquer falha de query num `DrizzleQueryError`:
//
//   error.code     -> undefined
//   error.message  -> 'Failed query: insert into "..." ... params: ...'
//   error.cause    -> PostgresError { code: "23505", constraint_name: "uq_..." }
//
// Quem lê `(error as { code?: string }).code` direto nunca acha o 23505, então
// a violação de índice único caía no 500 genérico em vez do 409 "já existe" —
// e, nas rotas que devolvem `error.message`, a SQL com os parâmetros ia para o
// navegador. Estas funções descem a cadeia de `cause` até achar o erro do
// driver.

const PROFUNDIDADE_MAXIMA = 5;

/** Código SQLSTATE do erro (ex.: "23505" para violação de índice único). */
export function codigoPg(err: unknown): string | undefined {
  let atual: unknown = err;
  for (let i = 0; i < PROFUNDIDADE_MAXIMA && atual; i++) {
    const code = (atual as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
    atual = (atual as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Nome da constraint violada, quando o driver informa. */
export function constraintPg(err: unknown): string | undefined {
  let atual: unknown = err;
  for (let i = 0; i < PROFUNDIDADE_MAXIMA && atual; i++) {
    const nome =
      (atual as { constraint_name?: unknown }).constraint_name ??
      (atual as { constraint?: unknown }).constraint;
    if (typeof nome === "string" && nome.length > 0) return nome;
    atual = (atual as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Violação de índice/constraint único (SQLSTATE 23505). */
export function ehViolacaoDeUnico(err: unknown): boolean {
  return codigoPg(err) === "23505";
}
