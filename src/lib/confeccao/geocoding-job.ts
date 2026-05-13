// Helper fire-and-forget pra geocoding de fornecedores.
//
// Chamado após POST/PATCH de fornecedor. Não bloqueia a resposta HTTP —
// roda em background. Em caso de falha, log silencioso (fornecedor fica
// sem lat/lng e UI mostra aviso pra usuario disparar manualmente).
//
// Por que não Inngest? Pra simplificar o MVP — fire-and-forget no
// process do Next basta (Vercel mantém o function vivo até a Promise
// resolver, com timeout do plano). Migrar pra Inngest quando carga
// justificar.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { confeccaoFornecedor } from "@/lib/db/schema";
import {
  geocodificarEndereco,
  type GeocodingInput,
} from "./geocoding";

export function agendarGeocoding(
  fornecedorId: string,
  contaId: string,
  input: GeocodingInput,
): void {
  void (async () => {
    try {
      const result = await geocodificarEndereco(input);
      if (!result) return;
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('app.conta_atual', ${contaId}, true)`,
        );
        await tx
          .update(confeccaoFornecedor)
          .set({
            latitude: result.latitude,
            longitude: result.longitude,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(confeccaoFornecedor.id, fornecedorId),
              eq(confeccaoFornecedor.contaId, contaId),
            ),
          );
      });
    } catch (err) {
      console.warn(
        `[geocoding] falhou para fornecedor ${fornecedorId}:`,
        (err as Error).message,
      );
    }
  })();
}
