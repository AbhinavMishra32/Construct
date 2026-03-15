import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { OpenAIStructuredLanguageModel } from "./agentService";

test("OpenAIStructuredLanguageModel falls back to JSON mode when structured output schema is incompatible", async () => {
  let structuredCalls = 0;
  let fallbackCalls = 0;

  const model = new OpenAIStructuredLanguageModel({
    apiKey: "test-key",
    model: "gpt-5-mini",
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
      trace() {}
    },
    client: {
      withStructuredOutput() {
        return {
          async invoke() {
            structuredCalls += 1;
            throw new Error(
              "Zod field at `#/properties/startLine` uses `.optional()` without `.nullable()` which is not supported by the API."
            );
          }
        };
      },
      async invoke() {
        fallbackCalls += 1;
        return {
          content: JSON.stringify({
            value: "recovered"
          })
        };
      }
    }
  });

  const parsed = await model.parse({
    schema: z.object({
      value: z.string().min(1)
    }),
    schemaName: "test_schema",
    instructions: "Return test data.",
    prompt: "Generate a payload."
  });

  assert.equal(parsed.value, "recovered");
  assert.equal(structuredCalls, 1);
  assert.equal(fallbackCalls, 1);
});

test("OpenAIStructuredLanguageModel forwards streaming tokens through callbacks", async () => {
  const streamedChunks: string[] = [];

  const model = new OpenAIStructuredLanguageModel({
    apiKey: "test-key",
    model: "gpt-5-mini",
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
      trace() {}
    },
    client: {
      withStructuredOutput() {
        return {
          async invoke(_messages, config) {
            const handler = (config?.callbacks?.[0] ?? null) as
              | { handleLLMNewToken?: (token: string) => void }
              | null;

            handler?.handleLLMNewToken?.("{");
            handler?.handleLLMNewToken?.("\"value\":\"streamed\"");
            handler?.handleLLMNewToken?.("}");

            return {
              value: "streamed"
            };
          }
        };
      },
      async invoke() {
        return {
          content: JSON.stringify({
            value: "unused"
          })
        };
      }
    }
  });

  const parsed = await model.parse({
    schema: z.object({
      value: z.string().min(1)
    }),
    schemaName: "test_stream_schema",
    instructions: "Return test data.",
    prompt: "Generate a payload.",
    stream: {
      stage: "plan-generation",
      label: "plan generation",
      onToken: (chunk) => {
        streamedChunks.push(chunk);
      }
    }
  });

  assert.equal(parsed.value, "streamed");
  assert.deepEqual(streamedChunks, ["{", "\"value\":\"streamed\"", "}"]);
});
