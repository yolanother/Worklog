import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture handlers so we can invoke them later
const handlers: Record<string, Function> = {};

// Minimal blessed mock that gives us a textarea widget and records event handlers
const blessedMock = {
  screen: vi.fn(() => ({ render: vi.fn(), destroy: vi.fn(), key: vi.fn(), on: vi.fn(), once: vi.fn(), off: vi.fn() })),
  textarea: vi.fn((opts: any) => {
    const style = opts?.style || { focus: { border: { fg: 'green' } }, border: { fg: 'white' }, bold: true };
    const widget: any = {
      style,
      getValue: () => '',
      setValue: vi.fn(),
      clearValue: vi.fn(),
      focus: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      setScrollPerc: vi.fn(),
      setContent: vi.fn(),
      on: (ev: string, h: Function) => { handlers[ev] = h; },
      once: vi.fn(),
      off: vi.fn(),
    };
    // expose last created widget for test inspection
    (blessedMock as any)._lastTextarea = widget;
    return widget;
  }),
  box: vi.fn((opts: any) => ({ style: opts?.style || {}, show: vi.fn(), hide: vi.fn(), on: vi.fn() })),
  list: vi.fn((opts: any) => ({ style: opts?.style || {}, setItems: vi.fn(), on: vi.fn() })),
};

// Mock blessed so the module under test receives our mock when imported
vi.doMock('blessed', () => blessedMock);

// Import register after mocking blessed
import register from '../src/commands/tui';

describe('TUI integration: style preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(handlers)) delete handlers[k];
  });

  it('runs TUI action and ensures textarea.style object is preserved when layout logic executes', async () => {
    // Minimal program mock capturing the action callback
    let savedAction: Function | null = null;
    const program: any = {
      opts: () => ({ verbose: false }),
      command() { return this; },
      description() { return this; },
      option() { return this; },
      action(fn: Function) { savedAction = fn; return this; },
    };

    // Minimal utils mock that returns at least one work item so TUI proceeds
    const utils = {
      requireInitialized: () => {},
      getDatabase: () => ({
        list: () => [{ id: 'WL-TEST-1', status: 'open' }],
        getPrefix: () => 'default',
        getCommentsForWorkItem: (_id: string) => [],
      }),
    };

    // Register the TUI command (stores action in savedAction)
    register({ program, utils } as any);

    expect(typeof savedAction).toBe('function');

    // Invoke the action to run the TUI setup
    await (savedAction as any)({});

    // Diagnostic: ensure our mock functions were invoked
    // If textarea wasn't called something in the setup returned early
    const taCalls = (blessedMock as any).textarea && (blessedMock as any).textarea.mock ? (blessedMock as any).textarea.mock.calls.length : 0;
    const boxCalls = (blessedMock as any).box && (blessedMock as any).box.mock ? (blessedMock as any).box.mock.calls.length : 0;
    const listCalls = (blessedMock as any).list && (blessedMock as any).list.mock ? (blessedMock as any).list.mock.calls.length : 0;
    expect(taCalls + boxCalls + listCalls).toBeGreaterThan(0);

    // Wait briefly for the textarea to be created and grab it
    let created: any = null;
    for (let i = 0; i < 20; i++) {
      created = (blessedMock as any)._lastTextarea;
      if (created) break;
      // small yield
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(created).toBeTruthy();
    const originalStyleRef = created.style;

    // Find keypress handler registered by opencodeText.on('keypress', ...)
    const kp = handlers['keypress'];
    expect(typeof kp).toBe('function');

    // Call the keypress handler with a non-linefeed key to trigger update flow
    kp.call(created, null, { name: 'a' });

    // Allow nextTick handlers to run
    await new Promise((r) => setTimeout(r, 0));

    // The style object should still be the same reference
    expect(created.style).toBe(originalStyleRef);
  });
});
