CREATE TYPE "public"."assignment_state" AS ENUM('open', 'claimed', 'done', 'closed');--> statement-breakpoint
CREATE TYPE "public"."audience" AS ENUM('person', 'subteam', 'pool');--> statement-breakpoint
CREATE TYPE "public"."completion" AS ENUM('once', 'each');--> statement-breakpoint
CREATE TYPE "public"."done_via" AS ENUM('kiosk', 'member_page', 'lead');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('member', 'lead', 'captain');--> statement-breakpoint
CREATE TYPE "public"."source" AS ENUM('kiosk', 'manual');--> statement-breakpoint
CREATE TYPE "public"."task_state" AS ENUM('draft', 'published', 'closed');--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"member_id" uuid,
	"subteam_id" uuid,
	"state" "assignment_state" DEFAULT 'open' NOT NULL,
	"day" date,
	"steps_done" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claimed_at" timestamp with time zone,
	"done_by_id" uuid,
	"done_at" timestamp with time zone,
	"done_via" "done_via",
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"day" date NOT NULL,
	"first_scan_at" timestamp with time zone NOT NULL,
	"source" "source" NOT NULL,
	"recorded_by_id" uuid,
	"kiosk_id" uuid
);
--> statement-breakpoint
CREATE TABLE "change_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "kiosks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"paired_by_id" uuid,
	"paired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "kiosks_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "lead_logins" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"login_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_logins_login_name_unique" UNIQUE("login_name")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"subteam_id" uuid,
	"role" "role" DEFAULT 'member' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"scan_code" text NOT NULL,
	"page_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "members_scan_code_unique" UNIQUE("scan_code"),
	CONSTRAINT "members_page_key_unique" UNIQUE("page_key")
);
--> statement-breakpoint
CREATE TABLE "rate_hits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_hits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "struck_days" (
	"day" date PRIMARY KEY NOT NULL,
	"struck_by_id" uuid,
	"struck_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subteams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subteams_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audience" "audience" NOT NULL,
	"subteam_id" uuid,
	"completion" "completion" DEFAULT 'once' NOT NULL,
	"member_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"due_day" date,
	"standing" boolean DEFAULT false NOT NULL,
	"needs_check" boolean DEFAULT true NOT NULL,
	"state" "task_state" DEFAULT 'draft' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_subteam_id_subteams_id_fk" FOREIGN KEY ("subteam_id") REFERENCES "public"."subteams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_done_by_id_members_id_fk" FOREIGN KEY ("done_by_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_recorded_by_id_members_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_kiosk_id_kiosks_id_fk" FOREIGN KEY ("kiosk_id") REFERENCES "public"."kiosks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_actor_id_members_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_id_members_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosks" ADD CONSTRAINT "kiosks_paired_by_id_members_id_fk" FOREIGN KEY ("paired_by_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_logins" ADD CONSTRAINT "lead_logins_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_subteam_id_subteams_id_fk" FOREIGN KEY ("subteam_id") REFERENCES "public"."subteams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "struck_days" ADD CONSTRAINT "struck_days_struck_by_id_members_id_fk" FOREIGN KEY ("struck_by_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_subteam_id_subteams_id_fk" FOREIGN KEY ("subteam_id") REFERENCES "public"."subteams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_members_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignments_member_state" ON "assignments" USING btree ("member_id","state");--> statement-breakpoint
CREATE INDEX "assignments_task" ON "assignments" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_standing_day" ON "assignments" USING btree ("task_id","day") WHERE "assignments"."day" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_member_day" ON "attendance" USING btree ("member_id","day");--> statement-breakpoint
CREATE INDEX "attendance_day" ON "attendance" USING btree ("day");--> statement-breakpoint
CREATE INDEX "change_log_at" ON "change_log" USING btree ("at");