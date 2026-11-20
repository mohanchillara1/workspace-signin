ALTER TYPE "public"."source" ADD VALUE 'sheet';--> statement-breakpoint
ALTER TABLE "attendance" ALTER COLUMN "first_scan_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "added_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Written by hand: a row that was there before this column was made at its scan time.
UPDATE "attendance" SET "added_at" = "first_scan_at" WHERE "first_scan_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "counts_from" date;