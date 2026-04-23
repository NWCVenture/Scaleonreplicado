-- ============================================================
-- Multi-tenant RLS — Onda 1 / Etapa 6
-- Habilita Row Level Security em todas as tabelas operacionais.
-- Sessão define app.conta_atual via set_config('app.conta_atual', <id>, true).
-- Linhas só são visíveis quando conta_id = current_setting('app.conta_atual').
-- FORCE aplica a políticas mesmo para owner/superuser (essencial no Docker local).
-- ============================================================

-- sku_catalogo
ALTER TABLE "sku_catalogo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sku_catalogo" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sku_catalogo" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- sku_kit_regra
ALTER TABLE "sku_kit_regra" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sku_kit_regra" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sku_kit_regra" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- sku_kit_componente
ALTER TABLE "sku_kit_componente" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sku_kit_componente" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sku_kit_componente" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- lote_cadastrado
ALTER TABLE "lote_cadastrado" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lote_cadastrado" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "lote_cadastrado" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- transportadora_padrao
ALTER TABLE "transportadora_padrao" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transportadora_padrao" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "transportadora_padrao" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- stock_item
ALTER TABLE "stock_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_item" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "stock_item" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- contagem_bipagem
ALTER TABLE "contagem_bipagem" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contagem_bipagem" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "contagem_bipagem" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- contagem_manuseavel
ALTER TABLE "contagem_manuseavel" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contagem_manuseavel" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "contagem_manuseavel" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- contagem_embalado
ALTER TABLE "contagem_embalado" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contagem_embalado" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "contagem_embalado" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- coleta_bipagem
ALTER TABLE "coleta_bipagem" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coleta_bipagem" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "coleta_bipagem" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- coleta_bipagem_pacote
ALTER TABLE "coleta_bipagem_pacote" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coleta_bipagem_pacote" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "coleta_bipagem_pacote" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- coleta_devolucao
ALTER TABLE "coleta_devolucao" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coleta_devolucao" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "coleta_devolucao" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- coleta_devolucao_sku
ALTER TABLE "coleta_devolucao_sku" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coleta_devolucao_sku" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "coleta_devolucao_sku" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- coleta_bipagem_temporaria
ALTER TABLE "coleta_bipagem_temporaria" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coleta_bipagem_temporaria" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "coleta_bipagem_temporaria" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- alteracao_estoque
ALTER TABLE "alteracao_estoque" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alteracao_estoque" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "alteracao_estoque" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- produto_avariado
ALTER TABLE "produto_avariado" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "produto_avariado" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "produto_avariado" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- estante
ALTER TABLE "estante" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "estante" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "estante" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- estante_fardo
ALTER TABLE "estante_fardo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "estante_fardo" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "estante_fardo" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- estante_movimentacao
ALTER TABLE "estante_movimentacao" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "estante_movimentacao" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "estante_movimentacao" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- etiqueta_associacao
ALTER TABLE "etiqueta_associacao" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "etiqueta_associacao" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "etiqueta_associacao" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- textil_lote
ALTER TABLE "textil_lote" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "textil_lote" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "textil_lote" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));
