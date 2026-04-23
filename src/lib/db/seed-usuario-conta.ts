import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, sql } from "drizzle-orm";
import postgres from "postgres";
import { nanoid } from "nanoid";
import { user, usuarioConta, type PapelConta } from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL não definida. Use dotenv-cli com .env.local ou .env.prod.",
  );
}

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client);

const CONTA_NWC_ID = "nwc-root";

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
  console.log("=== Vinculando usuários existentes à conta NWC ===\n");

  const usuarios = await db.select().from(user);
  console.log(`Encontrados ${usuarios.length} usuário(s).`);

  let criados = 0;
  let existentes = 0;

  for (const u of usuarios) {
    const papel = mapRoleToPapel(u.role);
    const existente = await db
      .select()
      .from(usuarioConta)
      .where(
        and(eq(usuarioConta.usuarioId, u.id), eq(usuarioConta.contaId, CONTA_NWC_ID)),
      )
      .limit(1);

    if (existente.length > 0) {
      console.log(`  = ${u.email} (${u.role} → ${papel}) — já vinculado`);
      existentes++;
      continue;
    }

    await db.insert(usuarioConta).values({
      id: nanoid(),
      usuarioId: u.id,
      contaId: CONTA_NWC_ID,
      papel,
      aceitoEm: new Date(),
      ativo: true,
    });
    console.log(`  + ${u.email} (${u.role} → ${papel}) — vinculado`);
    criados++;
  }

  // Eleva o primeiro admin encontrado a owner
  const primeiroAdmin = await db
    .select()
    .from(user)
    .where(eq(user.role, "admin"))
    .orderBy(user.createdAt)
    .limit(1);

  if (primeiroAdmin.length > 0) {
    const ownerId = primeiroAdmin[0].id;
    await db
      .update(usuarioConta)
      .set({ papel: "owner" })
      .where(
        and(
          eq(usuarioConta.usuarioId, ownerId),
          eq(usuarioConta.contaId, CONTA_NWC_ID),
        ),
      );
    console.log(`\n  ★ ${primeiroAdmin[0].email} promovido a OWNER da conta NWC.`);
  }

  console.log(`\n✅ Concluído. ${criados} novo(s), ${existentes} já existente(s).`);

  // Sanity check
  const total = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM usuario_conta WHERE conta_id = ${CONTA_NWC_ID}`,
  );
  const rows = total as unknown as Array<{ n: number }>;
  console.log(`   Total de vínculos ativos na conta NWC: ${rows[0]?.n ?? 0}`);

  await client.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("❌ Falha:", err);
  await client.end();
  process.exit(1);
});
