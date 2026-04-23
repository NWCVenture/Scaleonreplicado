CREATE TYPE "public"."papel_conta" AS ENUM('owner', 'admin', 'gerente', 'operador', 'costureiro', 'financeiro', 'fiscal');--> statement-breakpoint
CREATE TYPE "public"."plano" AS ENUM('trial', 'starter', 'pro', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."status_conta" AS ENUM('trial', 'ativa', 'suspensa', 'cancelada');--> statement-breakpoint
CREATE TABLE "conta" (
	"id" text PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"email_principal" text NOT NULL,
	"telefone" text,
	"cpf_responsavel" text,
	"plano" "plano" DEFAULT 'trial' NOT NULL,
	"status" "status_conta" DEFAULT 'trial' NOT NULL,
	"trial_expira_em" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "convite" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"email" text NOT NULL,
	"papel" "papel_conta" DEFAULT 'operador' NOT NULL,
	"token_unico" text NOT NULL,
	"convidado_por_id" text NOT NULL,
	"expira_em" timestamp NOT NULL,
	"aceito_em" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "convite_token_unico_unique" UNIQUE("token_unico")
);
--> statement-breakpoint
CREATE TABLE "usuario_conta" (
	"id" text PRIMARY KEY NOT NULL,
	"usuario_id" text NOT NULL,
	"conta_id" text NOT NULL,
	"papel" "papel_conta" DEFAULT 'operador' NOT NULL,
	"convidado_por_id" text,
	"aceito_em" timestamp,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "convite" ADD CONSTRAINT "convite_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convite" ADD CONSTRAINT "convite_convidado_por_id_user_id_fk" FOREIGN KEY ("convidado_por_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_conta" ADD CONSTRAINT "usuario_conta_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_conta" ADD CONSTRAINT "usuario_conta_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_conta" ADD CONSTRAINT "usuario_conta_convidado_por_id_user_id_fk" FOREIGN KEY ("convidado_por_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_conta_status" ON "conta" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_conta_plano" ON "conta" USING btree ("plano");--> statement-breakpoint
CREATE INDEX "idx_convite_conta" ON "convite" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_convite_email" ON "convite" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_convite_expira" ON "convite" USING btree ("expira_em");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_usuario_conta" ON "usuario_conta" USING btree ("usuario_id","conta_id");--> statement-breakpoint
CREATE INDEX "idx_usuario_conta_conta" ON "usuario_conta" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_usuario_conta_usuario" ON "usuario_conta" USING btree ("usuario_id");