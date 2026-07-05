/**
 * Route-presence gate for sidebar nav rows: rows must only render for pages
 * that exist in this build (the open-core carve omits the enterprise pages).
 * Asserts the mechanism, not a fixed page list, so the same test passes in
 * builds that do ship the extra pages.
 */
import { describe, it, expect } from 'vitest';
import { hasAppRoute } from './app-routes';

describe('hasAppRoute', () => {
  it('finds pages that ship in every build', () => {
    expect(hasAppRoute('content')).toBe(true);
    expect(hasAppRoute('flows')).toBe(true);
    expect(hasAppRoute('requests')).toBe(true);
  });

  it('is false for pages this build does not contain', () => {
    expect(hasAppRoute('definitely-not-a-page')).toBe(false);
  });
});
