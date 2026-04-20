ALTER TABLE "stock_item" ADD COLUMN "codigo_fardo" text;--> statement-breakpoint
CREATE INDEX "idx_stock_item_codigo_fardo" ON "stock_item" USING btree ("codigo_fardo");--> statement-breakpoint
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_codigo_fardo_unique" UNIQUE("codigo_fardo");