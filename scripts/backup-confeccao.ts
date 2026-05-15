// Backup semanal do banco Confecção pra Vercel Blob.
//
// Executado pelo workflow `.github/workflows/backup-confeccao.yml` (cron
// dominical) ou disparado manualmente via `workflow_dispatch`. NÃO roda
// em Vercel Functions — depende do binário `pg_dump` instalado no runner.
//
// Variáveis esperadas:
//   - DATABASE_URL: connection string do Neon prod (role read-only)
//   - BLOB_READ_WRITE_TOKEN: token do Vercel Blob (mesmo da app)
//
// Saída: JSON estruturado em stdout — fácil de parsear nos logs do GH
// Actions.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadStream } from "node:fs";
import { put, list, del } from "@vercel/blob";

import {
  classificarParaRetencao,
  type BlobBackup,
} from "../src/lib/confeccao/backup-retencao";

const BLOB_PREFIX = "backups/confeccao/";

async function main() {
  const databaseUrl = required("DATABASE_URL");
  const blobToken = required("BLOB_READ_WRITE_TOKEN");

  const agora = new Date();
  const dataIso = agora.toISOString().slice(0, 10); // YYYY-MM-DD
  const ano = dataIso.slice(0, 4);

  const tmpDir = mkdtempSync(join(tmpdir(), "backup-confeccao-"));
  const dumpPath = join(tmpDir, `${dataIso}.dump`);

  try {
    log("info", "dump_start", { dumpPath });
    const dumpStart = Date.now();

    // --format=custom: binário, comprimido. Pode ser restaurado com
    // pg_restore. --no-owner / --no-acl: portável entre roles diferentes.
    execFileSync(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-acl",
        "--file",
        dumpPath,
        databaseUrl,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );

    const stats = statSync(dumpPath);
    const dumpSizeMB = stats.size / 1024 / 1024;
    log("info", "dump_done", {
      sizeMB: round(dumpSizeMB),
      durationMs: Date.now() - dumpStart,
    });

    // Upload pro Blob.
    const blobPath = `${BLOB_PREFIX}${ano}/${dataIso}.dump`;
    const uploadStart = Date.now();
    const uploaded = await put(blobPath, createReadStream(dumpPath), {
      access: "public",
      contentType: "application/octet-stream",
      token: blobToken,
      // Evita sufixo aleatório — quando re-rodamos no mesmo dia
      // (workflow_dispatch), sobrescrevemos o blob daquele dia.
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    log("info", "upload_done", {
      url: uploaded.url,
      pathname: uploaded.pathname,
      durationMs: Date.now() - uploadStart,
    });

    // Retenção: lista blobs existentes, classifica, deleta os fora das
    // janelas.
    const todosBlobs = await listarTodosBackups(blobToken);
    log("info", "retencao_lista", { total: todosBlobs.length });

    const { manter, remover } = classificarParaRetencao(todosBlobs, agora);
    log("info", "retencao_decisao", {
      manter: manter.length,
      remover: remover.length,
      removerPaths: remover,
    });

    if (remover.length > 0) {
      // `del` aceita URLs ou pathnames; precisamos das URLs.
      const urlsParaRemover = todosBlobs
        .filter((b) => remover.includes(b.pathname))
        .map((b) => b.url);
      // Vercel Blob aceita array em uma chamada.
      await del(urlsParaRemover, { token: blobToken });
      log("info", "retencao_aplicada", { removidos: urlsParaRemover.length });
    }

    log("ok", "done", {
      dumpSizeMB: round(dumpSizeMB),
      blobsKept: manter.length,
      blobsDeleted: remover.length,
    });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function listarTodosBackups(
  blobToken: string,
): Promise<Array<BlobBackup & { url: string }>> {
  const out: Array<BlobBackup & { url: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await list({
      prefix: BLOB_PREFIX,
      cursor,
      token: blobToken,
      limit: 1000,
    });
    for (const blob of page.blobs) {
      out.push({
        pathname: blob.pathname,
        uploadedAt: blob.uploadedAt,
        url: blob.url,
      });
    }
    cursor = page.cursor;
  } while (cursor);
  return out;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    log("error", "missing_env", { name });
    process.exit(1);
  }
  return v;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function log(level: "info" | "ok" | "error", event: string, data: unknown) {
  // Linha JSON por evento — fácil de filtrar no GH Actions e parsear se
  // virar input pra alerta no futuro.
  process.stdout.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      ...(typeof data === "object" && data !== null ? data : { data }),
    }) + "\n",
  );
}

main().catch((err) => {
  log("error", "fatal", {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
