CREATE TABLE "search_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"api_key_mask" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"quota_remaining" integer,
	"last_status" text,
	"last_error" text,
	"last_used_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
