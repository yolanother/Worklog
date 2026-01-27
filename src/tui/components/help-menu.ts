import blessed from 'blessed';

export interface HelpMenuOptions {
  parent: any; // blessed.Widgets.Screen
  position?: {
    top?: number | string;
    left?: number | string;
    width?: number | string;
    height?: number | string;
  };
  style?: {
    border?: { fg?: string };
    fg?: string;
    bg?: string;
  };
  shortcuts?: Array<{
    category: string;
    items: Array<{
      keys: string;
      description: string;
    }>;
  }>;
}

export class HelpMenuComponent {
  private screen: any; // blessed.Widgets.Screen
  private overlay: any; // blessed.Widgets.BoxElement
  private menu: any; // blessed.Widgets.BoxElement
  private closeButton: any; // blessed.Widgets.BoxElement
  private onClose?: () => void;

  constructor(options: HelpMenuOptions) {
    this.screen = options.parent;

    // Create overlay background
    this.overlay = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      hidden: true,
      mouse: true,
      clickable: true,
      style: { bg: 'black' },
    });

    // Create help menu box
    this.menu = blessed.box({
      parent: this.screen,
      top: options.position?.top || 'center',
      left: options.position?.left || 'center',
      width: options.position?.width || '70%',
      height: options.position?.height || '70%',
      label: ' Help ',
      border: { type: 'line' },
      hidden: true,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      style: options.style || {
        border: { fg: 'cyan' },
      },
    });

    // Create close button
    this.closeButton = blessed.box({
      parent: this.menu,
      top: 0,
      right: 1,
      height: 1,
      width: 3,
      content: '[x]',
      style: { fg: 'red' },
      mouse: true,
      clickable: true,
    });

    // Set default shortcuts if not provided
    const shortcuts = options.shortcuts || this.getDefaultShortcuts();
    this.updateContent(shortcuts);

    // Setup event handlers
    this.setupEventHandlers();
  }

  private getDefaultShortcuts() {
    return [
      {
        category: 'Navigation',
        items: [
          { keys: 'Up/Down, j/k', description: 'Move selection' },
          { keys: 'PageUp/PageDown, Home/End', description: 'Jump' },
        ],
      },
      {
        category: 'Tree',
        items: [
          { keys: 'Right/Enter', description: 'Expand node' },
          { keys: 'Left', description: 'Collapse node / parent' },
          { keys: 'Space', description: 'Toggle expand/collapse' },
        ],
      },
      {
        category: 'Focus',
        items: [
          { keys: 'Tab', description: 'Cycle focus panes' },
        ],
      },
      {
        category: 'Filters',
        items: [
          { keys: 'I', description: 'Show in-progress only' },
          { keys: 'A', description: 'Show open items' },
          { keys: 'B', description: 'Show blocked only' },
        ],
      },
      {
        category: 'Refresh',
        items: [
          { keys: 'R', description: 'Reload items from database' },
        ],
      },
      {
        category: 'Clipboard',
        items: [
          { keys: 'C', description: 'Copy selected item ID' },
        ],
      },
      {
        category: 'Preview',
        items: [
          { keys: 'P', description: 'Open parent in modal' },
        ],
      },
      {
        category: 'Actions',
        items: [
          { keys: 'O', description: 'Open OpenCode prompt' },
          { keys: 'X', description: 'Close selected item' },
          { keys: 'U', description: 'Update selected item' },
        ],
      },
      {
        category: 'Help',
        items: [
          { keys: '?', description: 'Toggle this help' },
        ],
      },
      {
        category: 'Exit',
        items: [
          { keys: 'q, Esc, Ctrl-C', description: 'Quit' },
        ],
      },
    ];
  }

  private updateContent(shortcuts: HelpMenuOptions['shortcuts']) {
    if (!shortcuts) return;

    const lines: string[] = ['Keyboard shortcuts', ''];
    
    shortcuts.forEach(section => {
      lines.push(`${section.category}:`);
      section.items.forEach(item => {
        // Pad keys to align descriptions
        const keysPadded = item.keys.padEnd(25);
        lines.push(`  ${keysPadded}${item.description}`);
      });
      lines.push('');
    });

    this.menu.setContent(lines.join('\n'));
  }

  private setupEventHandlers(): void {
    // Close on overlay click
    this.overlay.on('click', () => {
      this.close();
    });

    // Close on menu click
    this.menu.on('click', () => {
      this.close();
    });

    // Close on close button click
    this.closeButton.on('click', () => {
      this.close();
    });

    // Close on escape or q
    this.menu.key(['escape', 'q'], () => {
      this.close();
    });
  }

  /**
   * Show the help menu
   */
  show(): void {
    this.overlay.show();
    this.menu.show();
    this.overlay.setFront();
    this.menu.setFront();
    this.menu.focus();
    this.screen.render();
  }

  /**
   * Hide the help menu
   */
  hide(): void {
    this.menu.hide();
    this.overlay.hide();
    this.screen.render();
  }

  /**
   * Close the help menu (alias for hide with callback)
   */
  close(): void {
    this.hide();
    if (this.onClose) {
      this.onClose();
    }
  }

  /**
   * Set close callback
   */
  setOnClose(callback: () => void): void {
    this.onClose = callback;
  }

  /**
   * Check if menu is visible
   */
  isVisible(): boolean {
    return !this.menu.hidden;
  }

  /**
   * Focus the menu
   */
  focus(): void {
    this.menu.focus();
  }

  /**
   * Destroy the help menu component
   */
  destroy(): void {
    this.closeButton.destroy();
    this.menu.destroy();
    this.overlay.destroy();
  }
}