// Wrapper que monta payload do email e dispara via Resend (RITM-11).
// Caller decide o que fazer com o erro — não tratamos silenciosamente
// aqui pra que o endpoint possa decidir bloquear ou só logar.

import { sendEmail } from "@/lib/email";
import { buildResumoHtml } from "./build-resumo-html";
import type { PlanejamentoSnapshotCliente } from "./types";

function formatarSubject(planejamento: PlanejamentoSnapshotCliente): string {
  const d = planejamento.dataReferencia.slice(0, 10).split("-");
  const dataBr = d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : planejamento.dataReferencia;
  return `[Central de Envios] Planejamento ${dataBr} — ${planejamento.totalPedidos} pedidos`;
}

export async function enviarResumoPlanejamento({
  planejamento,
  destinatarios,
  contaNome,
}: {
  planejamento: PlanejamentoSnapshotCliente;
  destinatarios: string[];
  contaNome: string;
}): Promise<{ enviado: boolean; simulado: boolean }> {
  if (destinatarios.length === 0) {
    return { enviado: false, simulado: false };
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? null;
  const detalheUrl = baseUrl
    ? `${baseUrl}/central-envios/historico/${planejamento.id}`
    : null;

  const { html, text } = buildResumoHtml({
    planejamento,
    contaNome,
    detalheUrl,
  });

  const result = await sendEmail({
    to: destinatarios,
    subject: formatarSubject(planejamento),
    html,
    text,
  });

  if ("simulated" in result && result.simulated) {
    return { enviado: false, simulado: true };
  }
  return { enviado: true, simulado: false };
}
