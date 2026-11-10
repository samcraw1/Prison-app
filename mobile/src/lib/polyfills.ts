// Globals the AI SDK's streaming chat (Help screen) needs that Hermes doesn't provide.
// Per the AI SDK Expo guide (node_modules/ai/docs/02-getting-started/07-expo.mdx), set only when missing.
import { Platform } from "react-native";
import structuredClone from "@ungap/structured-clone";
import { TextDecoderStream, TextEncoderStream } from "@stardazed/streams-text-encoding";

if (Platform.OS !== "web") {
  const g = globalThis as Record<string, unknown>;
  if (!("structuredClone" in g)) g.structuredClone = structuredClone;
  if (!("TextEncoderStream" in g)) g.TextEncoderStream = TextEncoderStream;
  if (!("TextDecoderStream" in g)) g.TextDecoderStream = TextDecoderStream;
}

export {};
