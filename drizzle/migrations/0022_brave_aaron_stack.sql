CREATE TABLE "tracking_id_impresso" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"tracking_id" text NOT NULL,
	"historico_id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"group_label" text DEFAULT '' NOT NULL,
	"reimpressao" boolean DEFAULT false NOT NULL,
	"impresso_em" timestamp DEFAULT now() NOT NULL,
	"expira_em" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracking_id_impresso" ADD CONSTRAINT "tracking_id_impresso_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_id_impresso" ADD CONSTRAINT "tracking_id_impresso_historico_id_historico_impressao_etiquetas_id_fk" FOREIGN KEY ("historico_id") REFERENCES "public"."historico_impressao_etiquetas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_id_impresso" ADD CONSTRAINT "tracking_id_impresso_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tracking_lookup" ON "tracking_id_impresso" USING btree ("conta_id","tracking_id");--> statement-breakpoint
CREATE INDEX "idx_tracking_expira" ON "tracking_id_impresso" USING btree ("expira_em");--> statement-breakpoint
CREATE INDEX "idx_tracking_usuario" ON "tracking_id_impresso" USING btree ("usuario_id","impresso_em");--> statement-breakpoint

-- ============================================================
-- RLS multi-tenant (mesmo padrão de drizzle/migrations/0007_enable_rls_tenancy.sql)
-- Drizzle não gera RLS automaticamente — adicionado manualmente.
-- ============================================================
ALTER TABLE "tracking_id_impresso" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tracking_id_impresso" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tracking_id_impresso" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));