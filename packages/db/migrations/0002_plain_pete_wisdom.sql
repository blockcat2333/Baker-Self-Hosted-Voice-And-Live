CREATE TYPE "public"."media_transport_mode" AS ENUM('p2p', 'sfu');--> statement-breakpoint
ALTER TABLE "server_settings" ADD COLUMN "media_mode" "media_transport_mode" DEFAULT 'p2p' NOT NULL;