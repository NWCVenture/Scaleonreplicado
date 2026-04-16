import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Resend } from "resend";
import { z } from "zod";
import { buildManifestHTML } from "@/lib/coletas-utils";

const emailSchema = z.object({
  ids: z.array(z.string()).min(1),
  conta: z.string(),
  tipo: z.string(),
  para: z.string().email().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const data = emailSchema.parse(body);

    // Check if RESEND_API_KEY exists
    if (!process.env.RESEND_API_KEY) {
      console.warn("RESEND_API_KEY not configured, skipping email");
      return NextResponse.json({ success: true, simulated: true });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const html = buildManifestHTML(data.ids, data.conta, data.tipo);

    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "NWC ERP <noreply@resend.dev>",
      to: data.para || session.user.email,
      subject: `Manifesto ${data.tipo} - ${new Date().toLocaleDateString("pt-BR")}`,
      html,
    });

    if (error) {
      console.error("Resend error:", error);
      return NextResponse.json(
        { error: "Erro ao enviar email" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error sending email:", error);
    return NextResponse.json(
      { error: "Erro ao enviar email" },
      { status: 500 }
    );
  }
}
