ALTER TYPE "public"."papel_conta" ADD VALUE 'supervisor';--> statement-breakpoint
ALTER TYPE "public"."papel_conta" ADD VALUE 'funcionario';--> statement-breakpoint
ALTER TYPE "public"."papel_conta" ADD VALUE 'expedicao';--> statement-breakpoint
CREATE TABLE "email_change_request" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"email_atual" text NOT NULL,
	"email_novo" text NOT NULL,
	"token_atual" text NOT NULL,
	"token_novo" text NOT NULL,
	"confirmado_atual_em" timestamp,
	"confirmado_novo_em" timestamp,
	"aplicado_em" timestamp,
	"cancelado_em" timestamp,
	"expira_em" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_change_request_token_atual_unique" UNIQUE("token_atual"),
	CONSTRAINT "email_change_request_token_novo_unique" UNIQUE("token_novo")
);
--> statement-breakpoint
ALTER TABLE "email_change_request" ADD CONSTRAINT "email_change_request_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_change_request" ADD CONSTRAINT "email_change_request_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_email_change_conta" ON "email_change_request" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_email_change_owner" ON "email_change_request" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_email_change_expira" ON "email_change_request" USING btree ("expira_em");