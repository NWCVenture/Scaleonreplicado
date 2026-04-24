import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM = process.env.RESEND_FROM_EMAIL || "SCALEON ERP <noreply@resend.dev>";

export type EmailAttachment = {
  filename: string;
  content: string | Buffer;
  contentType?: string;
};

export async function sendEmail({
  to,
  subject,
  html,
  text,
  attachments,
}: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
}) {
  if (!resend) {
    console.warn("[email] RESEND_API_KEY não configurado — email não enviado");
    return { simulated: true };
  }
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject,
    html,
    text,
    attachments,
  });
  if (error) throw new Error(error.message);
  return { sent: true };
}

export function buildVerificationEmailHtml(url: string, userName: string) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
      <h2 style="color:#008000">SCALEON ERP — Verifique seu email</h2>
      <p>Olá, <strong>${userName}</strong>!</p>
      <p>Clique no botão abaixo para verificar seu endereço de email e garantir acesso contínuo ao sistema.</p>
      <a href="${url}"
        style="display:inline-block;margin:24px 0;padding:12px 28px;background:#008000;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold">
        Verificar Email
      </a>
      <p style="color:#666;font-size:13px">O link expira em 1 hora. Se você não solicitou isso, ignore este email.</p>
    </div>
  `;
}
