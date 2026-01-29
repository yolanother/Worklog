import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture handlers so we can invoke them later
const handlers: Record<string, Function> = {};

// Minimal blessed mock that gives us a textarea widget and records event handlers
const blessedMock = {
  screen: vi.fn(() => ({ render: vi.fn(), destroy: vi.fn(), key: vi.fn(), on: vi.fn(), once: vi.fn(), off: vi.fn(), height: 40, width: 120 })),
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
      key: vi.fn((keys: any, h: Function) => { handlers['key'] = h; }),
      moveCursor: vi.fn(),
    };
    // expose last created widget for test inspection
    (blessedMock as any)._lastTextarea = widget;
    return widget;
  }),
  box: vi.fn((opts: any) => {
    const widget: any = {
      style: opts?.style || {},
      show: vi.fn(),
      hide: vi.fn(),
      on: vi.fn((ev: string, h: Function) => { handlers[ev] = h; }),
      key: vi.fn((keys: any, h: Function) => { handlers['key'] = h; }),
      setContent: vi.fn(),
      setLabel: vi.fn(),
      setFront: vi.fn(),
      pushLine: vi.fn(),
      setScroll: vi.fn(),
      setScrollPerc: vi.fn(),
      getScroll: vi.fn(() => 0),
      getContent: vi.fn(() => ''),
      setValue: vi.fn(),
      clearValue: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    };
    return widget;
  }),
  list: vi.fn((opts: any) => {
    const state: any = { items: [], selected: 0 };
    return {
      style: opts?.style || {},
      setItems: vi.fn((items: string[]) => { state.items = items; }),
      on: vi.fn((ev: string, h: Function) => { handlers[ev] = h; }),
      select: vi.fn((idx: number) => { state.selected = idx; }),
      focus: vi.fn(),
      key: vi.fn(),
      getScroll: vi.fn(() => 0),
      getContent: vi.fn(() => state.items.join('\n')),
      get selected() { return state.selected; },
      set selected(v: number) { state.selected = v; }
    };
  }),
  text: vi.fn((opts: any) => ({ style: opts?.style || {}, setContent: vi.fn(), hide: vi.fn(), show: vi.fn(), setFront: vi.fn(), setLabel: vi.fn(), setScrollPerc: vi.fn() })),
  textbox: vi.fn((opts: any) => ({ style: opts?.style || {}, setValue: vi.fn(), getValue: vi.fn(() => ''), on: vi.fn(), focus: vi.fn(), hide: vi.fn(), show: vi.fn(), key: vi.fn() })),
};

// We'll inject our mock into the require cache for 'blessed' right before
// importing the module under test so the ESM import in that module picks
// up our mocked implementation.

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

    // Import the module under test and inject our mocked blessed implementation
    // via the ctx object so the TUI code uses our mock instead of importing
    // the real blessed. This is a small, explicit test seam that avoids
    // fragile module-cache tricks.
    // Import the module under test using ESM dynamic import so the test
    // environment's module resolution works correctly.
    const mod = await import('../src/commands/tui');
    const register = mod.default || mod;
    // Register the TUI command (stores action in savedAction). Inject
    // our blessed mock via the ctx so the implementation uses it.
    register({ program, utils, blessed: blessedMock } as any);

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

  it('escapes blessed tags when rendering detail text', async () => {
    let savedAction: Function | null = null;
    const program: any = {
      opts: () => ({ verbose: false }),
      command() { return this; },
      description() { return this; },
      option() { return this; },
      action(fn: Function) { savedAction = fn; return this; },
    };

    const utils = {
      requireInitialized: () => {},
      getDatabase: () => ({
        list: () => [{ id: 'WL-TEST-1', title: 'Detail item', status: 'open', description: 'Has {braces}' }],
        getPrefix: () => 'default',
        getCommentsForWorkItem: (_id: string) => [],
        get: () => ({ id: 'WL-TEST-1', title: 'Detail item', status: 'open', description: 'Has {braces}' }),
      }),
    };

    const mod = await import('../src/commands/tui');
    const register = mod.default || mod;
    register({ program, utils, blessed: blessedMock } as any);

    await (savedAction as any)({});

    const boxMock = (blessedMock as any).box?.mock;
    const boxCalls = boxMock?.calls || [];
    const detailIndex = boxCalls.findIndex((call: any[]) => call?.[0]?.label === ' Details ');
    const detail = detailIndex >= 0 ? boxMock.results[detailIndex]?.value : null;

    const selectHandler = handlers['select'] || handlers['select item'];
    expect(typeof selectHandler).toBe('function');
    selectHandler(null, 0);

    const setContentCalls = detail?.setContent?.mock?.calls || [];
    const content = setContentCalls.length > 0 ? setContentCalls[setContentCalls.length - 1][0] : '';
    expect(content).toContain('{open}');
    expect(content).toContain('{close}');
  });
});
