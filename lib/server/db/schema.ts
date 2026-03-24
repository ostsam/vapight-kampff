import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  CALL_MODES,
  CALL_PHASES,
  CALL_TRANSPORTS,
  VERDICT_STATES,
  VOICE_MODES,
} from "@/lib/shared/types";

export const callModeEnum = pgEnum("call_mode", CALL_MODES);
export const callTransportEnum = pgEnum("call_transport", CALL_TRANSPORTS);
export const callPhaseEnum = pgEnum("call_phase", CALL_PHASES);
export const verdictStateEnum = pgEnum("verdict_state", VERDICT_STATES);
export const voiceModeEnum = pgEnum("voice_mode", VOICE_MODES);

export const callSessions = pgTable(
  "call_sessions",
  {
    id: text("id").primaryKey(),
    externalCallId: text("external_call_id").unique(),
    externalProviderCallId: text("external_provider_call_id"),
    mode: callModeEnum("mode").notNull(),
    transport: callTransportEnum("transport").notNull(),
    status: text("status").notNull().default("created"),
    sourceNumber: text("source_number"),
    destinationNumber: text("destination_number"),
    label: text("label"),
    assistantId: text("assistant_id"),
    workflowId: text("workflow_id"),
    currentPhase: callPhaseEnum("current_phase").notNull().default("hook"),
    currentTrapId: text("current_trap_id"),
    currentVoiceMode: voiceModeEnum("current_voice_mode")
      .notNull()
      .default("calm_operator"),
    currentVerdict: verdictStateEnum("current_verdict")
      .notNull()
      .default("unclear"),
    operatorOverrideTarget: text("operator_override_target"),
    humanScore: integer("human_score").notNull().default(0),
    aiScore: integer("ai_score").notNull().default(0),
    transferred: boolean("transferred").notNull().default(false),
    transferFailed: boolean("transfer_failed").notNull().default(false),
    controlUrl: text("control_url"),
    listenUrl: text("listen_url"),
    recordingUrl: text("recording_url"),
    summary: text("summary"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("call_sessions_external_call_id_idx").on(table.externalCallId),
    index("call_sessions_mode_status_idx").on(table.mode, table.status),
    index("call_sessions_started_at_idx").on(table.startedAt),
  ]
);

export const callEvents = pgTable(
  "call_events",
  {
    id: text("id").primaryKey(),
    callSessionId: text("call_session_id")
      .notNull()
      .references(() => callSessions.id, { onDelete: "cascade" }),
    externalCallId: text("external_call_id"),
    eventType: text("event_type").notNull(),
    speaker: text("speaker"),
    transcriptType: text("transcript_type"),
    transcript: text("transcript"),
    turn: integer("turn"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("call_events_session_idx").on(table.callSessionId, table.createdAt),
    index("call_events_type_idx").on(table.eventType),
  ]
);

export const trapAttempts = pgTable(
  "trap_attempts",
  {
    id: text("id").primaryKey(),
    callSessionId: text("call_session_id")
      .notNull()
      .references(() => callSessions.id, { onDelete: "cascade" }),
    trapId: text("trap_id").notNull(),
    phase: callPhaseEnum("phase").notNull(),
    voiceMode: voiceModeEnum("voice_mode").notNull(),
    prompt: text("prompt").notNull(),
    outcome: text("outcome"),
    humanScoreDelta: integer("human_score_delta").notNull().default(0),
    aiScoreDelta: integer("ai_score_delta").notNull().default(0),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("trap_attempts_session_idx").on(table.callSessionId, table.createdAt)]
);

export const verdictSnapshots = pgTable(
  "verdict_snapshots",
  {
    id: text("id").primaryKey(),
    callSessionId: text("call_session_id")
      .notNull()
      .references(() => callSessions.id, { onDelete: "cascade" }),
    humanScore: integer("human_score").notNull(),
    aiScore: integer("ai_score").notNull(),
    state: verdictStateEnum("state").notNull(),
    rationale: text("rationale").notNull(),
    source: text("source").notNull().default("heuristic"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("verdict_snapshots_session_idx").on(table.callSessionId, table.createdAt),
  ]
);

export const operatorActions = pgTable(
  "operator_actions",
  {
    id: text("id").primaryKey(),
    callSessionId: text("call_session_id")
      .notNull()
      .references(() => callSessions.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    requestedBy: text("requested_by").notNull(),
    status: text("status").notNull(),
    resultSummary: text("result_summary"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("operator_actions_session_idx").on(table.callSessionId, table.createdAt),
  ]
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    dedupeKey: text("dedupe_key").notNull(),
    externalCallId: text("external_call_id"),
    messageType: text("message_type").notNull(),
    payloadHash: text("payload_hash").notNull(),
    rawBody: text("raw_body").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("webhook_deliveries_dedupe_key_idx").on(table.dedupeKey),
    index("webhook_deliveries_call_idx").on(table.externalCallId, table.receivedAt),
  ]
);
