import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, sql } from "drizzle-orm";
import postgres from "postgres";
import { user, usuarioConta, type PapelConta } from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL não definida. Use dotenv-cli com .env.local ou .env.prod.",
  );
}

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client);

function mapRoleToPapel(role: string): PapelConta {
  switch (role) {
    case "admin":
      return "admin";
    case "supervisor":
      return "supervisor";
    case "funcionario":
      return "funcionario";
    case "expedicao":
      return "expedicao";
    default:
      return "operador";
  }
}

async function main() {
  console.log("=== Copiando user.role -> usuario_conta.papel ===\n");

  const usuarios = await db.select().from(user);
  console.log(`Encontrados ${usuarios.length} usuário(s).\n`);

  let atualizados = 0;
  let preservados = 0;
  let semVinculo = 0;

  for (const u of usuarios) {
    const novo = mapRoleToPapel(u.role);

    const vinculos = await db
      .select()
      .from(usuarioConta)
      .where(eq(usuarioConta.usuarioId, u.id));

    if (vinculos.length === 0) {
      console.log(`  - ${u.email} (${u.role}) — sem vínculo, ignorado`);
      semVinculo++;
      continue;
    }

    for (const v of vinculos) {
      if (v.papel === "owner") {
        console.log(
          `  ★ ${u.email} (conta ${v.contaId}) — owner preservado`,
        );
        preservados++;
        continue;
      }

      if (v.papel === novo) {
        preservados++;
        continue;
      }

      await db
        .update(usuarioConta)
        .set({ papel: novo })
        .where(
          and(
            eq(usuarioConta.usuarioId, u.id),
            eq(usuarioConta.contaId, v.contaId),
          ),
        );
      console.log(
        `  ↻ ${u.email} (conta ${v.contaId}) — ${v.papel} → ${novo}`,
      );
      atualizados++;
    }
  }

  console.log(
    `\n✅ Concluído. ${atualizados} atualizado(s), ${preservados} preservado(s), ${semVinculo} sem vínculo.`,
  );

  const total = await db.execute(
    sql`SELECT papel, COUNT(*)::int AS n FROM usuario_conta GROUP BY papel ORDER BY n DESC`,
  );
  const rows = total as unknown as Array<{ papel: string; n: number }>;
  console.log(`\n   Distribuição de papéis:`);
  for (const r of rows) console.log(`   - ${r.papel}: ${r.n}`);

  await client.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("❌ Falha:", err);
  await client.end();
  process.exit(1);
});
