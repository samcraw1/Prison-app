import "server-only";
import { createGateway, type GatewayProviderOptions } from "@ai-sdk/gateway";

// All model calls go through Vercel AI Gateway, server-side only. See docs/AI.md.
//
// Auth: AI_GATEWAY_API_KEY if set; otherwise, on Vercel deployments, the project's OIDC token (no key to manage).
// AI_MODEL has no default on purpose: the owner picks and confirms the exact model id from the gateway model list
// (for example `anthropic/claude-haiku-5.5`). AI_API_BASE exists for tests (tests/integration/fake-llm.ts).

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_MODEL && (process.env.AI_GATEWAY_API_KEY || process.env.AI_API_BASE || process.env.VERCEL));
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
    ...(process.env.AI_GATEWAY_API_KEY ? { apiKey: process.env.AI_GATEWAY_API_KEY } : {}),
  });
  return gateway(model);
}

// Help bot: no message content is ever sent, only the FAQ, facility policies and what the family types. Routed only
// to providers that don't train on prompts. Zero data retention is not required here (it needs a Vercel Pro plan;
// owner decision, docs/AI.md).
export const helpProviderOptions = {
  gateway: { disallowPromptTraining: true } satisfies GatewayProviderOptions,
};

// Anything that sends message content (translation, review assist): zero data retention AND no training. Fails
// closed if no provider meets both, rather than routing elsewhere.
export const messageContentProviderOptions = {
  gateway: { zeroDataRetention: true, disallowPromptTraining: true } satisfies GatewayProviderOptions,
};
