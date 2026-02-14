/**
 * Test utilities and helpers
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Create a temporary directory for test files
 */
export function createTempDir(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-test-'));
  return tmpDir;
}

/**
 * Clean up a temporary directory
 */
export function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Create a temporary JSONL file path in a temp directory
 */
export function createTempJsonlPath(dir: string): string {
  return path.join(dir, 'test-data.jsonl');
}

/**
 * Create a temporary database path in a temp directory
 */
export function createTempDbPath(dir: string): string {
  return path.join(dir, 'test.db');
}

/**
 * Wait for a specified number of milliseconds
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a minimal TUI test context used by a few TUI-focused tests.
 * This provides a lightweight in-memory database, toast collector, and a
 * `createLayout` factory so tests can instantiate `TuiController` without
 * depending on the real terminal environment.
 */
export function createTuiTestContext() {
  let nextId = 1;
  const items = new Map<string, any>();

  const utils = {
    createSampleItem: ({ tags = [] } = {}) => {
      const id = `WL-TEST-${nextId++}`;
      const now = new Date().toISOString();
      const item = {
        id,
        title: 'Sample',
        description: '',
        status: 'open',
        priority: 'medium',
        sortIndex: 0,
        parentId: null,
        createdAt: now,
        updatedAt: now,
        tags,
        assignee: '',
        stage: '',
        issueType: 'task',
        createdBy: '',
        deletedBy: '',
        deleteReason: '',
        risk: '',
        effort: '',
      };
      items.set(id, item);
      return id;
    },
    db: {
      get: (id: string) => items.get(id),
    },
  } as any;

  const toast = {
    _last: '',
    show: (m: string) => { toast._last = m; },
    lastMessage: () => toast._last,
  } as any;

  // Minimal box/screen factories used by the layout mocks
  const makeBox = () => ({ hidden: true, show: () => {}, hide: () => {}, focus: () => {}, setFront: () => {}, setContent: () => {}, setItems: () => {}, select: () => {}, getItem: () => undefined, on: () => {}, key: () => {}, setLabel: () => {} });

  // Simple screen that allows registering a single keypress handler and
  // exposing `emit('keypress', ch, key)` to simulate key events.
  const keyHandlers: Array<(...args: any[]) => void> = [];
  const screen: any = {
    height: 40,
    width: 100,
    focused: null,
    render: () => {},
    destroy: () => {},
    key: () => {},
    on: (ev: string, cb: (...args: any[]) => void) => { if (ev === 'keypress') keyHandlers.push(cb); },
    emit: (ev: string, ch: any, key: any) => { if (ev === 'keypress') keyHandlers.forEach(h => { try { h(ch, key); } catch (_) {} }); },
  };

  const layout = {
    screen,
    listComponent: { getList: () => makeBox(), getFooter: () => makeBox() },
    detailComponent: { getDetail: () => makeBox(), getCopyIdButton: () => makeBox() },
    toastComponent: { show: (m: string) => toast.show(m) },
    overlaysComponent: { detailOverlay: makeBox(), closeOverlay: makeBox(), updateOverlay: makeBox() },
    dialogsComponent: {
      detailModal: makeBox(), detailClose: makeBox(), closeDialog: makeBox(), closeDialogText: makeBox(), closeDialogOptions: makeBox(),
      updateDialog: makeBox(), updateDialogText: makeBox(), updateDialogOptions: makeBox(), updateDialogStageOptions: makeBox(), updateDialogStatusOptions: makeBox(), updateDialogPriorityOptions: makeBox(), updateDialogComment: makeBox(),
    },
    helpMenu: { isVisible: () => false, show: () => {}, hide: () => {} },
    modalDialogs: { selectList: async () => 0, editTextarea: async () => null, confirmTextbox: async () => false, forceCleanup: () => {} },
    opencodeUi: { serverStatusBox: makeBox(), dialog: makeBox(), textarea: makeBox(), suggestionHint: makeBox(), sendButton: makeBox(), cancelButton: makeBox(), ensureResponsePane: () => makeBox() },
    nextDialog: { overlay: makeBox(), dialog: makeBox(), close: makeBox(), text: makeBox(), options: makeBox() },
  };

  const program = { opts: () => ({ verbose: false }) } as any;

  return {
    program,
    utils,
    toast,
    blessed: {},
    screen,
    createLayout: () => layout,
  } as any;
}
