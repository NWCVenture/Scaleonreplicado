DROP INDEX "idx_coleta_bipagem_conta";--> statement-breakpoint
ALTER TABLE "alteracao_estoque" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "coleta_bipagem" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "coleta_bipagem_pacote" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "coleta_bipagem_temporaria" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "coleta_devolucao" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "coleta_devolucao_sku" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "contagem_bipagem" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "contagem_embalado" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "contagem_manuseavel" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "estante" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "estante_fardo" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "estante_movimentacao" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "etiqueta_associacao" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "lote_cadastrado" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "produto_avariado" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "sku_catalogo" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "sku_kit_componente" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "sku_kit_regra" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "stock_item" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "textil_lote" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "transportadora_padrao" ADD COLUMN "conta_id" text;--> statement-breakpoint
ALTER TABLE "alteracao_estoque" ADD CONSTRAINT "alteracao_estoque_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coleta_bipagem" ADD CONSTRAINT "coleta_bipagem_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coleta_bipagem_pacote" ADD CONSTRAINT "coleta_bipagem_pacote_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coleta_bipagem_temporaria" ADD CONSTRAINT "coleta_bipagem_temporaria_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coleta_devolucao" ADD CONSTRAINT "coleta_devolucao_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coleta_devolucao_sku" ADD CONSTRAINT "coleta_devolucao_sku_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contagem_bipagem" ADD CONSTRAINT "contagem_bipagem_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contagem_embalado" ADD CONSTRAINT "contagem_embalado_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contagem_manuseavel" ADD CONSTRAINT "contagem_manuseavel_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estante" ADD CONSTRAINT "estante_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estante_fardo" ADD CONSTRAINT "estante_fardo_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estante_movimentacao" ADD CONSTRAINT "estante_movimentacao_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etiqueta_associacao" ADD CONSTRAINT "etiqueta_associacao_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lote_cadastrado" ADD CONSTRAINT "lote_cadastrado_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produto_avariado" ADD CONSTRAINT "produto_avariado_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_catalogo" ADD CONSTRAINT "sku_catalogo_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_kit_componente" ADD CONSTRAINT "sku_kit_componente_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_kit_regra" ADD CONSTRAINT "sku_kit_regra_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textil_lote" ADD CONSTRAINT "textil_lote_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transportadora_padrao" ADD CONSTRAINT "transportadora_padrao_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_alteracao_conta" ON "alteracao_estoque" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_coleta_bipagem_conta_op" ON "coleta_bipagem" USING btree ("conta");--> statement-breakpoint
CREATE INDEX "idx_coleta_pacote_conta" ON "coleta_bipagem_pacote" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_coleta_temp_conta" ON "coleta_bipagem_temporaria" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_coleta_devolucao_conta" ON "coleta_devolucao" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_coleta_devolucao_sku_conta" ON "coleta_devolucao_sku" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_contagem_bipagem_conta" ON "contagem_bipagem" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_contagem_embalado_conta" ON "contagem_embalado" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_contagem_manuseavel_conta" ON "contagem_manuseavel" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_estante_conta" ON "estante" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_estante_fardo_conta" ON "estante_fardo" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_estante_mov_conta" ON "estante_movimentacao" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_etiqueta_conta" ON "etiqueta_associacao" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_lote_cadastrado_conta" ON "lote_cadastrado" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_avariado_conta" ON "produto_avariado" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_sku_catalogo_conta" ON "sku_catalogo" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_sku_kit_componente_conta" ON "sku_kit_componente" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_sku_kit_regra_conta" ON "sku_kit_regra" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_stock_item_conta" ON "stock_item" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_textil_conta" ON "textil_lote" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_transportadora_padrao_conta" ON "transportadora_padrao" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_coleta_bipagem_conta" ON "coleta_bipagem" USING btree ("conta_id");