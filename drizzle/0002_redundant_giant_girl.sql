CREATE TYPE "public"."decision" AS ENUM('approved', 'sent_back');--> statement-breakpoint
ALTER TYPE "public"."assignment_state" ADD VALUE 'submitted';--> statement-breakpoint
ALTER TYPE "public"."assignment_state" ADD VALUE 'sent_back';--> statement-breakpoint
ALTER TYPE "public"."assignment_state" ADD VALUE 'approved';--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"link" text DEFAULT '' NOT NULL,
	"via" "done_via" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decision" "decision",
	"comment" text DEFAULT '' NOT NULL,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_reviewed_by_id_members_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submissions_assignment" ON "submissions" USING btree ("assignment_id");