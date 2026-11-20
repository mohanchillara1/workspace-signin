CREATE TABLE "member_logins" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"login_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_logins_login_name_unique" UNIQUE("login_name")
);
--> statement-breakpoint
ALTER TABLE "member_logins" ADD CONSTRAINT "member_logins_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;