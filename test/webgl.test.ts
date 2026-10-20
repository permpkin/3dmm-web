// createRenderer's context probe: when the browser can't produce a WebGL
// context the factory must throw WebGLUnavailableError (not THREE's generic
// 'Error creating WebGL context.') — that's the failure main.ts catches to
// show bootView.fail() instead of hanging on the splash.
import { test, expect, beforeAll, afterAll } from 'vitest';
import { createRenderer, WebGLUnavailableError } from '../src/render/renderer.ts';

const realDoc = (globalThis as any).document;

beforeAll(() => {
  (globalThis as any).document = { createElement: () => ({ getContext: () => null }) };
});
afterAll(() => { (globalThis as any).document = realDoc; });

test('createRenderer throws WebGLUnavailableError when no WebGL context is available', () => {
  expect(() => createRenderer({} as any, new Uint8Array(0))).toThrow(WebGLUnavailableError);
});
