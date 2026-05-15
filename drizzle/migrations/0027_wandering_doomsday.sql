CREATE TYPE "public"."confeccao_alerta_atraso_tipo" AS ENUM('vencendo_24h', 'vencido');--> statement-breakpoint
CREATE TABLE "confeccao_alerta_atraso_log" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"ordem_producao_id" text NOT NULL,
	"subtask_id" text NOT NULL,
	"oficina_id" text NOT NULL,
	"tipo_alerta" "confeccao_alerta_atraso_tipo" NOT NULL,
	"data_referencia" timestamp NOT NULL,
	"enviados_count" integer DEFAULT 0 NOT NULL,
	"destinatarios_count" integer DEFAULT 0 NOT NULL,
	"enviado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confeccao_alerta_atraso_log" ADD CONSTRAINT "confeccao_alerta_atraso_log_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_alerta_atraso_log" ADD CONSTRAINT "confeccao_alerta_atraso_log_ordem_producao_id_confeccao_ordem_producao_id_fk" FOREIGN KEY ("ordem_producao_id") REFERENCES "public"."confeccao_ordem_producao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_alerta_atraso_log" ADD CONSTRAINT "confeccao_alerta_atraso_log_subtask_id_confeccao_subtask_id_fk" FOREIGN KEY ("subtask_id") REFERENCES "public"."confeccao_subtask"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_alerta_atraso_log" ADD CONSTRAINT "confeccao_alerta_atraso_log_oficina_id_confeccao_fornecedor_id_fk" FOREIGN KEY ("oficina_id") REFERENCES "public"."confeccao_fornecedor"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_confeccao_alerta_atraso" ON "confeccao_alerta_atraso_log" USING btree ("conta_id","subtask_id","oficina_id","tipo_alerta","data_referencia");--> statement-breakpoint
CREATE INDEX "idx_confeccao_alerta_atraso_op" ON "confeccao_alerta_atraso_log" USING btree ("ordem_producao_id");--> statement-breakpoint
-- RLS (multi-tenant): mesma policy padrão das outras tabelas do módulo
ALTER TABLE "confeccao_alerta_atraso_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "confeccao_alerta_atraso_log" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));