import { VapiClient, type Vapi } from "@vapi-ai/server-sdk";
import { getEnv } from "@/lib/server/env";

let cachedClient: VapiClient | null = null;

export function getVapiClient(): VapiClient {
  if (!cachedClient) {
    cachedClient = new VapiClient({
      token: getEnv().VAPI_API_KEY,
    });
  }

  return cachedClient;
}

export function setVapiClientForTesting(client: VapiClient | null): void {
  cachedClient = client;
}

export async function createOutboundDemoCall(input: {
  sessionId: string;
  targetNumber: string;
  label: string | null;
}): Promise<Vapi.Call> {
  const env = getEnv();
  const response = await getVapiClient().calls.create({
    workflowId: env.VAPI_WORKFLOW_ID_PRODUCTION,
    phoneNumberId: env.VAPI_PHONE_NUMBER_ID,
    customer: {
      number: input.targetNumber,
    },
    name: input.label ?? `Voight-Kampff demo ${input.sessionId}`,
    workflowOverrides: {
      variableValues: {
        sessionId: input.sessionId,
        label: input.label,
        mode: "demo",
        transport: "pstn",
      },
    },
  });

  if (!("id" in response)) {
    throw new Error("Expected Vapi to return a single call response.");
  }

  return response;
}

export async function sendControlMessage(
  controlUrl: string,
  message: Vapi.ClientInboundMessage
): Promise<void> {
  const env = getEnv();
  const response = await fetch(controlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.NEXT_PUBLIC_VAPI_PUBLIC_KEY}`,
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    throw new Error(`Vapi control request failed with status ${response.status}.`);
  }
}
