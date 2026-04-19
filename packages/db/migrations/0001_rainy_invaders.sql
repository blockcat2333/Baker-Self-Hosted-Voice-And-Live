CREATE TYPE "public"."voice_quality" AS ENUM('standard', 'high');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "server_settings" (
	"admin_password_hash" text NOT NULL,
	"allow_public_registration" boolean DEFAULT true NOT NULL,
	"app_port" integer DEFAULT 5174 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"server_name" text DEFAULT 'Baker' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"web_enabled" boolean DEFAULT true NOT NULL,
	"web_port" integer DEFAULT 80 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "voice_quality" "voice_quality" DEFAULT 'standard' NOT NULL;