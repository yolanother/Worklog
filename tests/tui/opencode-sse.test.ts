import { describe, it, expect } from 'vitest';
import { SseParser } from '../../src/tui/opencode-sse.js';

describe('SseParser', () => {
  it('parses a single data event', () => {
    const parser = new SseParser();
    const events = parser.push('data: {"type":"message"}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"type":"message"}');
  });

  it('joins multiline data fields', () => {
    const parser = new SseParser();
    expect(parser.push('data: first line\n')).toHaveLength(0);
    const events = parser.push('data: second line\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('first line\nsecond line');
  });

  it('ignores keepalive comments', () => {
    const parser = new SseParser();
    const events = parser.push(': keepalive\n\n');
    expect(events).toHaveLength(0);
  });

  it('returns [DONE] payloads', () => {
    const parser = new SseParser();
    const events = parser.push('data: [DONE]\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('[DONE]');
  });

  it('handles chunked payloads', () => {
    const parser = new SseParser();
    expect(parser.push('data: {"a":1')).toHaveLength(0);
    const events = parser.push('}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"a":1}');
  });
});
