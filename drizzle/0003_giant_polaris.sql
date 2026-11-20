ALTER TYPE "public"."done_via" ADD VALUE 'slack';--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "slack_user_id" text;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_slack_user_id_unique" UNIQUE("slack_user_id");