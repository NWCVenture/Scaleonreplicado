import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classificarParaRetencao,
  type BlobBackup,
} from "./backup-retencao";

const AGORA = new Date("2026-05-17T06:05:00Z"); // domingo

function blob(pathname: string, iso: string): BlobBackup {
  return { pathname, uploadedAt: new Date(iso) };
}

test("vazio → ambos vazios", () => {
  const r = classificarParaRetencao([], AGORA);
  assert.deepEqual(r, { manter: [], remover: [] });
});

test("5 backups semanais → mantém os 4 mais recentes", () => {
  // Domingos de maio/abril de 2026
  const blobs = [
    blob("backups/confeccao/2026/2026-05-17.dump", "2026-05-17T06:05:00Z"),
    blob("backups/confeccao/2026/2026-05-10.dump", "2026-05-10T06:05:00Z"),
    blob("backups/confeccao/2026/2026-05-03.dump", "2026-05-03T06:05:00Z"),
    blob("backups/confeccao/2026/2026-04-26.dump", "2026-04-26T06:05:00Z"),
    blob("backups/confeccao/2026/2026-04-19.dump", "2026-04-19T06:05:00Z"),
  ];

  const r = classificarParaRetencao(blobs, AGORA);

  // Os 3 de maio + 2026-04-26 ocupam as 4 vagas semanais. 2026-04-19 perde
  // pra 2026-04-26 também como "mais recente de abril/2026", então sai.
  assert.deepEqual(r.manter.sort(), [
    "backups/confeccao/2026/2026-04-26.dump",
    "backups/confeccao/2026/2026-05-03.dump",
    "backups/confeccao/2026/2026-05-10.dump",
    "backups/confeccao/2026/2026-05-17.dump",
  ]);
  assert.deepEqual(r.remover, ["backups/confeccao/2026/2026-04-19.dump"]);
});

test("18 backups mensais antigos → mantém 12 (último de cada mês) + 4 recentes", () => {
  const blobs: BlobBackup[] = [];

  // 18 meses de backups, apenas o primeiro domingo de cada mês.
  // Mês corrente = maio/2026.
  for (let i = 0; i < 18; i++) {
    const data = new Date(Date.UTC(2026, 4 - i, 1, 6, 0, 0)); // 4 = maio (0-indexed)
    const iso = data.toISOString().slice(0, 10);
    blobs.push(blob(`backups/confeccao/${iso}.dump`, data.toISOString()));
  }

  const r = classificarParaRetencao(blobs, AGORA);

  // Esperado: o mais recente (maio/2026) + 12 mensais anteriores
  // (abril/2026 até maio/2025) = 13. Os 4 mais recentes incluem
  // maio/2026, abril/2026, março/2026, fevereiro/2026 — todos já cobertos
  // pelos 12 mensais. Janeiro/2025, dezembro/2024, novembro/2024 são as
  // 3 caudais mais antigas que entram além das 4 vagas semanais.
  // Total mantidos: maio/2026..maio/2025 inclusive = 13.
  assert.equal(r.manter.length, 13);
  // Os 5 mais antigos (abril/2025..dezembro/2024) entram em remover.
  assert.equal(r.remover.length, 5);
});

