CREATE TYPE "public"."emissor_nota" AS ENUM('proprio', 'bling', 'manual');--> statement-breakpoint
CREATE TYPE "public"."plataforma_canal" AS ENUM('tiktok_shop', 'shopee', 'mercado_livre');--> statement-breakpoint
CREATE TYPE "public"."status_renovacao_oauth" AS ENUM('ativo', 'falha_reauth', 'expirado');--> statement-breakpoint
CREATE TABLE "canais_venda" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"cnpj_id" text,
	"plataforma" "plataforma_canal" NOT NULL,
	"identificador_loja" text NOT NULL,
	"nome_exibicao" text NOT NULL,
	"emissor_nota" "emissor_nota" DEFAULT 'proprio' NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"ultima_sync_em" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credenciais_oauth_tiktok" (
	"id" text PRIMARY KEY NOT NULL,
	"canal_venda_id" text NOT NULL,
	"conta_id" text NOT NULL,
	"shop_id" text NOT NULL,
	"shop_cipher" text NOT NULL,
	"access_token_criptografado" text NOT NULL,
	"access_token_expira_em" timestamp NOT NULL,
	"refresh_token_criptografado" text NOT NULL,
	"refresh_token_expira_em" timestamp NOT NULL,
	"escopos_autorizados" jsonb NOT NULL,
	"seller_name" text,
	"ultima_renovacao_em" timestamp,
	"status_renovacao" "status_renovacao_oauth" DEFAULT 'ativo' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credenciais_oauth_tiktok_canal_venda_id_unique" UNIQUE("canal_venda_id")
);
--> statement-breakpoint
CREATE TABLE "eventos_webhook_tiktok" (
	"id" text PRIMARY KEY NOT NULL,
	"canal_venda_id" text,
	"conta_id" text,
	"tipo_evento" text NOT NULL,
	"shop_id_externo" text,
	"payload_json" jsonb NOT NULL,
	"headers_json" jsonb NOT NULL,
	"assinatura_valida" boolean NOT NULL,
	"processado_em" timestamp,
	"erro_processamento" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log_sincronizacao_canal" (
	"id" text PRIMARY KEY NOT NULL,
	"canal_venda_id" text NOT NULL,
	"conta_id" text NOT NULL,
	"tipo" text NOT NULL,
	"operacao" text NOT NULL,
	"payload_enviado" jsonb,
	"resposta_recebida" jsonb,
	"status_http" integer,
	"sucesso" boolean NOT NULL,
	"erro_mensagem" text,
	"duracao_ms" integer,
	"tentativa" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sku_canal" (
	"id" text PRIMARY KEY NOT NULL,
	"canal_venda_id" text NOT NULL,
	"conta_id" text NOT NULL,
	"produto_id" text,
	"sku_interno" text NOT NULL,
	"sku_externo" text NOT NULL,
	"product_id_externo" text,
	"sku_id_externo" text,
	"buffer_seguranca" integer DEFAULT 0 NOT NULL,
	"ultima_qtd_publicada" integer,
	"ultima_sync_em" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canais_venda" ADD CONSTRAINT "canais_venda_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credenciais_oauth_tiktok" ADD CONSTRAINT "credenciais_oauth_tiktok_canal_venda_id_canais_venda_id_fk" FOREIGN KEY ("canal_venda_id") REFERENCES "public"."canais_venda"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credenciais_oauth_tiktok" ADD CONSTRAINT "credenciais_oauth_tiktok_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos_webhook_tiktok" ADD CONSTRAINT "eventos_webhook_tiktok_canal_venda_id_canais_venda_id_fk" FOREIGN KEY ("canal_venda_id") REFERENCES "public"."canais_venda"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos_webhook_tiktok" ADD CONSTRAINT "eventos_webhook_tiktok_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_sincronizacao_canal" ADD CONSTRAINT "log_sincronizacao_canal_canal_venda_id_canais_venda_id_fk" FOREIGN KEY ("canal_venda_id") REFERENCES "public"."canais_venda"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_sincronizacao_canal" ADD CONSTRAINT "log_sincronizacao_canal_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_canal" ADD CONSTRAINT "sku_canal_canal_venda_id_canais_venda_id_fk" FOREIGN KEY ("canal_venda_id") REFERENCES "public"."canais_venda"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_canal" ADD CONSTRAINT "sku_canal_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_canais_conta_plataforma" ON "canais_venda" USING btree ("conta_id","plataforma");--> statement-breakpoint
CREATE UNIQUE INDEX "unq_canal_cnpj_loja" ON "canais_venda" USING btree ("cnpj_id","plataforma","identificador_loja");--> statement-breakpoint
CREATE UNIQUE INDEX "unq_canal_conta_plataforma_loja" ON "canais_venda" USING btree ("conta_id","plataforma","identificador_loja");--> statement-breakpoint
CREATE INDEX "idx_tiktok_oauth_expiracao" ON "credenciais_oauth_tiktok" USING btree ("access_token_expira_em");--> statement-breakpoint
CREATE INDEX "idx_tiktok_oauth_conta" ON "credenciais_oauth_tiktok" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_tipo_data" ON "eventos_webhook_tiktok" USING btree ("tipo_evento","created_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_shop" ON "eventos_webhook_tiktok" USING btree ("shop_id_externo");--> statement-breakpoint
CREATE INDEX "idx_log_canal_data" ON "log_sincronizacao_canal" USING btree ("canal_venda_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_log_sucesso" ON "log_sincronizacao_canal" USING btree ("sucesso","created_at");--> statement-breakpoint
CREATE INDEX "idx_sku_canal_produto" ON "sku_canal" USING btree ("canal_venda_id","produto_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unq_sku_canal_externo" ON "sku_canal" USING btree ("canal_venda_id","sku_externo");--> statement-breakpoint

-- ============================================================
-- RLS: Row Level Security para tabelas do módulo de canais
-- Padrão do projeto (ver 0007/0008):
--  - ENABLE sem FORCE: owner bypassa (compatível com neondb_owner em prod e
--    postgres superuser em dev). Policies ficam armadas pra role dedicado.
--  - USING + WITH CHECK em `conta_id = current_setting('app.conta_atual')`.
--  - `withConta`/`withContaAtiva` em src/lib/tenancy.ts seta a var em transação.
-- Exceção: eventos_webhook_tiktok aceita conta_id IS NULL porque o receiver
-- (RITM-10) insere antes de resolver qual canal/conta. Essa resolução é feita
-- por role com bypass RLS e depois o processador atualiza conta_id.
-- ============================================================

ALTER TABLE "canais_venda" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "canais_venda" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

ALTER TABLE "credenciais_oauth_tiktok" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "credenciais_oauth_tiktok" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

ALTER TABLE "eventos_webhook_tiktok" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "eventos_webhook_tiktok" USING (conta_id IS NULL OR conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id IS NULL OR conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

ALTER TABLE "log_sincronizacao_canal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "log_sincronizacao_canal" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

ALTER TABLE "sku_canal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sku_canal" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));