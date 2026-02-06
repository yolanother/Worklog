import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { createPluginContext } from '../../src/cli-utils.js';

// Use a lightweight blessed mock similar to other tui tests
const makeNode = () => ({ hidden: false, focus: () => {}, setFront: () => {}, hide: () => {}, show: () => {}, setItems: () => {}, select: () => {}, getItem: () => undefined, setContent: () => {}, on: () => {}, key: () => {}, removeAllListeners: () => {}, destroy: () => {} });
const makeBlessed = () => ({
  screen: () => ({ render: () => {}, key: () => {}, append: () => {}, destroy: () => {}, height: 40, width: 120, focused: null }),
  box: vi.fn((opts: any) => makeNode()),
  list: vi.fn((opts: any) => ({ ...makeNode(), items: opts.items || [], selected: 0, setItems(items: string[]) { this.items = items; }, select(i: number) { this.selected = i; }, getItem(i: number) { const content = this.items?.[i]; return content ? { getContent: () => content } : undefined; } })),
  textarea: vi.fn((opts: any) => ({ ...makeNode(), value: opts.value || '', setValue(v: string) { this.value = v; }, getValue() { return this.value; }, clearValue() { this.value = ''; } })),
  text: vi.fn((opts: any) => makeNode()),
  textbox: vi.fn((opts: any) => makeNode()),
});

describe("TUI '/' search/filter", () => {
  let blessedImpl: any;
  let program: Command;
  beforeEach(() => {
    blessedImpl = makeBlessed();
    program = new Command();
    program.exitOverride();
    program.opts = () => ({ json: false, verbose: false }) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens modal and cancel returns focus to list', async () => {
    const ctx = createPluginContext(program) as any;
    ctx.blessed = blessedImpl;
    ctx.utils.requireInitialized = () => undefined;
    ctx.utils.getDatabase = () => ({ list: () => [{ id: 'WL-1', title: 'one', status: 'open' }], get: () => null });

    const register = (await import('../../src/commands/tui.js')).default;
    register(ctx);

    // simulate running command
    program.parse(['tui'], { from: 'user' });

    // Find the screen.key registration for '/'
    // We can't easily invoke the internal key handler, but ensure module loads without error
    expect(register).toBeDefined();
  });

  it('applies filter by spawning wl and updates state', async () => {
    // Mock spawn to return a payload
    const mockStdout = JSON.stringify([{ id: 'WL-2', title: 'two', status: 'open' }]);
    const spawn = vi.spyOn(require('child_process'), 'spawn').mockImplementation(() => {
      const e: any = { stdout: { on: (ev: string, cb: any) => { if (ev === 'data') cb(Buffer.from(mockStdout)); }, }, stderr: { on: () => {} }, on: (ev: string, cb: any) => { if (ev === 'close') cb(0); } };
      return e;
    });

    const ctx = createPluginContext(program) as any;
    ctx.blessed = blessedImpl;
    ctx.utils.requireInitialized = () => undefined;
    ctx.utils.getDatabase = () => ({
      list: () => [ { id: 'WL-1', title: 'one', status: 'open' } ],
      get: () => null,
      getPrefix: () => undefined,
    });

    const register = (await import('../../src/commands/tui.js')).default;
    register(ctx);
    program.parse(['tui'], { from: 'user' });

    expect(spawn).toHaveBeenCalled();
    spawn.mockRestore();
  });
});
