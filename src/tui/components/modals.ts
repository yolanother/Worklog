import blessed from 'blessed';
import type {
  BlessedBox,
  BlessedFactory,
  BlessedList,
  BlessedScreen,
  BlessedTextbox,
  BlessedText,
} from '../types.js';

export interface ModalDialogsOptions {
  parent: BlessedScreen;
  blessed?: BlessedFactory;
}

export class ModalDialogsComponent {
  private screen: BlessedScreen;
  private blessedImpl: BlessedFactory;
  private activeCleanup: (() => void) | null = null;

  constructor(options: ModalDialogsOptions) {
    this.screen = options.parent;
    this.blessedImpl = options.blessed || blessed;
  }

  create(): this {
    return this;
  }

  show(): void {
    // Modals are shown individually.
  }

  hide(): void {
    // No-op; dialogs are transient.
  }

  focus(): void {
    // No single focus target.
  }

  destroy(): void {
    // No persistent elements.
  }

  forceCleanup(): void {
    try { this.activeCleanup?.(); } catch (_) {}
    this.activeCleanup = null;
    // Safety net: always ensure grabKeys is released after any modal cleanup.
    // A textarea with inputOnFocus sets screen.grabKeys = true and may not
    // properly release it if destroyed without ending its readInput cycle.
    try { this.screen.grabKeys = false; } catch (_) {}
    try { (this.screen as any).program?.hideCursor?.(); } catch (_) {}
  }

