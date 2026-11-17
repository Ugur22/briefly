import type { FastifyBaseLogger } from 'fastify';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { ModelReview } from '../domain/review';
import type { ReviewGenerator } from '../application/generate-review';
import { parseJson, reviewRequest, SYSTEM } from './review-prompt';

// `fetch` is for tests: they answer with canned API responses, so CI never calls the real model.
export type OpenAIOptions = { apiKey: string; model: string; log: FastifyBaseLogger; timeoutMs?: number; fetch?: typeof fetch };

// The same port, prompt and rules as the Claude adapter: structured output, every failure a code, nothing
// from the model (or an SDK error that could quote it) logged or thrown.
export function openAIReviewGenerator({ apiKey, model, log, timeoutMs = 50_000, fetch }: OpenAIOptions): ReviewGenerator {
  const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0, ...(fetch ? { fetch } : {}) });

  return async ({ title, body }) => {
    const started = performance.now();
    try {
      // create(), not parse(): a refusal or a cut-off answer must be read before any JSON parsing.
      const response = await client.responses.create({
        model,
        instructions: SYSTEM,
        input: reviewRequest(title, body),
        max_output_tokens: 16_000,
        text: { format: zodTextFormat(ModelReview, 'brief_review') },
        // Don't let OpenAI keep the request (the client's brief) on its side; the default stores it for 30 days.
        store: false,
      });
      const meta = { model: response.model, status: response.status, usage: response.usage, ms: Math.round(performance.now() - started) };

      const refused = response.output.some((item) => item.type === 'message' && item.content.some((part) => part.type === 'refusal'));
      if (refused || response.incomplete_details?.reason === 'content_filter') {
        log.warn(meta, 'review refused by the model');
        return { ok: false, error: 'refused', model };
      }
      const parsed = response.status === 'completed' ? ModelReview.safeParse(parseJson(response.output_text)) : null;
      if (!parsed?.success) {
        log.warn({ ...meta, incomplete: response.incomplete_details?.reason }, 'review output incomplete or off-schema');
        return { ok: false, error: 'model_failed', model };
      }
      log.info(meta, 'review generated');
      return { ok: true, review: parsed.data, model };
    } catch (err) {
      const timedOut = err instanceof OpenAI.APIConnectionTimeoutError;
      const status = err instanceof OpenAI.APIError ? err.status : undefined;
      log.warn({ status, timedOut, ms: Math.round(performance.now() - started) }, 'review generation failed');
      return { ok: false, error: timedOut ? 'timeout' : 'model_failed', model };
    }
  };
}
