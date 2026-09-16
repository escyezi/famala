import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { mockApi, mockTurnstile, unexpectedRequests } from './helpers.ts';

// jsdom does not implement the browser's modal top layer/focus management.
// These fallbacks only expose the dialog's open state to DOM assertions.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
}
if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // Single-tab storage behavior only; lock contention is covered in storage.test.mjs.
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: vi.fn(async (_name: string, callback: () => unknown) => callback()) },
  });
  mockApi({});
  mockTurnstile();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(unexpectedRequests, 'Every component request must have an explicit mock').toEqual([]);
});
