CREATE TABLE "confeccao_template_whatsapp" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"nome" text NOT NULL,
	"categoria" "confeccao_fornecedor_categoria" NOT NULL,
	"corpo" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confeccao_template_whatsapp" ADD CONSTRAINT "confeccao_template_whatsapp_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_confeccao_template_whatsapp_categoria" ON "confeccao_template_whatsapp" USING btree ("conta_id","categoria");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_confeccao_template_whatsapp_nome_conta" ON "confeccao_template_whatsapp" USING btree ("conta_id","nome");--> statement-breakpoint

-- RLS
ALTER TABLE "confeccao_template_whatsapp" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "confeccao_template_whatsapp" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));