import test from 'node:test';
import assert from 'node:assert/strict';
import { explainError, parseRetrySeconds } from '../src/errors.mjs';

// الرسالة الحقيقية اللي رجّعها TRELLIS.2 أثناء الاختبار
const REAL = 'You have exceeded your ZeroGPU quota (120s requested vs. 159s left). Try again in 23:54:13. Authenticate with a Hugging Face token for more quota';

test('parses real ZeroGPU quota error', () => {
  assert.equal(parseRetrySeconds(REAL), 23 * 3600 + 54 * 60 + 13);
  const e = explainError(new Error(REAL));
  assert.equal(e.kind, 'quota');
  assert.equal(e.requested, 120);
  assert.equal(e.left, 159);
  assert.ok(e.canFallback);
  assert.ok(e.retryAt > Date.now() + 23 * 3600e3);
  assert.match(e.detail, /23 ساعة/);
  assert.match(e.detail, /توكن/);
});

test('other error kinds', () => {
  assert.equal(explainError({ message: 'No GPU was available after 60s' }).kind, 'busy');
  assert.equal(explainError('GPU task aborted').kind, 'timeout');
  assert.equal(explainError(new Error('fetch failed')).kind, 'network');
  assert.equal(explainError(new Error('Space is sleeping')).kind, 'sleeping');
  assert.equal(explainError(new Error('weird')).kind, 'unknown');
});
