CREATE TABLE "member_subteams" (
	"member_id" uuid NOT NULL,
	"subteam_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_subteams_member_id_subteam_id_pk" PRIMARY KEY("member_id","subteam_id")
);
--> statement-breakpoint
ALTER TABLE "subteams" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "member_subteams" ADD CONSTRAINT "member_subteams_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_subteams" ADD CONSTRAINT "member_subteams_subteam_id_subteams_id_fk" FOREIGN KEY ("subteam_id") REFERENCES "public"."subteams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_subteams_subteam" ON "member_subteams" USING btree ("subteam_id");--> statement-breakpoint
ALTER TABLE "subteams" ADD CONSTRAINT "subteams_parent_id_subteams_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."subteams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Written by hand: the one subteam a person had goes in as their first.
INSERT INTO "member_subteams" ("member_id", "subteam_id") SELECT "id", "subteam_id" FROM "members" WHERE "subteam_id" IS NOT NULL ON CONFLICT DO NOTHING;
