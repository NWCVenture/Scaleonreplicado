ALTER TABLE "modelo_principal" ADD COLUMN "custo_upseller" real;--> statement-breakpoint
ALTER TABLE "sku_catalogo" ADD COLUMN "pausado_upseller" boolean DEFAULT false NOT NULL;