// One-shot: restaura ENABLE ROW LEVEL SECURITY + CREATE POLICY tenant_isolation
// em todas as tabelas operacionais. Script criado em 2026-04-23 para corrigir
// um push que dropou as policies ao sincronizar o schema do Neon.
//
// Idempotente: DROP POLICY IF EXISTS antes de CREATE. Executa tudo em
// uma única transação — se algum statement falhar, nada é aplicado.
//
// Uso:
//   dotenv -e .env.prod -- npx tsx src/lib/db/restore-rls-policies.ts
// ou para dev (não precisa, já foi criado via migrations):
//   dotenv -e .env.local -- npx tsx src/lib/db/restore-rls-policies.ts

import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL não definida. Use dotenv -e .env.prod ou .env.local.",
  );
}

const client = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_URL.includes("sslmode=require") ? "require" : false,
});

// Tabelas com policy padrão: conta_id = current_setting('app.conta_atual', true)
const TABELAS_PADRAO = [
  // Originais 0007
  "sku_catalogo",
  "sku_kit_regra",
  "sku_kit_componente",
  "lote_cadastrado",
  "transportadora_padrao",
  "stock_item",
  "contagem_bipagem",
  "contagem_manuseavel",
  "contagem_embalado",
  "coleta_bipagem",
  "coleta_bipagem_pacote",
  "coleta_devolucao",
  "coleta_devolucao_sku",
  "alteracao_estoque",
  "produto_avariado",
  "estante",
  "estante_fardo",
  "estante_movimentacao",
  "etiqueta_associacao",
  "textil_lote",
  // Canais (0014)
  "canais_venda",
  "credenciais_oauth_tiktok",
  "log_sincronizacao_canal",
  "sku_canal",
  // Expedição Diária + SKU Principal + Sessão (0015-0017)
  "historico_impressao_etiquetas",
  "sessao_expedicao",
  "modelo_principal",
  "modelo_cor",
  "modelo_tamanho",
  // Dedup robusta de tracking ID (0022)
  "tracking_id_impresso",
  // Módulo Confecção — Cadastros (0023, RITM-01)
  "confeccao_produto",
  "confeccao_fornecedor",
  "confeccao_tipo_tecido",
  "confeccao_cor",
  "confeccao_fornecedor_tecido_preco",
  // Módulo Confecção — OP + Subtasks + Notas + Anexos (0024, RITM-02)
  "confeccao_ordem_producao",
  "confeccao_subtask",
  "confeccao_nota",
  "confeccao_anexo",
  // Módulo Confecção — Lalamove + Retiradas + Subconferências (0025, RITM-03)
  "confeccao_lalamove",
  "confeccao_lalamove_cotacao",
  "confeccao_retirada",
  "confeccao_subconferencia",
  // Módulo Confecção — Templates WhatsApp (0026, RITM-16)
  "confeccao_template_whatsapp",
  // Módulo Confecção — Alertas de atraso (RITM-22)
  "confeccao_alerta_atraso_log",
  // Módulo Central de Envios — Cadastros (RITM-01)
  "tamanho_alias",
  "cor_alias",
  "feriado",
  "canal_regra_prazo",
  "categoria_sku",
  // Módulo Central de Envios — Ingestão (RITM-02)
  "ingestao_run",
  // Módulo Central de Envios — Sessão (RITM-07)
  "sessao_central_envios",
  // Módulo Central de Envios — Histórico/arquivamento (RITM-11)
  "planejamento_envios",
] as const;

// Tabelas com variante "conta_id IS NULL": receiver insere antes de
// resolver canal/conta; resolução acontece em role com bypass.
const TABELAS_WEBHOOK = [
  "eventos_webhook_tiktok",
  "confeccao_lalamove_webhook_event", // RITM-03
] as const;

async function main() {
  console.log("=== Restaurando RLS + policies ===");
  console.log(`Target: ${process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "?"}`);
  console.log("");

  // Valida que as tabelas existem antes de tentar criar policies
  const tabelasEsperadas = [...TABELAS_PADRAO, ...TABELAS_WEBHOOK];
  const existentes = await client<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY(${tabelasEsperadas as unknown as string[]})
  `;
  const existentesSet = new Set(existentes.map((r) => r.table_name));
  const faltando = tabelasEsperadas.filter((t) => !existentesSet.has(t));
  if (faltando.length > 0) {
    console.error(
      `Tabelas não encontradas (abortar): ${faltando.join(", ")}`,
    );
    await client.end();
    process.exit(1);
  }

  let aplicados = 0;
  await client.begin(async (tx) => {
    for (const tabela of TABELAS_PADRAO) {
      await tx.unsafe(`ALTER TABLE "${tabela}" ENABLE ROW LEVEL SECURITY`);
      await tx.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON "${tabela}"`);
      await tx.unsafe(
        `CREATE POLICY tenant_isolation ON "${tabela}" ` +
          `USING (conta_id = current_setting('app.conta_atual', true)) ` +
          `WITH CHECK (conta_id = current_setting('app.conta_atual', true))`,
      );
      aplicados++;
      console.log(`  ✓ ${tabela}`);
    }

    // Variantes com conta_id IS NULL (receivers de webhook)
    for (const tabela of TABELAS_WEBHOOK) {
      await tx.unsafe(
        `ALTER TABLE "${tabela}" ENABLE ROW LEVEL SECURITY`,
      );
      await tx.unsafe(
        `DROP POLICY IF EXISTS tenant_isolation ON "${tabela}"`,
      );
      await tx.unsafe(
        `CREATE POLICY tenant_isolation ON "${tabela}" ` +
          `USING (conta_id IS NULL OR conta_id = current_setting('app.conta_atual', true)) ` +
          `WITH CHECK (conta_id IS NULL OR conta_id = current_setting('app.conta_atual', true))`,
      );
      aplicados++;
      console.log(`  ✓ ${tabela} (variante IS NULL)`);
    }
  });

  console.log("");
  console.log(`=== ${aplicados} tabelas com RLS + tenant_isolation ===`);

  // Verificação pós
  const policies = await client<{ tablename: string; policyname: string }[]>`
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;
  console.log("");
  console.log(`Policies ativas: ${policies.length}`);
  const rlsAtivo = await client<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity = true
    ORDER BY tablename
  `;
  console.log(`Tabelas com RLS ativo: ${rlsAtivo.length}`);

  await client.end();
}

main().catch(async (err) => {
  console.error("Falhou:", err);
  await client.end();
  process.exit(1);
});
