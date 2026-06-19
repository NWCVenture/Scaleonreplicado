// GET /api/estantes/consolidado
//
// Retorna toda a base necessária pro modo "Consolidado" do Estante Virtual e
// pro export Upseller a nível módulo:
//
//   - fardos[]  — TODOS os fardos de TODAS as estantes da conta (não inclui
//                 contagem_manuseavel: peças manuseáveis são "gordura de
//                 segurança" e ficam fora do export).
//   - modelos[] — codigo + custoUpseller (pra preencher custo no XLSX).
//   - skus[]    — sku_catalogo ativos da conta + flag pausadoUpseller.
//   - estantes[] — id+nome (pro UI poder destacar origem se quiser).

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";
import {
  estante,
  estanteFardo,
  modeloPrincipal,
  skuCatalogo,
} from "@/lib/db/schema";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function GET(_request: NextRequest) {
  try {
    const payload = await withContaAtiva(async (tx, contaId) => {
      const [estantes, fardos, modelos, skus] = await Promise.all([
        tx
          .select({
            id: estante.id,
            nome: estante.nome,
          })
          .from(estante)
          .where(eq(estante.contaId, contaId)),
        tx
          .select({
            id: estanteFardo.id,
            estanteId: estanteFardo.estanteId,
            qrCode: estanteFardo.qrCode,
            sku: estanteFardo.sku,
            lote: estanteFardo.lote,
            quantidade: estanteFardo.quantidade,
            adicionadoPor: estanteFardo.adicionadoPor,
            createdAt: estanteFardo.createdAt,
          })
          .from(estanteFardo)
          .where(eq(estanteFardo.contaId, contaId)),
        tx
          .select({
            codigo: modeloPrincipal.codigo,
            custoUpseller: modeloPrincipal.custoUpseller,
            ativo: modeloPrincipal.ativo,
          })
          .from(modeloPrincipal)
          .where(eq(modeloPrincipal.contaId, contaId)),
        tx
          .select({
            codigo: skuCatalogo.codigo,
            ativo: skuCatalogo.ativo,
            pausadoUpseller: skuCatalogo.pausadoUpseller,
            hexColor: skuCatalogo.hexColor,
          })
          .from(skuCatalogo)
          .where(eq(skuCatalogo.contaId, contaId)),
      ]);

      return {
        estantes,
        fardos: fardos.map((f) => ({
          ...f,
          createdAt:
            f.createdAt instanceof Date
              ? f.createdAt.toISOString()
              : String(f.createdAt),
        })),
        modelos: modelos.filter((m) => m.ativo),
        skus: skus.filter((s) => s.ativo),
      };
    });

    return NextResponse.json(payload);
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error fetching estantes consolidado:", error);
    return NextResponse.json(
      { error: "Erro ao buscar dados consolidados" },
      { status: 500 },
    );
  }
}
