"use client";

// Helper client-side pra abrir wa.me e registrar log de auditoria
// na subtask correspondente. Fire-and-forget no log (não bloqueia
// abertura do WhatsApp se a chamada API falhar).

interface AbrirWhatsAppInput {
  telefone: string;
  destinatarioNome: string;
  mensagem: string;
  subtaskId?: string;
  ordemProducaoId?: string;
  contexto?: string;
}

export function abrirWhatsAppComLog(input: AbrirWhatsAppInput): void {
  const limpo = input.telefone.replace(/\D/g, "");
  const url = `https://wa.me/${limpo}?text=${encodeURIComponent(input.mensagem)}`;

  // Fire-and-forget — não espera resposta nem bloqueia abertura.
  // Se falhar, log silencioso no console.
  void fetch("/api/confeccao/notas/whatsapp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subtaskId: input.subtaskId,
      ordemProducaoId: input.ordemProducaoId,
      destinatarioNome: input.destinatarioNome,
      destinatarioTelefone: input.telefone,
      contexto: input.contexto,
    }),
  }).catch((e) => {
    console.warn("[whatsapp] log falhou:", (e as Error).message);
  });

  window.open(url, "_blank", "noopener");
}
