CREATE TABLE "planejamento_envios" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"sessao_id" text,
	"gerado_em" timestamp DEFAULT now() NOT NULL,
	"data_referencia" date NOT NULL,
	"total_pedidos" integer NOT NULL,
	"total_atrasados" integer NOT NULL,
	"total_hoje" integer NOT NULL,
	"total_ambiguos" integer NOT NULL,
	"total_arquivos" integer NOT NULL,
	"arquivos_ingeridos" jsonb NOT NULL,
	"estatisticas" jsonb NOT NULL,
	"dados" jsonb,
	"dados_blob_url" text,
	"email_enviado_para" jsonb,
	"email_enviado_em" timestamp
);
--> statement-breakpoint
ALTER TABLE "planejamento_envios" ADD CONSTRAINT "planejamento_envios_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planejamento_envios" ADD CONSTRAINT "planejamento_envios_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_planejamento_envios_conta_gerado" ON "planejamento_envios" USING btree ("conta_id","gerado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_planejamento_envios_usuario" ON "planejamento_envios" USING btree ("usuario_id");--> statement-breakpoint
-- RLS — isolamento por conta_id (vide AGENTS.md).
ALTER TABLE "planejamento_envios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "planejamento_envios"
  USING ("conta_id" = current_setting('app.conta_atual', true))
  WITH CHECK ("conta_id" = current_setting('app.conta_atual', true));
