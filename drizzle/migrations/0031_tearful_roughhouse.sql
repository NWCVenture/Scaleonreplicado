CREATE TYPE "public"."sessao_central_envios_motivo_encerro" AS ENUM('finalizada', 'forcada', 'expirada');--> statement-breakpoint
CREATE TYPE "public"."sessao_central_envios_status" AS ENUM('ativa', 'encerrada');--> statement-breakpoint
CREATE TABLE "sessao_central_envios" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"status" "sessao_central_envios_status" DEFAULT 'ativa' NOT NULL,
	"arquivos_ingeridos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dados" jsonb,
	"dados_blob_url" text,
	"estatisticas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"filtros_extrator" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tipo_visualizacao" text DEFAULT 'dashboard' NOT NULL,
	"iniciou_em" timestamp DEFAULT now() NOT NULL,
	"ultima_atividade_em" timestamp DEFAULT now() NOT NULL,
	"encerrou_em" timestamp,
	"encerrada_motivo" "sessao_central_envios_motivo_encerro"
);
--> statement-breakpoint
ALTER TABLE "sessao_central_envios" ADD CONSTRAINT "sessao_central_envios_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessao_central_envios" ADD CONSTRAINT "sessao_central_envios_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sessao_ce_conta" ON "sessao_central_envios" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_sessao_ce_usuario" ON "sessao_central_envios" USING btree ("usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sessao_ce_ativa_por_usuario" ON "sessao_central_envios" USING btree ("usuario_id") WHERE status = 'ativa';--> statement-breakpoint
-- RLS — isolamento por conta_id (vide AGENTS.md).
ALTER TABLE "sessao_central_envios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sessao_central_envios"
  USING ("conta_id" = current_setting('app.conta_atual', true))
  WITH CHECK ("conta_id" = current_setting('app.conta_atual', true));