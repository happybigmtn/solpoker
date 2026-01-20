/**
 * Vitest setup file.
 *
 * Imports jest-dom matchers for DOM assertions.
 */

import '@testing-library/jest-dom/vitest';

// Mock requestAnimationFrame for jsdom - executes callback immediately
// This ensures focus management and other RAF-based code works in tests
if (typeof requestAnimationFrame === 'undefined') {
  global.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    return setTimeout(() => callback(Date.now()), 0) as unknown as number;
  };
  global.cancelAnimationFrame = (id: number): void => {
    clearTimeout(id);
  };
}