  async selectList(options: {
    title: string;
    message: string;
    items: string[];
    defaultIndex?: number;
    cancelIndex?: number;
    width?: string | number;
    height?: string | number;
  }): Promise<number> {
    return new Promise((resolve) => {
      const overlay = this.createOverlay();
      const dialog = this.blessedImpl.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: options.width || '60%',
        height: options.height || 10,
        label: ` ${options.title} `,
        border: { type: 'line' },
        tags: true,
        mouse: true,
        clickable: true,
      }) as BlessedBox;

      const text = this.blessedImpl.box({
        parent: dialog,
        top: 1,
        left: 2,
        width: '100%-4',
        height: 3,
        content: options.message,
        tags: true,
      }) as BlessedBox;
      void text;

      const list = this.blessedImpl.list({
        parent: dialog,
        top: 5,
        left: 2,
        width: '100%-4',
        height: Math.min(4, options.items.length),
        keys: true,
        mouse: true,
        items: options.items,
        style: { selected: { bg: 'blue' } },
      }) as BlessedList;

      const defaultIndex = options.defaultIndex ?? 0;
      const cancelIndex = options.cancelIndex ?? options.items.length - 1;
      list.select(defaultIndex);

      const cleanup = () => {
        try { dialog.hide(); overlay.hide(); } catch (_) {}
        try { list.removeAllListeners?.(); } catch (_) {}
        try { dialog.removeAllListeners?.(); } catch (_) {}
        try { overlay.removeAllListeners?.(); } catch (_) {}
        try { dialog.destroy(); } catch (_) {}
        try { overlay.destroy(); } catch (_) {}
      };

      list.on('select', (_el: any, idx: number) => {
        cleanup();
        resolve(idx);
      });

      list.on('select item', (_el: any, idx: number) => {
        cleanup();
        resolve(idx);
      });

      list.on('click', () => {
        const idx = (list as any).selected ?? 0;
        if (typeof (list as any).emit === 'function') {
          (list as any).emit('select item', null, idx);
          return;
        }
        cleanup();
        resolve(idx);
      });

      dialog.key(['escape'], () => {
        cleanup();
        resolve(cancelIndex);
      });

      overlay.on('click', () => {
        cleanup();
        resolve(cancelIndex);
      });

      overlay.setFront();
      dialog.setFront();
      list.focus();
      this.screen.render();
    });
  }

  async editTextarea(options: {
    title: string;
    initial: string;
    confirmLabel: string;
    cancelLabel: string;
    width?: string | number;
    height?: string | number;
  }): Promise<string> {
    return new Promise((resolve) => {
      let resolved = false;
      const overlay = this.createOverlay();
      const dialog = this.blessedImpl.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: options.width || '60%',
        height: options.height || 5,
        label: ` ${options.title} `,
        border: { type: 'line' },
        tags: true,
        mouse: true,
        clickable: true,
      }) as BlessedBox;

      // Use a single-line textbox for the search term.  A textarea would
      // swallow Enter to insert a newline; a textbox emits 'submit' on Enter,
      // which is exactly what we want for a search/filter dialog.
      const textbox = this.blessedImpl.textbox({
        parent: dialog,
        top: 1,
        left: 1,
        width: '100%-2',
        height: 1,
        inputOnFocus: true,
        keys: true,
        mouse: true,
      }) as BlessedTextbox;

      try {
        if (typeof textbox.setValue === 'function') textbox.setValue(options.initial);
      } catch (_) {}

      // Use individual blessed.box widgets for Apply/Cancel instead of a
      // blessed.list.  blessed.list does not reliably emit 'select' for mouse
      // clicks, which caused the Promise to never resolve and left the TUI in
      // a permanently broken input state.
      const confirmBtn = this.blessedImpl.box({
        parent: dialog,
        bottom: 0,
        left: 1,
        height: 1,
        width: options.confirmLabel.length + 2,
        content: `[${options.confirmLabel}]`,
        mouse: true,
        clickable: true,
        style: { fg: 'green' },
      }) as BlessedBox;

      const cancelBtn = this.blessedImpl.box({
        parent: dialog,
        bottom: 0,
        left: options.confirmLabel.length + 4,
        height: 1,
        width: options.cancelLabel.length + 2,
        content: `[${options.cancelLabel}]`,
        mouse: true,
        clickable: true,
        style: { fg: 'yellow' },
      }) as BlessedBox;

      const cleanup = () => {
        // The textbox with inputOnFocus calls readInput() when focused,
        // which sets screen.grabKeys = true and monopolises all keyboard
        // input.  We MUST end input reading before destroying, otherwise
        // grabKeys stays true and the entire TUI keyboard is dead.
        try {
          const tb = textbox as any;
          if (tb._reading) {
            if (typeof tb.cancel === 'function' && tb.__listener) {
              tb.cancel();
            } else {
              tb._reading = false;
              this.screen.grabKeys = false;
              try { (this.screen as any).program?.hideCursor?.(); } catch (_) {}
            }
          }
        } catch (_) {}
        // Safety net: always ensure grabKeys is released
        try { this.screen.grabKeys = false; } catch (_) {}
        try { (this.screen as any).program?.hideCursor?.(); } catch (_) {}

        try { dialog.hide(); overlay.hide(); } catch (_) {}
        try { confirmBtn.removeAllListeners?.(); } catch (_) {}
        try { cancelBtn.removeAllListeners?.(); } catch (_) {}
        try { textbox.removeAllListeners?.(); } catch (_) {}
        try { dialog.removeAllListeners?.(); } catch (_) {}
        try { overlay.removeAllListeners?.(); } catch (_) {}
        try { confirmBtn.destroy(); } catch (_) {}
        try { cancelBtn.destroy(); } catch (_) {}
        try { textbox.destroy(); } catch (_) {}
        try { dialog.destroy(); } catch (_) {}
        try { overlay.destroy(); } catch (_) {}
        if (this.activeCleanup === cleanup) this.activeCleanup = null;
      };
      this.activeCleanup = cleanup;

      const safeResolve = (value: string) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(value);
      };

      // Enter submits via blessed textbox's built-in 'submit' event
      textbox.on('submit', (val: string) => {
        safeResolve(val ?? options.initial);
      });

      // Ctrl-S also submits
      textbox.key(['C-s'], () => {
        const value = textbox.getValue ? textbox.getValue() : options.initial;
        safeResolve(value);
      });

      confirmBtn.on('click', () => {
        const value = textbox.getValue ? textbox.getValue() : options.initial;
        safeResolve(value);
      });

      cancelBtn.on('click', () => {
        safeResolve('');
      });

      // Escape cancels (blessed textbox emits 'cancel' on Escape, but we
      // also bind it explicitly on the dialog for safety)
      textbox.on('cancel', () => {
        safeResolve('');
      });

      dialog.key(['escape'], () => {
        safeResolve('');
      });

      overlay.on('click', () => {
        safeResolve('');
      });

      overlay.setFront();
      dialog.setFront();
      textbox.focus();
      this.screen.render();
    });
  }

  async confirmTextbox(options: {
    title: string;
    message: string;
    confirmText: string;
    cancelLabel: string;
    width?: string | number;
    height?: string | number;
  }): Promise<boolean> {
    return new Promise((resolve) => {
      const overlay = this.createOverlay();
      const dialog = this.blessedImpl.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: options.width || '60%',
        height: options.height || 8,
        label: ` ${options.title} `,
        border: { type: 'line' },
        tags: true,
        mouse: true,
        clickable: true,
      }) as BlessedBox;

      const text = this.blessedImpl.box({
        parent: dialog,
        top: 1,
        left: 2,
        width: '100%-4',
        height: 3,
        content: options.message,
        tags: true,
      }) as BlessedText;
      void text;

      const input = this.blessedImpl.textbox({
        parent: dialog,
        bottom: 0,
        left: 2,
        width: '50%',
        height: 1,
        inputOnFocus: true,
      }) as BlessedTextbox;

      const cancelBtn = this.blessedImpl.box({
        parent: dialog,
        bottom: 0,
        right: 2,
        height: 1,
        width: options.cancelLabel.length + 2,
        content: `[${options.cancelLabel}]`,
        mouse: true,
        clickable: true,
        style: { fg: 'yellow' },
      }) as BlessedBox;

      const cleanup = () => {
        // End the textbox's readInput before destroying (same grabKeys issue
        // as editTextarea – see comment there for details).
        try {
          const inp = input as any;
          if (inp._reading) {
            if (typeof inp.cancel === 'function' && inp.__listener) {
              inp.cancel();
            } else {
              inp._reading = false;
              this.screen.grabKeys = false;
              try { (this.screen as any).program?.hideCursor?.(); } catch (_) {}
            }
          }
        } catch (_) {}
        try { this.screen.grabKeys = false; } catch (_) {}
        try { (this.screen as any).program?.hideCursor?.(); } catch (_) {}

        try { dialog.hide(); overlay.hide(); } catch (_) {}
        try { input.removeAllListeners?.(); } catch (_) {}
        try { cancelBtn.removeAllListeners?.(); } catch (_) {}
        try { dialog.removeAllListeners?.(); } catch (_) {}
        try { overlay.removeAllListeners?.(); } catch (_) {}
        try { input.destroy(); } catch (_) {}
        try { dialog.destroy(); } catch (_) {}
        try { overlay.destroy(); } catch (_) {}
        if (this.activeCleanup === cleanup) this.activeCleanup = null;
      };
      this.activeCleanup = cleanup;

      cancelBtn.on('click', () => {
        cleanup();
        resolve(false);
      });

      input.on('submit', (val: string) => {
        cleanup();
        resolve((val || '').trim() === options.confirmText);
      });

      dialog.key(['escape'], () => {
        cleanup();
        resolve(false);
      });

      overlay.on('click', () => {
        cleanup();
        resolve(false);
      });

      overlay.setFront();
      dialog.setFront();
      input.focus();
      this.screen.render();
    });
  }

  private createOverlay(): BlessedBox {
    return this.blessedImpl.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100% - 1',
      mouse: true,
      clickable: true,
      style: { bg: 'black' },
    }) as BlessedBox;
  }
}
