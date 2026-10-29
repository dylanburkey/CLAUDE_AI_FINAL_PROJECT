/**
 * Tests for the retry, timeout, error formatting, and rate limiting utilities
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { RateLimiter, withRateLimit } from '../src/utils/rate-limiter.js';
import { ReviewError, ErrorCodes, withRetry, withTimeout, formatError } from '../src/utils/error-handler.js';

describe('withRetry', () => {
  it('should return the first successful result', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValueOnce('ok');

    await expect(withRetry(fn, 3, 1)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw RETRY_EXHAUSTED after maxRetries attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('down'));

    const error = await withRetry(fn, 3, 1).catch(e => e);

    expect(fn).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(ReviewError);
    expect(error.code).toBe(ErrorCodes.RETRY_EXHAUSTED);
    expect(error.message).toContain('down');
  });

  it('should back off exponentially', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error('down'));

    const promise = withRetry(fn, 3, 1000).catch(e => e);
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(fn).toHaveBeenCalledTimes(2);
    // Second delay is 2000ms, so 1100ms later it hasn't retried yet
    await vi.advanceTimersByTimeAsync(1100);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(3);
    await promise;
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

describe('withTimeout', () => {
  it('should resolve when the function finishes first', async () => {
    await expect(withTimeout(async () => 42, 100)).resolves.toBe(42);
  });

  it('should reject with AGENT_TIMEOUT when time runs out', async () => {
    const error = await withTimeout(() => new Promise(() => {}), 10, 'too slow').catch(e => e);

    expect(error).toBeInstanceOf(ReviewError);
    expect(error.code).toBe(ErrorCodes.AGENT_TIMEOUT);
    expect(error.metadata).toEqual({ timeoutMs: 10 });
    expect(formatError(error)).toBe('[AGENT_TIMEOUT] too slow');
  });
});

describe('RateLimiter', () => {
  it('should track requests and tokens in the window', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 10, maxTokensPerMinute: 5000 });

    await limiter.acquire(1000);
    limiter.release(1500);

    expect(limiter.getStatus()).toMatchObject({
      activeRequests: 0,
      requestsInWindow: 1,
      tokensInWindow: 1500,
      availableRequests: 9,
      availableTokens: 3500
    });
  });

  it('should refuse requests over the token budget', async () => {
    const limiter = new RateLimiter({ maxTokensPerMinute: 2000 });

    await limiter.acquire(1500);
    limiter.release();

    expect(limiter.canProceed(400)).toBe(true);
    expect(limiter.canProceed(600)).toBe(false);
  });

  it('should limit concurrent requests', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 2 });
    let active = 0;
    let peak = 0;

    const task = () => withRateLimit(limiter, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
    }, 10);

    await Promise.all(Array.from({ length: 6 }, task));

    expect(peak).toBe(2);
    expect(limiter.getStatus().requestsInWindow).toBe(6);
  });

  it('should wait for the window to slide when the request limit is hit', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ maxRequestsPerMinute: 1 });

    await limiter.acquire(10);
    limiter.release();

    let acquired = false;
    const pending = limiter.acquire(10).then(() => { acquired = true; });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(acquired).toBe(false);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(acquired).toBe(true);
    await pending;
    vi.useRealTimers();
  });
});
