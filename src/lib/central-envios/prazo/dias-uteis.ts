// Funções puras de calendário pra cálculo de dias úteis.
//
// Convenção temporal:
//   - "data civil SP" = YYYY-MM-DD em fuso America/Sao_Paulo UTC-3 fixo
//     (sem horário de verão — BR não tem desde 2019)
//   - ISO UTC é só pra entrada (criadoEmIso) — convertido via dataCivilSP
//
// Não usa Intl pra evitar inconsistência entre runtimes. Tudo manual
// via Date.UTC.

const SP_OFFSET_HORAS = -3;

/**
 * Converte ISO 8601 UTC em data civil SP no formato YYYY-MM-DD.
 *
 * Exemplo:
 *   '2026-06-05T17:42:00.000Z' (17:42 UTC) → 14:42 SP → '2026-06-05'
 *   '2026-06-05T02:00:00.000Z' (02:00 UTC) → 23:00 SP do dia 04 → '2026-06-04'
 */
export function dataCivilSP(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`dataCivilSP: ISO inválido '${iso}'`);
  }
  // Soma offset SP (em ms) ao instante UTC pra simular "wall clock" SP.
  const spMs = d.getTime() + SP_OFFSET_HORAS * 60 * 60 * 1000;
  const sp = new Date(spMs);
  return formatarYmd(sp.getUTCFullYear(), sp.getUTCMonth() + 1, sp.getUTCDate());
}

/** Retorna o YYYY-MM-DD do "hoje" em SP. */
export function hojeIsoSP(agora: Date = new Date()): string {
  return dataCivilSP(agora.toISOString());
}

function formatarYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Quebra um YMD em componentes. Throw em formato inválido.
 */
function quebrarYmd(ymd: string): { y: number; m: number; d: number } {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`YMD inválido: '${ymd}'`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Día da semana 0=dom, 6=sáb. Usa Date.UTC pra evitar timezone do runtime. */
function diaDaSemana(ymd: string): number {
  const { y, m, d } = quebrarYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Soma N dias ao YMD (positivo ou negativo). N=0 retorna o próprio. */
export function somarDias(ymd: string, dias: number): string {
  const { y, m, d } = quebrarYmd(ymd);
  const t = Date.UTC(y, m - 1, d) + dias * 24 * 60 * 60 * 1000;
  const dt = new Date(t);
  return formatarYmd(
    dt.getUTCFullYear(),
    dt.getUTCMonth() + 1,
    dt.getUTCDate(),
  );
}

/** True se ymd é segunda-sexta e NÃO está em feriadosSet. */
export function ehDiaUtil(ymd: string, feriadosSet: Set<string>): boolean {
  const dow = diaDaSemana(ymd);
  if (dow === 0 || dow === 6) return false;
  return !feriadosSet.has(ymd);
}

/** Se ymd já é dia útil, retorna ele; senão soma +1 dia até virar. */
export function ajustarParaDiaUtil(
  ymd: string,
  feriadosSet: Set<string>,
): string {
  let atual = ymd;
  // Guarda contra loop infinito (improvável mas defensivo).
  for (let i = 0; i < 366; i++) {
    if (ehDiaUtil(atual, feriadosSet)) return atual;
    atual = somarDias(atual, 1);
  }
  throw new Error(
    `ajustarParaDiaUtil: nenhum dia útil em ${ymd}..+366d (todos feriados?)`,
  );
}

/**
 * Soma N dias úteis a partir de `base`. Se `base` cai num sábado/domingo/
 * feriado, primeiro ajusta pra próximo dia útil; depois soma N.
 * N=0 ainda retorna o ajuste (pulando pra próximo dia útil se necessário).
 */
export function adicionarDiasUteis(
  baseYmd: string,
  n: number,
  feriadosSet: Set<string>,
): string {
  if (n < 0) throw new Error(`adicionarDiasUteis: n=${n} não pode ser negativo`);
  let atual = ajustarParaDiaUtil(baseYmd, feriadosSet);
  let restante = n;
  while (restante > 0) {
    atual = somarDias(atual, 1);
    if (ehDiaUtil(atual, feriadosSet)) {
      restante--;
    }
  }
  return atual;
}
