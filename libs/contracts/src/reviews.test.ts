import { describe, expect, it } from 'vitest';
import { REVIEW_AREAS, Review } from './reviews';

const area = { status: 'present', note: 'Clear.' } as const;
const review = {
  summary: 'Solid brief.',
  areas: Object.fromEntries(REVIEW_AREAS.map((a) => [a, area])),
  questions: ['What is the launch date?'],
  risks: [],
};

describe('Review', () => {
  it('accepts a review covering all seven areas', () => {
    expect(Review.safeParse(review).success).toBe(true);
  });

  it('rejects a review missing an area', () => {
    const sixAreas = Object.fromEntries(REVIEW_AREAS.filter((a) => a !== 'budget').map((a) => [a, area]));
    expect(Review.safeParse({ ...review, areas: sixAreas }).success).toBe(false);
  });

  it('rejects more than ten questions', () => {
    expect(Review.safeParse({ ...review, questions: Array(11).fill('q') }).success).toBe(false);
  });
});
