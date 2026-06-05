CREATE TYPE "public"."ingestao_run_status" AS ENUM('pendente', 'processando', 'concluido', 'erro');--> statement-breakpoint
CREATE TYPE "public"."ingestao_run_tipo" AS ENUM('tiktok_csv', 'ml_xlsx');--> statement-breakpoint
CREATE TABLE "ingestao_run" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"tipo" "ingestao_run_tipo" NOT NULL,
	"arquivo_nome" text NOT NULL,
	"arquivo_blob_url" text NOT NULL,
	"arquivo_tamanho_bytes" integer NOT NULL,
	"arquivo_content_type" text,
	"inngest_event_id" text,
	"status" "ingestao_run_status" DEFAULT 'pendente' NOT NULL,
	"total_linhas" integer,
	"linhas_validas" integer,
	"linhas_descartadas" integer,
	"descartes_resumo" jsonb,
	"resultado" jsonb,
	"resultado_blob_url" text,
	"erro" text,
	"erro_codigo" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "ingestao_run" ADD CONSTRAINT "ingestao_run_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestao_run" ADD CONSTRAINT "ingestao_run_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ingestao_run_conta_created" ON "ingestao_run" USING btree ("conta_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_ingestao_run_status_ativo" ON "ingestao_run" USING btree ("status") WHERE status IN ('pendente', 'processando');--> statement-breakpoint
-- RLS — isolamento por conta_id (vide AGENTS.md, padrão das demais tabelas).
ALTER TABLE "ingestao_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ingestao_run"
  USING ("conta_id" = current_setting('app.conta_atual', true))
  WITH CHECK ("conta_id" = current_setting('app.conta_atual', true));