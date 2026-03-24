CREATE TYPE "public"."call_mode" AS ENUM('production', 'demo');--> statement-breakpoint
CREATE TYPE "public"."call_phase" AS ENUM('hook', 'baseline', 'shock', 'compression', 'resolution');--> statement-breakpoint
CREATE TYPE "public"."call_transport" AS ENUM('pstn', 'web');--> statement-breakpoint
CREATE TYPE "public"."verdict_state" AS ENUM('likely_human', 'likely_ai', 'unclear', 'operator_override');--> statement-breakpoint
CREATE TYPE "public"."voice_mode" AS ENUM('calm_operator', 'paranoid_whisper', 'aggressive_breaker');--> statement-breakpoint
CREATE TABLE "call_events" (
	"id" text PRIMARY KEY NOT NULL,
	"call_session_id" text NOT NULL,
	"external_call_id" text,
	"event_type" text NOT NULL,
	"speaker" text,
	"transcript_type" text,
	"transcript" text,
	"turn" integer,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"external_call_id" text,
	"external_provider_call_id" text,
	"mode" "call_mode" NOT NULL,
	"transport" "call_transport" NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"source_number" text,
	"destination_number" text,
	"label" text,
	"assistant_id" text,
	"workflow_id" text,
	"current_phase" "call_phase" DEFAULT 'hook' NOT NULL,
	"current_trap_id" text,
	"current_voice_mode" "voice_mode" DEFAULT 'calm_operator' NOT NULL,
	"current_verdict" "verdict_state" DEFAULT 'unclear' NOT NULL,
	"operator_override_target" text,
	"human_score" integer DEFAULT 0 NOT NULL,
	"ai_score" integer DEFAULT 0 NOT NULL,
	"transferred" boolean DEFAULT false NOT NULL,
	"transfer_failed" boolean DEFAULT false NOT NULL,
	"control_url" text,
	"listen_url" text,
	"recording_url" text,
	"summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_sessions_external_call_id_unique" UNIQUE("external_call_id")
);
--> statement-breakpoint
CREATE TABLE "operator_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"call_session_id" text NOT NULL,
	"action" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text NOT NULL,
	"result_summary" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trap_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"call_session_id" text NOT NULL,
	"trap_id" text NOT NULL,
	"phase" "call_phase" NOT NULL,
	"voice_mode" "voice_mode" NOT NULL,
	"prompt" text NOT NULL,
	"outcome" text,
	"human_score_delta" integer DEFAULT 0 NOT NULL,
	"ai_score_delta" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verdict_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"call_session_id" text NOT NULL,
	"human_score" integer NOT NULL,
	"ai_score" integer NOT NULL,
	"state" "verdict_state" NOT NULL,
	"rationale" text NOT NULL,
	"source" text DEFAULT 'heuristic' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"dedupe_key" text NOT NULL,
	"external_call_id" text,
	"message_type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"raw_body" text NOT NULL,
	"payload" jsonb NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_call_session_id_call_sessions_id_fk" FOREIGN KEY ("call_session_id") REFERENCES "public"."call_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_actions" ADD CONSTRAINT "operator_actions_call_session_id_call_sessions_id_fk" FOREIGN KEY ("call_session_id") REFERENCES "public"."call_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trap_attempts" ADD CONSTRAINT "trap_attempts_call_session_id_call_sessions_id_fk" FOREIGN KEY ("call_session_id") REFERENCES "public"."call_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdict_snapshots" ADD CONSTRAINT "verdict_snapshots_call_session_id_call_sessions_id_fk" FOREIGN KEY ("call_session_id") REFERENCES "public"."call_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_events_session_idx" ON "call_events" USING btree ("call_session_id","created_at");--> statement-breakpoint
CREATE INDEX "call_events_type_idx" ON "call_events" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "call_sessions_external_call_id_idx" ON "call_sessions" USING btree ("external_call_id");--> statement-breakpoint
CREATE INDEX "call_sessions_mode_status_idx" ON "call_sessions" USING btree ("mode","status");--> statement-breakpoint
CREATE INDEX "call_sessions_started_at_idx" ON "call_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "operator_actions_session_idx" ON "operator_actions" USING btree ("call_session_id","created_at");--> statement-breakpoint
CREATE INDEX "trap_attempts_session_idx" ON "trap_attempts" USING btree ("call_session_id","created_at");--> statement-breakpoint
CREATE INDEX "verdict_snapshots_session_idx" ON "verdict_snapshots" USING btree ("call_session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_dedupe_key_idx" ON "webhook_deliveries" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_call_idx" ON "webhook_deliveries" USING btree ("external_call_id","received_at");