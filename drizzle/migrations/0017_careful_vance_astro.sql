CREATE TYPE "public"."sessao_expedicao_status" AS ENUM('ativa', 'encerrada');--> statement-breakpoint
CREATE TABLE "sessao_expedicao" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"status" "sessao_expedicao_status" DEFAULT 'ativa' NOT NULL,
	"iniciou_em" timestamp DEFAULT now() NOT NULL,
	"encerrou_em" timestamp,
	"total_etiquetas" integer DEFAULT 0 NOT NULL,
	"skus_contagem" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"relatorio_enviado" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "historico_impressao_etiquetas" ADD COLUMN "sessao_id" text;--> statement-breakpoint
ALTER TABLE "sessao_expedicao" ADD CONSTRAINT "sessao_expedicao_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessao_expedicao" ADD CONSTRAINT "sessao_expedicao_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sessao_expedicao_conta" ON "sessao_expedicao" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_sessao_expedicao_usuario" ON "sessao_expedicao" USING btree ("usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sessao_expedicao_ativa_por_usuario" ON "sessao_expedicao" USING btree ("usuario_id") WHERE status = 'ativa';--> statement-breakpoint
ALTER TABLE "historico_impressao_etiquetas" ADD CONSTRAINT "historico_impressao_etiquetas_sessao_id_sessao_expedicao_id_fk" FOREIGN KEY ("sessao_id") REFERENCES "public"."sessao_expedicao"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_hist_impressao_sessao" ON "historico_impressao_etiquetas" USING btree ("sessao_id");