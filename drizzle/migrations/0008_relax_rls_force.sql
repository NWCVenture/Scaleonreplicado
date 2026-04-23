-- ============================================================
-- Ajuste de Etapa 6: remover FORCE de RLS.
-- Com FORCE, o owner da tabela (usuário que a app usa em dev/prod
-- atualmente) é filtrado pelas policies → toda query retorna 0 linhas
-- até cada route ser refatorada para usar `withConta`/`withContaAtiva`.
-- Sem FORCE: policies ficam armadas para roles NÃO-owner. Quando um
-- role dedicado (sem ownership das tabelas) for criado em prod,
-- RLS passa a ser estritamente enforçada sem precisar alterar tabelas.
-- withConta continua funcionando e é a forma canônica para novo código.
-- ============================================================

ALTER TABLE "sku_catalogo" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sku_kit_regra" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sku_kit_componente" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lote_cadastrado" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transportadora_padrao" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_item" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contagem_bipagem" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contagem_manuseavel" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contagem_embalado" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coleta_bipagem" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coleta_bipagem_pacote" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coleta_devolucao" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coleta_devolucao_sku" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coleta_bipagem_temporaria" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alteracao_estoque" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "produto_avariado" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "estante" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "estante_fardo" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "estante_movimentacao" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "etiqueta_associacao" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "textil_lote" NO FORCE ROW LEVEL SECURITY;