test("mistura semanal + mensal preserva ambas as janelas", () => {
  // 4 semanais recentes em maio/2026 + 1 backup por mês de jan/2026 a fev/2025
  // (12 meses anteriores). Adiciona 1 antigo (dez/2024) que deve cair fora.
  const blobs: BlobBackup[] = [
    blob("b/2026-05-17.dump", "2026-05-17T06:00:00Z"),
    blob("b/2026-05-10.dump", "2026-05-10T06:00:00Z"),
    blob("b/2026-05-03.dump", "2026-05-03T06:00:00Z"),
    blob("b/2026-04-26.dump", "2026-04-26T06:00:00Z"),
  ];

  // Um backup por mês indo pra trás 12 meses (abril/2026 até maio/2025).
  for (let i = 1; i <= 12; i++) {
    const data = new Date(Date.UTC(2026, 4 - i, 5, 6, 0, 0));
    const iso = data.toISOString().slice(0, 10);
    blobs.push(blob(`b/${iso}.dump`, data.toISOString()));
  }

  // Backup que está fora da janela de 12 meses (abril/2025).
  blobs.push(blob("b/2025-04-05.dump", "2025-04-05T06:00:00Z"));

  const r = classificarParaRetencao(blobs, AGORA);

  // 4 semanais (mais recentes) + 12 mensais (abril/2026..maio/2025)
  // Mas abril/2026 (mensal) também é o mesmo blob de 2026-04-26 (semanal),
  // ou seja, vai sobrar 1 entrada — algumas semanas/meses sobrepõem.
  // O mais antigo (2025-04-05) é o único fora de todas as janelas.
  assert.ok(r.manter.includes("b/2026-05-17.dump"));
  assert.ok(r.manter.includes("b/2026-04-26.dump"));
  // O segundo backup de abril/2026 (2026-04-05) perde pro 2026-04-26 tanto
  // na vaga semanal quanto na vaga mensal. Vai pra remover junto com o
  // backup fora da janela (2025-04-05).
  assert.deepEqual(r.remover.sort(), ["b/2025-04-05.dump", "b/2026-04-05.dump"]);
});

test("dois backups do mesmo mês: mantém apenas o mais recente como mensal", () => {
  // Mês corrente: maio/2026. Mês alvo histórico: dois backups de
  // março/2026 (mês -2). Backup mais recente desse mês deve ser mantido.
  const blobs: BlobBackup[] = [
    // 4 semanais recentes pra preencher a primeira janela
    blob("b/2026-05-17.dump", "2026-05-17T06:00:00Z"),
    blob("b/2026-05-10.dump", "2026-05-10T06:00:00Z"),
    blob("b/2026-05-03.dump", "2026-05-03T06:00:00Z"),
    blob("b/2026-04-26.dump", "2026-04-26T06:00:00Z"),
    // Dois backups de março/2026
    blob("b/2026-03-29.dump", "2026-03-29T06:00:00Z"),
    blob("b/2026-03-22.dump", "2026-03-22T06:00:00Z"),
  ];

  const r = classificarParaRetencao(blobs, AGORA);

  assert.ok(r.manter.includes("b/2026-03-29.dump"));
  assert.ok(r.remover.includes("b/2026-03-22.dump"));
});

test("re-run no mesmo dia: decisão estável (não duplica nem exclui mais)", () => {
  const blobs: BlobBackup[] = [
    blob("b/2026-05-17.dump", "2026-05-17T06:05:00Z"),
    blob("b/2026-05-10.dump", "2026-05-10T06:05:00Z"),
    blob("b/2026-05-03.dump", "2026-05-03T06:05:00Z"),
    blob("b/2026-04-26.dump", "2026-04-26T06:05:00Z"),
    blob("b/2026-03-29.dump", "2026-03-29T06:05:00Z"),
  ];

  const r1 = classificarParaRetencao(blobs, AGORA);
  const r2 = classificarParaRetencao(blobs, AGORA);

  assert.deepEqual(r1.manter.sort(), r2.manter.sort());
  assert.deepEqual(r1.remover.sort(), r2.remover.sort());
});

test("backup do dia anterior também conta como dentro da janela mensal corrente", () => {
  // Mês corrente = maio/2026. Backups de maio entram pela janela semanal
  // se forem dos 4 mais recentes; mas mesmo se forem do mês corrente, não
  // entram na lista de "12 meses anteriores" — só os 11 anteriores ficam
  // protegidos. Sanity check.
  const blobs: BlobBackup[] = [
    blob("b/2026-05-17.dump", "2026-05-17T06:00:00Z"),
    blob("b/2026-05-01.dump", "2026-05-01T06:00:00Z"),
  ];
  const r = classificarParaRetencao(blobs, AGORA);
  // Ambos mantidos: 2 ≤ 4 semanais.
  assert.equal(r.manter.length, 2);
  assert.equal(r.remover.length, 0);
});
