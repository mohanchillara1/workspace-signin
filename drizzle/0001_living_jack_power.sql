CREATE TABLE "ended_sessions" (
	"sid" text PRIMARY KEY NOT NULL,
	"ended_at" timestamp with time zone DEFAULT now() NOT NULL
);
