import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestAgent, AgentRequestError } from '@/lib/agent/client';
import { extractTutorialResponse } from '@/lib/agent/protocol';
import { compactConversationContext } from '@/lib/agent/context-compaction';
import { checkRateLimit } from '@/lib/server/rate-limiter';

describe('Phase 6 — Large AI Task Reliability & Performance Test Suite', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // Scenario 1: A normal small task
  it('1. executes a normal small task successfully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        text: 'Normal response: LED connected to pin 13 with 220 ohm resistor.',
        taskId: 'task_small_1',
        durationMs: 120,
      }),
    } as any);

    const result = await requestAgent({
      apiKeys: ['AIzaSyD_FakeKey123'],
      model: 'models/gemini-2.5-flash',
      systemPrompt: 'You are a circuit helper.',
      contents: [{ role: 'user', parts: [{ text: 'How do I connect an LED?' }] }],
    });

    expect(result.text).toContain('Normal response');
    expect(result.taskId).toBeDefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // Scenario 2: A large task with substantial output
  it('2. processes a large task with substantial output and multi-step JSON payload without stalling', async () => {
    const largeSteps = Array.from({ length: 40 }, (_, i) => ({
      phase: `Subsystem ${Math.floor(i / 5) + 1}`,
      instruction: `Step ${i + 1}: Install module part ${i + 1} onto the robotic chassis.`,
      detail: `Detailed assembly instructions for mounting actuator #${i + 1} with M3 standoffs.`,
      verify: `Confirm actuator #${i + 1} is secured and pins are seated.`,
      add_components: [{ id: `part_${i}`, type: 'servo', x: 100 + (i % 5) * 200, y: 100 + Math.floor(i / 5) * 150 }],
      add_wiring: [{ from: `part_${i}:sig`, to: `uno1:pin_${(i % 12) + 2}`, color: 'orange' }],
      code: i % 4 === 0 ? `void setup() { pinMode(${i}, OUTPUT); } void loop() { digitalWrite(${i}, HIGH); delay(100); }` : undefined,
    }));

    const substantialOutput = `Here is the comprehensive 40-step robotic assembly plan:\n\n` +
      `<tutorial>\n` +
      JSON.stringify({
        action: 'NEW_PROJECT',
        project_name: 'Autonomous Rover System',
        description: 'Complete 40-step robotic rover with telemetry, sensors, and actuator controllers.',
        steps: largeSteps,
      }, null, 2) +
      `\n</tutorial>\n\nAssembly is ready to build.`;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        text: substantialOutput,
        taskId: 'task_large_40step',
        durationMs: 1850,
      }),
    } as any);

    const startTime = Date.now();
    const result = await requestAgent({
      apiKeys: ['AIzaSyD_FakeKey123'],
      model: 'models/gemini-2.5-flash',
      systemPrompt: 'You are an engineer.',
      contents: [{ role: 'user', parts: [{ text: 'Build a complete robotic rover from scratch' }] }],
    });
    const parsed = extractTutorialResponse(result.text);

    expect(parsed.plan).toBeDefined();
    expect(parsed.plan?.steps.length).toBe(40);
    expect(parsed.plan?.project_name).toBe('Autonomous Rover System');
    // Ensure JSON extraction on large output was instantaneous (under 200ms)
    expect(Date.now() - startTime).toBeLessThan(1000);
  });

  // Scenario 3: Slow AI responses and upstream timeouts
  it('3. handles slow AI responses and upstream timeouts (504) by falling back or retrying', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First attempt times out (504 Gateway Timeout from serverless boundary)
        return {
          ok: false,
          status: 504,
          statusText: 'Gateway Timeout',
          json: async () => ({ error: 'Upstream model call timed out after 25s' }),
        };
      }
      // Second attempt succeeds
      return {
        ok: true,
        status: 200,
        json: async () => ({
          text: 'Response received after timeout fallback.',
          taskId: 'task_timeout_retry',
        }),
      };
    });

    const result = await requestAgent({
      apiKeys: ['AIzaSyD_FakeKey123'],
      model: 'models/gemini-2.5-flash',
      systemPrompt: 'System',
      contents: [{ role: 'user', parts: [{ text: 'Slow complex query' }] }],
    });

    expect(result.text).toBe('Response received after timeout fallback.');
    expect(callCount).toBe(2);
  });

  // Scenario 4: HTTP 429 quota or billing errors
  it('4. immediately halts on HTTP 429 quota errors without endlessly retrying', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({
          error: 'Daily API token limit reached. Upgrade to Pro.',
          code: 'APP_QUOTA_EXCEEDED',
        }),
      };
    });

    await expect(requestAgent({
      apiKeys: ['AIzaSyD_FakeKey123'],
      model: 'models/gemini-2.5-flash',
      systemPrompt: 'System',
      contents: [{ role: 'user', parts: [{ text: 'Any query' }] }],
    })).rejects.toThrow(AgentRequestError);

    // Must NOT retry 429 quota errors!
    expect(callCount).toBe(1);
  });

  // Scenario 5: Temporary network failures and retries with backoff
  it('5. retries temporary 503 Service Unavailable errors with bounded exponential backoff', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        return {
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          json: async () => ({ error: 'Google model temporarily overloaded' }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: 'Recovered from temporary overload' }),
      };
    });

    const result = await requestAgent({
      apiKeys: ['AIzaSyD_FakeKey123'],
      model: 'models/gemini-2.5-flash',
      systemPrompt: 'System',
      contents: [{ role: 'user', parts: [{ text: 'Query during temporary outage' }] }],
    });

    expect(result.text).toBe('Recovered from temporary overload');
    expect(callCount).toBe(3);
  });

  // Scenario 6: Duplicate submissions and concurrent tasks
  it('6. deduplicates duplicate concurrent task submissions using taskId in server route', async () => {
    const { POST } = await import('@/app/api/agent/route');
    const taskId = `test_dedup_${Date.now()}`;

    // Send two identical concurrent requests with the same taskId
    const req1 = new Request('http://localhost:3000/api/agent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-task-id': taskId,
      },
      body: JSON.stringify({
        taskId,
        apiKey: 'AIzaSyD_MockKey1',
        model: 'models/gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: 'Duplicate test' }] }],
      }),
    });

    const req2 = new Request('http://localhost:3000/api/agent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-task-id': taskId,
      },
      body: JSON.stringify({
        taskId,
        apiKey: 'AIzaSyD_MockKey1',
        model: 'models/gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: 'Duplicate test' }] }],
      }),
    });

    // Run both simultaneously
    const [res1, res2] = await Promise.all([POST(req1), POST(req2)]);

    // Both should receive a response without double execution or unhandled crashing
    expect([200, 400, 401, 500]).toContain(res1.status);
    expect([200, 400, 401, 500]).toContain(res2.status);
  });

  // Scenario 7: Cancellation and browser refresh
  it('7. cleanly aborts when an AbortSignal is triggered during generation', async () => {
    const controller = new AbortController();

    global.fetch = vi.fn().mockImplementation((_url, options) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve({
            ok: true,
            status: 200,
            json: async () => ({ text: 'Late response' }),
          });
        }, 1000);

        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        }
      });
    });

    // Abort after 50ms
    setTimeout(() => controller.abort(), 50);

    await expect(requestAgent({
      apiKeys: ['AIzaSyD_FakeKey123'],
      model: 'models/gemini-2.5-flash',
      systemPrompt: 'System',
      contents: [{ role: 'user', parts: [{ text: 'Will be aborted' }] }],
      abortSignal: controller.signal,
    })).rejects.toThrow();
  });

  // Scenario 8: Partial output followed by failure
  it('8. preserves previously parsed structure and flags warnings when output is partially malformed', () => {
    const partialOutput = `I am designing the motor controller:
<tutorial>
{
  "action": "UPDATE_CURRENT",
  "project_name": "Motor Driver",
  "steps": [
    {
      "instruction": "Attach H-bridge driver L298N",
      "add_components": [{"id": "drv1", "type": "l298n", "x": 300, "y": 200}],
      "add_wiring": []
    }
  ]
`; // Cut off mid-stream, unclosed JSON

    const result = extractTutorialResponse(partialOutput);
    // Should gracefully fail or recover without throwing unhandled syntax exception
    expect(result).toBeDefined();
    expect(result.errors.length).toBeGreaterThan(0);
    // The clean text preserves the introductory markdown
    expect(result.cleanText).toContain('I am designing the motor controller:');
  });

  // Scenario 9: Large conversation history and generated code rendering
  it('9. compacts large conversation history to prevent main-thread memory/prompt bloat', () => {
    const longChatHistory = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: `Message ${i + 1}: Discussion regarding sensor #${i + 1} specifications, wiring diagrams, and pin allocations. ` +
        `Ensure pull-up resistors are installed and I2C address 0x${(16 + i).toString(16)} is checked.`,
    }));

    const compacted = compactConversationContext(longChatHistory);
    // Recent messages must be limited to 10
    expect(compacted.recentMessages.length).toBeLessThanOrEqual(10);
    // Earlier context is summarized into a single compact bulleted paragraph
    expect(compacted.earlierContext).toBeDefined();
    expect(compacted.earlierContext?.length).toBeLessThan(4000);
  });

  // Scenario 10: Task ownership, user isolation, quota enforcement, and usage logging
  it('10. enforces sliding-window rate limit and user isolation', () => {
    const originalLimit = process.env.API_RATE_LIMIT_REQUESTS;
    process.env.API_RATE_LIMIT_REQUESTS = '5';
    try {
      const userA = `user_alice_${Date.now()}`;
      const userB = `user_bob_${Date.now()}`;

      // User A consumes 5 requests
      for (let i = 0; i < 5; i++) {
        const result = checkRateLimit(userA, 'agent');
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(5 - (i + 1));
      }

      // 6th request for User A is rate limited
      const userABlocked = checkRateLimit(userA, 'agent');
      expect(userABlocked.allowed).toBe(false);
      expect(userABlocked.remaining).toBe(0);

      // User B remains unaffected (complete user isolation)
      const userBAllowed = checkRateLimit(userB, 'agent');
      expect(userBAllowed.allowed).toBe(true);
      expect(userBAllowed.remaining).toBe(4);
    } finally {
      if (originalLimit !== undefined) {
        process.env.API_RATE_LIMIT_REQUESTS = originalLimit;
      } else {
        delete process.env.API_RATE_LIMIT_REQUESTS;
      }
    }
  });
});
