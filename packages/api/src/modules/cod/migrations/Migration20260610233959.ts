import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260610233959 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "cod_order" drop constraint if exists "cod_order_order_id_unique";`);
    this.addSql(`create table if not exists "cod_order" ("id" text not null, "order_id" text not null, "order_group_id" text null, "status" text check ("status" in ('pending', 'out_for_delivery', 'collected', 'failed', 'canceled', 'settled')) not null default 'pending', "expected_amount" numeric not null, "collected_amount" numeric null, "currency_code" text not null default 'jod', "cod_fee" numeric null, "attempts" integer not null default 0, "failure_reason" text null, "collected_at" timestamptz null, "collected_by" text null, "courier_ref" text null, "settled_at" timestamptz null, "raw_expected_amount" jsonb not null, "raw_collected_amount" jsonb null, "raw_cod_fee" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cod_order_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cod_order_order_id_unique" ON "cod_order" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cod_order_deleted_at" ON "cod_order" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cod_order_status" ON "cod_order" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cod_order_order_group_id" ON "cod_order" ("order_group_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "cod_order" cascade;`);
  }

}
