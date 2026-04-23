ALTER TABLE "lote_cadastrado" DROP CONSTRAINT "lote_cadastrado_nome_unique";--> statement-breakpoint
ALTER TABLE "sku_catalogo" DROP CONSTRAINT "sku_catalogo_codigo_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lote_cadastrado_nome_conta" ON "lote_cadastrado" USING btree ("nome","conta_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sku_catalogo_codigo_conta" ON "sku_catalogo" USING btree ("codigo","conta_id");