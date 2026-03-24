import { z } from "zod";
import type { Vapi } from "@vapi-ai/server-sdk";
import type { VapiWebhookEnvelope } from "@/lib/shared/types";

export type SupportedVapiMessage =
  | Vapi.ServerMessageAssistantRequest
  | Vapi.ServerMessageToolCalls
  | Vapi.ServerMessageStatusUpdate
  | Vapi.ServerMessageTranscript
  | Vapi.ServerMessageSpeechUpdate
  | Vapi.ServerMessageEndOfCallReport;

const minimalWebhookSchema = z.object({
  message: z
    .object({
      type: z.string(),
    })
    .passthrough(),
});

export function parseWebhookEnvelope(rawBody: string): VapiWebhookEnvelope {
  const parsed = JSON.parse(rawBody) as unknown;
  return minimalWebhookSchema.parse(parsed) as VapiWebhookEnvelope;
}

export function isSupportedMessageType(type: string): boolean {
  return [
    "assistant-request",
    "tool-calls",
    "status-update",
    "transcript",
    "speech-update",
    "end-of-call-report",
  ].includes(type);
}
