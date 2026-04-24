CREATE TYPE "public"."sessao_coletas_status" AS ENUM('ativa', 'encerrada');--> statement-breakpoint
CREATE TABLE "sessao_coletas" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"status" "sessao_coletas_status" DEFAULT 'ativa' NOT NULL,
	"tipo" "tipo_coleta" DEFAULT 'COLETA' NOT NULL,
	"conta" "conta_operacao" DEFAULT 'TIKTOK_SHOP' NOT NULL,
	"pacotes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"devolucoes_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_pacotes" integer DEFAULT 0 NOT NULL,
	"iniciou_em" timestamp DEFAULT now() NOT NULL,
	"ultima_atividade_em" timestamp DEFAULT now() NOT NULL,
	"encerrou_em" timestamp,
	"encerrada_motivo" text
);
--> statement-breakpoint
ALTER TABLE "sessao_coletas" ADD CONSTRAINT "sessao_coletas_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessao_coletas" ADD CONSTRAINT "sessao_coletas_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sessao_coletas_conta" ON "sessao_coletas" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_sessao_coletas_usuario" ON "sessao_coletas" USING btree ("usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sessao_coletas_ativa_por_usuario" ON "sessao_coletas" USING btree ("usuario_id") WHERE status = 'ativa';