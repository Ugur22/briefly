import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { FastifyBaseLogger } from 'fastify';
import { ModelReview } from '../domain/review';
import { parseJson, reviewRequest, SYSTEM } from './review-prompt';
import type { ReviewGenerator } from '../application/generate-review';

export const REVIEW_MODEL = 'claude-opus-5-5';

// `fetch` is for tests: they answer with canned API responses, so CI never calls the real model.
export type ClaudeOptions = { apiKey: string; log: FastifyBaseLogger; timeoutMs?: number; fetch?: typeof fetch };

// Every failure becomes a code; nothing from the model (or the SDK error, which can quote it) is logged or thrown.
export function claudeReviewGenerator({ apiKey, log, timeoutMs = 50_000, fetch }: ClaudeOptions): ReviewGenerator {
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 0, ...(fetch ? { fetch } : {}) });

  return async ({ title, body }) => {
    const started = performance.now();
    try {
      // create(), not parse(): parse() throws on a refusal's empty text before stop_reason can be read.
      const response = await client.messages.create({
        model: REVIEW_MODEL,
        max_tokens: 16_000,
        system: SYSTEM,
        messages: [{ role: 'user', content: reviewRequest(title, body) }],
        output_config: { format: zodOutputFormat(ModelReview), effort: 'low' },
      });
      const meta = { model: response.model, stop: response.stop_reason, usage: response.usage, ms: Math.round(performance.now() - started) };
      if (response.stop_reason === 'refusal') {
        log.warn(meta, 'review refused by the model');
        return { ok: false, error: 'refused', model: REVIEW_MODEL };
      }
      const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
      const parsed = response.stop_reason === 'max_tokens' ? null : ModelReview.safeParse(parseJson(text));
      if (!parsed?.success) {
        log.warn(meta, 'review output incomplete or off-schema');
        return { ok: false, error: 'model_failed', model: REVIEW_MODEL };
      }
      log.info(meta, 'review generated');
      return { ok: true, review: parsed.data, model: REVIEW_MODEL };
    } catch (err) {
      const timedOut = err instanceof Anthropic.APIConnectionTimeoutError;
      const status = err instanceof Anthropic.APIError ? err.status : undefined;
      log.warn({ status, timedOut, ms: Math.round(performance.now() - started) }, 'review generation failed');
      return { ok: false, error: timedOut ? 'timeout' : 'model_failed', model: REVIEW_MODEL };
    }
  };
}

// The offline fallback (REVIEW_GENERATOR=fake): a fixed review, stored with model "fake" so the UI says so.
export const fakeReviewGenerator: ReviewGenerator = async () => ({
  ok: true,
  model: 'fake',
  review: {
    summary: 'Canned review from the offline fallback generator, not from a model.',
    areas: {
      objective: { status: 'present', note: 'Fallback review: not assessed.' },
      audience: { status: 'unclear', note: 'Fallback review: not assessed.' },
      budget: { status: 'present', note: 'Fallback review: not assessed.' },
      timing: { status: 'missing', note: 'Fallback review: not assessed.' },
      channels: { status: 'present', note: 'Fallback review: not assessed.' },
      kpis: { status: 'unclear', note: 'Fallback review: not assessed.' },
      deliverables: { status: 'missing', note: 'Fallback review: not assessed.' },
    },
    questions: ['Fallback review: generate with the real model for actual questions.'],
    risks: [],
  },
});
