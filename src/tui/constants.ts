/**
 * Centralized TUI constants and command/shortcut definitions.
 *
 * Move magic values (command lists, keyboard shortcuts, numeric layout values)
 * here so they can be documented, localized, and changed in one place.
 */

export const AVAILABLE_COMMANDS: string[] = [
  '/help',
  '/clear',
  '/save',
  '/export',
  '/import',
  '/test',
  '/build',
  '/run',
  '/debug',
  '/search',
  '/replace',
  '/refactor',
  '/explain',
  '/review',
  '/commit',
  '/push',
  '/pull',
  '/status',
  '/diff',
  '/log',
  '/branch',
  '/merge',
  '/rebase',
  '/checkout',
  '/stash',
  '/tag',
  '/reset',
  '/revert',
];

// Default shortcuts used by the help menu. Keep the shape stable so the
// HelpMenuComponent can simply render this structure.
export const DEFAULT_SHORTCUTS = [
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
      { keys: 'Ctrl+W, Ctrl+W', description: 'Cycle focus panes' },
      { keys: 'Ctrl+W, h/l', description: 'Focus list/details' },
      { keys: 'Ctrl+W, k/j', description: 'OpenCode response/input' },
      { keys: 'Ctrl+W, p', description: 'Previous pane' },
    ],
  },
  {
    category: 'Filters',
    items: [
      { keys: '/', description: 'Search/Filter' },
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
      { keys: 'N', description: 'Find next work item' },
      { keys: 'N (dialog)', description: 'Next recommendation' },
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

// Layout / behavior constants used by the TUI. Centralizing these makes it
// easier to tweak layout across platforms.
export const MIN_INPUT_HEIGHT = 3; // Minimum height for input dialog (single line + borders)
export const MAX_INPUT_LINES = 7;  // Maximum visible lines of input text
export const FOOTER_HEIGHT = 1;    // Height reserved for the footer

// Default port for the OpenCode server; honoring OPENCODE_SERVER_PORT env var.
export const OPENCODE_SERVER_PORT = parseInt(process.env.OPENCODE_SERVER_PORT || '9999', 10);

export default {
  AVAILABLE_COMMANDS,
  DEFAULT_SHORTCUTS,
  MIN_INPUT_HEIGHT,
  MAX_INPUT_LINES,
  FOOTER_HEIGHT,
  OPENCODE_SERVER_PORT,
};
