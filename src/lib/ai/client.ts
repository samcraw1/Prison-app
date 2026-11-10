import "server-only";
import { createGateway, type GatewayProviderOptions } from "@ai-sdk/gateway";

// All model calls go through Vercel AI Gateway, server-side only. See docs/AI.md.
//
// AI_MODEL has no default on purpose: the owner picks and confirms the exact model id from the gateway model list
// (for example `anthropic/claude-haiku-5.5`). AI_API_BASE exists for tests (tests/integration/fake-llm.ts).

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_MODEL && (process.env.AI_GATEWAY_API_KEY || process.env.AI_API_BASE));
}

// Message bodies (translation, review assist) may only be sent once the owner has confirmed zero data retention
// with both the gateway and the model provider, and set AI_ALLOW_MESSAGE_CONTENT=true.
export function messageContentAllowed(): boolean {
  return aiConfigured() && process.env.AI_ALLOW_MESSAGE_CONTENT === "true";
}

export function aiModel() {
  const model = process.env.AI_MODEL;
  if (!model) throw new Error("AI_MODEL is not set");
  const gateway = createGateway({
    ...(process.env.AI_API_BASE ? { baseURL: process.env.AI_API_BASE } : {}),
    apiKey: process.env.AI_GATEWAY_API_KEY ?? "test",
  });
  return gateway(model);
}

// Every request: only providers with zero-data-retention and no-training agreements. Fails closed if none are
// available for the model rather than routing elsewhere.
export const aiProviderOptions = {
  gateway: { zeroDataRetention: true, disallowPromptTraining: true } satisfies GatewayProviderOptions,
};
