CREATE TYPE "public"."canal_estrategia_prazo" AS ENUM('DIAS_UTEIS_POS_VENDA', 'CAMPO_EXPLICITO', 'HIBRIDO');--> statement-breakpoint
CREATE TABLE "canal_regra_prazo" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"canal_venda_id" text,
	"plataforma" "plataforma_canal" NOT NULL,
	"estrategia" "canal_estrategia_prazo" NOT NULL,
	"dias_uteis" integer,
	"campo_prazo" text,
	"regex_prazo" text,
	"fallback_hoje" boolean DEFAULT false NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categoria_sku" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"nome" text NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"regras" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cor_alias" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"modelo_id" text,
	"codigo_alias" text NOT NULL,
	"codigo_real" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cor_alias_codigo" UNIQUE NULLS NOT DISTINCT("conta_id","modelo_id","codigo_alias")
);
--> statement-breakpoint
CREATE TABLE "feriado" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"data" date NOT NULL,
	"descricao" text NOT NULL,
	"fonte" text DEFAULT 'manual' NOT NULL,
	"referencia_externa" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tamanho_alias" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"modelo_id" text,
	"codigo_alias" text NOT NULL,
	"codigo_real" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_tamanho_alias_codigo" UNIQUE NULLS NOT DISTINCT("conta_id","modelo_id","codigo_alias")
);
--> statement-breakpoint
ALTER TABLE "modelo_principal" ADD COLUMN "cor_padrao" text;--> statement-breakpoint
ALTER TABLE "modelo_principal" ADD COLUMN "exige_tamanho" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "modelo_principal" ADD COLUMN "cor_mix_default" jsonb;--> statement-breakpoint
ALTER TABLE "canal_regra_prazo" ADD CONSTRAINT "canal_regra_prazo_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canal_regra_prazo" ADD CONSTRAINT "canal_regra_prazo_canal_venda_id_canais_venda_id_fk" FOREIGN KEY ("canal_venda_id") REFERENCES "public"."canais_venda"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categoria_sku" ADD CONSTRAINT "categoria_sku_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cor_alias" ADD CONSTRAINT "cor_alias_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cor_alias" ADD CONSTRAINT "cor_alias_modelo_id_modelo_principal_id_fk" FOREIGN KEY ("modelo_id") REFERENCES "public"."modelo_principal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feriado" ADD CONSTRAINT "feriado_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tamanho_alias" ADD CONSTRAINT "tamanho_alias_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tamanho_alias" ADD CONSTRAINT "tamanho_alias_modelo_id_modelo_principal_id_fk" FOREIGN KEY ("modelo_id") REFERENCES "public"."modelo_principal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_canal_regra_prazo_conta" ON "canal_regra_prazo" USING btree ("conta_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_canal_regra_prazo_default_plataforma" ON "canal_regra_prazo" USING btree ("conta_id","plataforma") WHERE canal_venda_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_canal_regra_prazo_canal_especifico" ON "canal_regra_prazo" USING btree ("conta_id","canal_venda_id") WHERE canal_venda_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_categoria_sku_conta" ON "categoria_sku" USING btree ("conta_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_categoria_sku_nome_conta" ON "categoria_sku" USING btree ("conta_id","nome");--> statement-breakpoint
CREATE INDEX "idx_cor_alias_conta" ON "cor_alias" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_cor_alias_modelo" ON "cor_alias" USING btree ("modelo_id");--> statement-breakpoint
CREATE INDEX "idx_feriado_conta_data" ON "feriado" USING btree ("conta_id","data");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_feriado_conta_data" ON "feriado" USING btree ("conta_id","data");--> statement-breakpoint
CREATE INDEX "idx_tamanho_alias_conta" ON "tamanho_alias" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_tamanho_alias_modelo" ON "tamanho_alias" USING btree ("modelo_id");--> statement-breakpoint
-- ============================================================
-- RLS — Módulo Central de Envios (RITM-01)
-- ============================================================
-- Drizzle não gera RLS. Adicionado manualmente. Mesma policy padrão das
-- demais tabelas operacionais: isolamento por conta_id via app.conta_atual.
-- Em prod, restore-rls-policies.ts recria estas policies após push.
ALTER TABLE "tamanho_alias" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tamanho_alias" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint
ALTER TABLE "cor_alias" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cor_alias" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint
ALTER TABLE "feriado" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "feriado" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint
ALTER TABLE "canal_regra_prazo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "canal_regra_prazo" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint
ALTER TABLE "categoria_sku" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "categoria_sku" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));