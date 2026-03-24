import {
  asc,
  desc,
  eq,
  sql,
} from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { AppDatabase } from "@/lib/server/db/client";
import {
  callEvents,
  callSessions,
  operatorActions,
  trapAttempts,
  verdictSnapshots,
  webhookDeliveries,
} from "@/lib/server/db/schema";
import { createId } from "@/lib/server/ids";

export type CallSessionRecord = InferSelectModel<typeof callSessions>;
export type CallEventRecord = InferSelectModel<typeof callEvents>;
export type TrapAttemptRecord = InferSelectModel<typeof trapAttempts>;
export type VerdictSnapshotRecord = InferSelectModel<typeof verdictSnapshots>;
export type OperatorActionRecord = InferSelectModel<typeof operatorActions>;
export type WebhookDeliveryRecord = InferSelectModel<typeof webhookDeliveries>;

type SessionInsert = InferInsertModel<typeof callSessions>;
type SessionUpdate = Partial<Omit<SessionInsert, "id">>;

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

export async function createSession(
  db: AppDatabase,
  values: SessionInsert
): Promise<CallSessionRecord> {
  const [session] = await db.insert(callSessions).values(values).returning();
  return session;
}

export async function findSessionById(
  db: AppDatabase,
  sessionId: string
): Promise<CallSessionRecord | null> {
  const [session] = await db
    .select()
    .from(callSessions)
    .where(eq(callSessions.id, sessionId))
    .limit(1);

  return session ?? null;
}

export async function findSessionByExternalCallId(
  db: AppDatabase,
  externalCallId: string
): Promise<CallSessionRecord | null> {
  const [session] = await db
    .select()
    .from(callSessions)
    .where(eq(callSessions.externalCallId, externalCallId))
    .limit(1);

  return session ?? null;
}

export async function ensureSession(
  db: AppDatabase,
  input: SessionInsert
): Promise<CallSessionRecord> {
  const externalCallId = input.externalCallId ?? null;
  const updateValues = compactRecord({
    ...input,
    updatedAt: new Date(),
  });

  if (externalCallId) {
    const [session] = await db
      .insert(callSessions)
      .values(input)
      .onConflictDoUpdate({
        target: callSessions.externalCallId,
        set: updateValues,
      })
      .returning();

    return session;
  }

  const [session] = await db
    .insert(callSessions)
    .values(input)
    .onConflictDoUpdate({
      target: callSessions.id,
      set: updateValues,
    })
    .returning();

  return session;
}

export async function updateSession(
  db: AppDatabase,
  sessionId: string,
  values: SessionUpdate
): Promise<CallSessionRecord> {
  const [session] = await db
    .update(callSessions)
    .set({
      ...compactRecord(values),
      updatedAt: new Date(),
    })
    .where(eq(callSessions.id, sessionId))
    .returning();

  return session;
}

export async function appendCallEvent(
  db: AppDatabase,
  values: InferInsertModel<typeof callEvents>
): Promise<CallEventRecord> {
  const [event] = await db.insert(callEvents).values(values).returning();
  return event;
}

export async function createTrapAttempt(
  db: AppDatabase,
  values: InferInsertModel<typeof trapAttempts>
): Promise<TrapAttemptRecord> {
  const [attempt] = await db.insert(trapAttempts).values(values).returning();
  return attempt;
}

export async function createVerdictSnapshot(
  db: AppDatabase,
  values: InferInsertModel<typeof verdictSnapshots>
): Promise<VerdictSnapshotRecord> {
  const [snapshot] = await db
    .insert(verdictSnapshots)
    .values(values)
    .returning();

  return snapshot;
}

export async function recordOperatorAction(
  db: AppDatabase,
  values: InferInsertModel<typeof operatorActions>
): Promise<OperatorActionRecord> {
  const [action] = await db.insert(operatorActions).values(values).returning();
  return action;
}

export async function registerWebhookDelivery(
  db: AppDatabase,
  input: Omit<InferInsertModel<typeof webhookDeliveries>, "id"> & {
    id?: string;
  }
): Promise<{ duplicate: boolean; delivery: WebhookDeliveryRecord }> {
  const deliveryId = input.id ?? createId("wh");
  const [inserted] = await db
    .insert(webhookDeliveries)
    .values({
      ...input,
      id: deliveryId,
    })
    .onConflictDoNothing({
      target: webhookDeliveries.dedupeKey,
    })
    .returning();

  if (inserted) {
    return {
      duplicate: false,
      delivery: inserted,
    };
  }

  const [delivery] = await db
    .update(webhookDeliveries)
    .set({
      duplicateCount: sql`${webhookDeliveries.duplicateCount} + 1`,
      lastSeenAt: new Date(),
    })
    .where(eq(webhookDeliveries.dedupeKey, input.dedupeKey))
    .returning();

  return {
    duplicate: true,
    delivery,
  };
}

export async function markWebhookDeliveryProcessed(
  db: AppDatabase,
  deliveryId: string
): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({
      processedAt: new Date(),
      lastSeenAt: new Date(),
    })
    .where(eq(webhookDeliveries.id, deliveryId));
}

export async function getReplay(
  db: AppDatabase,
  sessionId: string
): Promise<{
  session: CallSessionRecord | null;
  events: CallEventRecord[];
  trapAttempts: TrapAttemptRecord[];
  verdictSnapshots: VerdictSnapshotRecord[];
  operatorActions: OperatorActionRecord[];
}> {
  const session = await findSessionById(db, sessionId);

  const [events, attempts, snapshots, actions] = await Promise.all([
    db
      .select()
      .from(callEvents)
      .where(eq(callEvents.callSessionId, sessionId))
      .orderBy(asc(callEvents.createdAt)),
    db
      .select()
      .from(trapAttempts)
      .where(eq(trapAttempts.callSessionId, sessionId))
      .orderBy(asc(trapAttempts.createdAt)),
    db
      .select()
      .from(verdictSnapshots)
      .where(eq(verdictSnapshots.callSessionId, sessionId))
      .orderBy(asc(verdictSnapshots.createdAt)),
    db
      .select()
      .from(operatorActions)
      .where(eq(operatorActions.callSessionId, sessionId))
      .orderBy(asc(operatorActions.createdAt)),
  ]);

  return {
    session,
    events,
    trapAttempts: attempts,
    verdictSnapshots: snapshots,
    operatorActions: actions,
  };
}

export async function getLatestTrapAttempt(
  db: AppDatabase,
  sessionId: string
): Promise<TrapAttemptRecord | null> {
  const [attempt] = await db
    .select()
    .from(trapAttempts)
    .where(eq(trapAttempts.callSessionId, sessionId))
    .orderBy(desc(trapAttempts.createdAt))
    .limit(1);

  return attempt ?? null;
}
