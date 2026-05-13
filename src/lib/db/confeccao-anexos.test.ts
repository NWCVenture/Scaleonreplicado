import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { sql, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./index";
import {
  conta,
  user,
  confeccaoProduto,
  confeccaoOrdemProducao,
  confeccaoSubtask,
  confeccaoAnexo,
} from "./schema";

function matchDbError(pattern: RegExp) {
  return (err: unknown): true => {
    const e = err as { message?: string; cause?: { message?: string } };
    const combined = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
    assert.match(combined, pattern);
    return true;
  };
}

const CONTA_TEST = "anexos-test-conta";
const USER_TEST = "anexos-test-user";

let opId: string;
let subtaskId: string;

before(async () => {
  await db
    .insert(conta)
    .values({
      id: CONTA_TEST,
      nome: "Anexos Test",
      emailPrincipal: "anexos@test.com",
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();

  await db
    .insert(user)
    .values({
      id: USER_TEST,
      name: "Anexos Test User",
      email: "anexos-test@test.com",
      role: "admin",
    })
    .onConflictDoNothing();

  const produtoId = nanoid();
  await db.insert(confeccaoProduto).values({
    id: produtoId,
    contaId: CONTA_TEST,
    nome: "Produto Anexos Test",
  });

  opId = nanoid();
  await db.insert(confeccaoOrdemProducao).values({
    id: opId,
    contaId: CONTA_TEST,
    numero: `OP-ANEX-${Date.now()}`,
    sequencialGlobal: 0,
    produtoId,
    criadaPorId: USER_TEST,
    atribuidoAId: USER_TEST,
  });

  subtaskId = nanoid();
  await db.insert(confeccaoSubtask).values({
    id: subtaskId,
    contaId: CONTA_TEST,
    ordemProducaoId: opId,
    numero: `OPBUY-ANEX-${Date.now()}`,
    idInterno: `OPBUY-ANEX-${Date.now()}-INTERNAL`,
    prefixo: "OPBUY",
    ordemSequencial: 1,
  });
});

after(async () => {
  // Cascade deleta tudo
  await db.delete(conta).where(eq(conta.id, CONTA_TEST));
  await db.delete(user).where(eq(user.id, USER_TEST));
});

test("CHECK tamanho_max_50mb: rejeita > 50MB", async () => {
  await assert.rejects(
    () =>
      db.insert(confeccaoAnexo).values({
        id: nanoid(),
        contaId: CONTA_TEST,
        subtaskId,
        categoria: "outros",
        nomeArquivo: "grande.pdf",
        tipoMime: "application/pdf",
        tamanhoBytes: 60 * 1024 * 1024, // 60 MB
        blobUrl: `https://blob.example/${nanoid()}.pdf`,
        blobPathname: `confeccao/anex-test/x.pdf`,
        enviadoPorId: USER_TEST,
      }),
    matchDbError(/confeccao_anexo_tamanho_max_50mb/),
  );
});

test("CHECK tamanho_max_50mb: aceita exatamente 50MB", async () => {
  const id = nanoid();
  await db.insert(confeccaoAnexo).values({
    id,
    contaId: CONTA_TEST,
    subtaskId,
    categoria: "outros",
    nomeArquivo: "exato50mb.pdf",
    tipoMime: "application/pdf",
    tamanhoBytes: 50 * 1024 * 1024, // exato
    blobUrl: `https://blob.example/${id}.pdf`,
    blobPathname: `confeccao/anex-test/${id}.pdf`,
    enviadoPorId: USER_TEST,
  });
  const [row] = await db
    .select()
    .from(confeccaoAnexo)
    .where(eq(confeccaoAnexo.id, id));
  assert.equal(row.tamanhoBytes, 50 * 1024 * 1024);
});

test("CHECK tem_pai: rejeita sem nenhuma FK pai", async () => {
  await assert.rejects(
    () =>
      db.insert(confeccaoAnexo).values({
        id: nanoid(),
        contaId: CONTA_TEST,
        categoria: "outros",
        nomeArquivo: "orfao.pdf",
        tipoMime: "application/pdf",
        tamanhoBytes: 1024,
        blobUrl: `https://blob.example/${nanoid()}.pdf`,
        blobPathname: "confeccao/anex-test/orfao.pdf",
        enviadoPorId: USER_TEST,
      }),
    matchDbError(/confeccao_anexo_tem_pai/),
  );
});

test("UNIQUE blob_url: rejeita duplicado", async () => {
  const url = `https://blob.example/duplo-${nanoid()}.pdf`;
  await db.insert(confeccaoAnexo).values({
    id: nanoid(),
    contaId: CONTA_TEST,
    subtaskId,
    categoria: "outros",
    nomeArquivo: "primeiro.pdf",
    tipoMime: "application/pdf",
    tamanhoBytes: 1024,
    blobUrl: url,
    blobPathname: "confeccao/x/primeiro.pdf",
    enviadoPorId: USER_TEST,
  });
  await assert.rejects(
    () =>
      db.insert(confeccaoAnexo).values({
        id: nanoid(),
        contaId: CONTA_TEST,
        subtaskId,
        categoria: "outros",
        nomeArquivo: "duplicado.pdf",
        tipoMime: "application/pdf",
        tamanhoBytes: 2048,
        blobUrl: url, // mesma URL
        blobPathname: "confeccao/x/duplicado.pdf",
        enviadoPorId: USER_TEST,
      }),
    matchDbError(/confeccao_anexo_blob_url_unique/),
  );
});

test("Cascade: deletar subtask remove anexo vinculado", async () => {
  const subId = nanoid();
  await db.insert(confeccaoSubtask).values({
    id: subId,
    contaId: CONTA_TEST,
    ordemProducaoId: opId,
    numero: `OPRIS-ANEX-${Date.now()}`,
    idInterno: `OPRIS-CASCADE-${Date.now()}`,
    prefixo: "OPRIS",
    ordemSequencial: 2,
  });

  const anexoId = nanoid();
  await db.insert(confeccaoAnexo).values({
    id: anexoId,
    contaId: CONTA_TEST,
    subtaskId: subId,
    categoria: "outros",
    nomeArquivo: "cascade.pdf",
    tipoMime: "application/pdf",
    tamanhoBytes: 1024,
    blobUrl: `https://blob.example/cascade-${anexoId}.pdf`,
    blobPathname: `confeccao/x/cascade-${anexoId}.pdf`,
    enviadoPorId: USER_TEST,
  });

  await db.delete(confeccaoSubtask).where(eq(confeccaoSubtask.id, subId));

  const after = await db
    .select()
    .from(confeccaoAnexo)
    .where(eq(confeccaoAnexo.id, anexoId));
  assert.equal(after.length, 0, "anexo não cascadeou");
});

test("Restrict: deletar usuário enviado_por bloqueia se há anexos", async () => {
  // RESTRICT: tentar deletar user com anexos deve falhar
  const userId = "anexos-test-restrict-user";
  await db
    .insert(user)
    .values({
      id: userId,
      name: "Restrict User",
      email: "restrict@test.com",
      role: "admin",
    })
    .onConflictDoNothing();

  const id = nanoid();
  await db.insert(confeccaoAnexo).values({
    id,
    contaId: CONTA_TEST,
    subtaskId,
    categoria: "outros",
    nomeArquivo: "restrict.pdf",
    tipoMime: "application/pdf",
    tamanhoBytes: 1024,
    blobUrl: `https://blob.example/restrict-${id}.pdf`,
    blobPathname: `confeccao/x/restrict-${id}.pdf`,
    enviadoPorId: userId,
  });

  await assert.rejects(
    () => db.delete(user).where(eq(user.id, userId)),
    matchDbError(/violates foreign key constraint/i),
  );

  // Limpa: deleta anexo primeiro, depois user
  await db.delete(confeccaoAnexo).where(eq(confeccaoAnexo.id, id));
  await db.delete(user).where(eq(user.id, userId));
});
