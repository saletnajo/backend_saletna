import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260611022035 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "cod_payout" drop constraint if exists "cod_payout_order_id_unique";`);
    this.addSql(`create table if not exists "cod_payout" ("id" text not null, "cod_order_id" text not null, "order_id" text not null, "seller_id" text null, "status" text check ("status" in ('pending_settlement', 'settled')) not null default 'pending_settlement', "amount" numeric not null, "currency_code" text not null, "collected_amount" numeric not null, "commission_total" numeric not null, "refunds_total" numeric not null, "cod_fee" numeric null, "breakdown" jsonb null, "settlement_ref" text null, "settled_at" timestamptz null, "raw_amount" jsonb not null, "raw_collected_amount" jsonb not null, "raw_commission_total" jsonb not null, "raw_refunds_total" jsonb not null, "raw_cod_fee" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cod_payout_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cod_payout_order_id_unique" ON "cod_payout" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cod_payout_deleted_at" ON "cod_payout" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cod_payout_status" ON "cod_payout" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cod_payout_seller_id" ON "cod_payout" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cod_payout_cod_order_id" ON "cod_payout" ("cod_order_id") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "cod_order" add column if not exists "idempotency_key" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "cod_payout" cascade;`);

    this.addSql(`alter table if exists "cod_order" drop column if exists "idempotency_key";`);
  }

}
