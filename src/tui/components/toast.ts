import blessed from 'blessed';

export interface ToastOptions {
  parent: any; // blessed.Widgets.Screen
  position?: {
    bottom?: number | string;
    right?: number | string;
    top?: number | string;
    left?: number | string;
  };
  style?: {
    fg?: string;
    bg?: string;
  };
  duration?: number;
}

export class ToastComponent {
  private box: any; // blessed.Widgets.BoxElement
  private screen: any; // blessed.Widgets.Screen
  private timer: NodeJS.Timeout | null = null;
  private duration: number;

  constructor(options: ToastOptions) {
    this.screen = options.parent;
    this.duration = options.duration || 1200;

    // Create the toast box
    this.box = blessed.box({
      parent: this.screen,
      bottom: options.position?.bottom ?? 1,
      right: options.position?.right ?? 1,
      top: options.position?.top,
      left: options.position?.left,
      height: 1,
      width: 12, // Will be adjusted based on content
      content: '',
      hidden: true,
      style: options.style || { fg: 'black', bg: 'green' },
    });
  }

  /**
   * Show a toast message
   */
  show(message: string): void {
    if (!message) return;
    
    const padded = ` ${message} `;
    this.box.setContent(padded);
    this.box.width = padded.length;
    this.box.show();
    this.screen.render();
    
    // Clear any existing timer
    if (this.timer) {
      clearTimeout(this.timer);
    }
    
    // Set new timer to hide the toast
    this.timer = setTimeout(() => {
      this.hide();
    }, this.duration);
  }

  /**
   * Hide the toast
   */
  hide(): void {
    this.box.hide();
    this.screen.render();
    
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Update toast styling
   */
  setStyle(style: { fg?: string; bg?: string }): void {
    if (style.fg) this.box.style.fg = style.fg;
    if (style.bg) this.box.style.bg = style.bg;
  }

  /**
   * Update toast position
   */
  setPosition(position: ToastOptions['position']): void {
    if (position?.bottom !== undefined) this.box.bottom = position.bottom;
    if (position?.right !== undefined) this.box.right = position.right;
    if (position?.top !== undefined) this.box.top = position.top;
    if (position?.left !== undefined) this.box.left = position.left;
  }

  /**
   * Destroy the toast component
   */
  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.box.destroy();
  }
}