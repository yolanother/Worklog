/**
 * TUI command - interactive tree view for work items
 */

import type { PluginContext } from '../plugin-types.js';
import blessed from 'blessed';
import { humanFormatWorkItem, sortByPriorityAndDate, formatTitleOnly } from './helpers.js';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { resolveWorklogDir } from '../worklog-paths.js';
import { spawnSync } from 'child_process';

type Item = any;

export default function register(ctx: PluginContext): void {
  const { program, utils } = ctx;

  program
    .command('tui')
    .description('Interactive TUI: browse work items in a tree (use --in-progress to show only in-progress)')
    .option('--in-progress', 'Show only in-progress items')
    .option('--all', 'Include completed/deleted items in the list')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((options: { inProgress?: boolean; prefix?: string; all?: boolean }) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);

      const query: any = {};
      if (options.inProgress) query.status = 'in-progress';

      const items: Item[] = db.list(query);
      // By default hide closed items (completed or deleted) unless --all is set
      const visibleItems = options.all ? items : items.filter((item: any) => item.status !== 'completed' && item.status !== 'deleted');
      if (visibleItems.length === 0) {
        console.log('No work items found');
        return;
      }

      let showClosed = Boolean(options.all);
      let currentVisibleItems: Item[] = visibleItems.slice();
      let itemsById = new Map<string, Item>();
      let childrenMap = new Map<string, Item[]>();
      let roots: Item[] = [];

      function rebuildTree() {
        currentVisibleItems = showClosed
          ? items.slice()
          : items.filter((item: any) => item.status !== 'completed' && item.status !== 'deleted');

        itemsById = new Map<string, Item>();
        for (const it of currentVisibleItems) itemsById.set(it.id, it);

        childrenMap = new Map<string, Item[]>();
        for (const it of currentVisibleItems) {
          const pid = it.parentId;
          if (pid && itemsById.has(pid)) {
            const arr = childrenMap.get(pid) || [];
            arr.push(it);
            childrenMap.set(pid, arr);
          }
        }

        roots = currentVisibleItems.filter(it => !it.parentId || !itemsById.has(it.parentId)).slice();
        roots.sort(sortByPriorityAndDate);

        // prune expanded nodes that are no longer present
        for (const id of Array.from(expanded)) {
          if (!itemsById.has(id)) expanded.delete(id);
        }
      }

      // Track expanded state by id
      const expanded = new Set<string>();

      // Persisted state file per-worklog directory
      const worklogDir = resolveWorklogDir();
      const statePath = path.join(worklogDir, 'tui-state.json');

      // Load persisted state for this prefix if present
      function loadPersistedState(prefix: string | undefined) {
        try {
          if (!fs.existsSync(statePath)) return null;
          const raw = fs.readFileSync(statePath, 'utf8');
          const j = JSON.parse(raw || '{}');
          return j[prefix || 'default'] || null;
        } catch (err) {
          return null;
        }
      }

      function savePersistedState(prefix: string | undefined, state: any) {
        try {
          if (!fs.existsSync(worklogDir)) fs.mkdirSync(worklogDir, { recursive: true });
          let j: any = {};
          if (fs.existsSync(statePath)) {
            try { j = JSON.parse(fs.readFileSync(statePath, 'utf8') || '{}'); } catch { j = {}; }
          }
          j[prefix || 'default'] = state;
          fs.writeFileSync(statePath, JSON.stringify(j, null, 2), 'utf8');
        } catch (err) {
          // ignore persistence errors
        }
      }

      // Default expand roots unless persisted state exists
      const persisted = loadPersistedState(db.getPrefix?.() || undefined);
      if (persisted && Array.isArray(persisted.expanded)) {
        for (const id of persisted.expanded) expanded.add(id);
      } else {
        // temp expand roots; actual roots set after rebuildTree
      }

      rebuildTree();
      if (!persisted || !Array.isArray(persisted.expanded)) {
        for (const r of roots) expanded.add(r.id);
      }

      // Flatten visible nodes for rendering
      type VisibleNode = { item: Item; depth: number; hasChildren: boolean };

      function buildVisible(): VisibleNode[] {
        const out: VisibleNode[] = [];

        function visit(it: Item, depth: number) {
          const children = (childrenMap.get(it.id) || []).slice().sort(sortByPriorityAndDate);
          out.push({ item: it, depth, hasChildren: children.length > 0 });
          if (children.length > 0 && expanded.has(it.id)) {
            for (const c of children) visit(c, depth + 1);
          }
        }

        for (const r of roots) visit(r, 0);
        return out;
      }

      // Setup blessed screen and layout
      const screen = blessed.screen({ smartCSR: true, title: 'Worklog TUI' });

      const list = blessed.list({
        parent: screen,
        label: ' Work Items ',
        width: '50%',
        height: '100%-1',
        tags: true,
        keys: true,
        vi: false,
        mouse: true,
        scrollbar: { ch: ' ', track: { bg: 'grey' }, style: { bg: 'grey' } },
        style: {
          selected: { bg: 'blue' },
        },
        border: { type: 'line' },
        left: 0,
        top: 0,
      });

      const detail = blessed.box({
        parent: screen,
        label: ' Details ',
        left: '50%',
        width: '50%',
        height: '100%-1',
        tags: true,
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        vi: true,
        mouse: true,
        border: { type: 'line' },
        style: { focus: { border: { fg: 'green' } } },
        content: '',
      });

      const copyIdButton = blessed.box({
        parent: detail,
        top: 0,
        right: 1,
        height: 1,
        width: 11,
        content: '[Copy ID]',
        tags: false,
        mouse: true,
        align: 'right',
        style: { fg: 'yellow' },
      });

      const help = blessed.box({
        parent: screen,
        bottom: 0,
        left: 0,
        height: 1,
        width: '100%',
        content: 'Press ? for help',
        style: { fg: 'grey' },
      });

      const toast = blessed.box({
        parent: screen,
        bottom: 1,
        right: 1,
        height: 1,
        width: 12,
        content: '',
        hidden: true,
        style: { fg: 'black', bg: 'green' },
      });

      const overlay = blessed.box({
        parent: screen,
        top: 0,
        left: 0,
        width: '100%',
        height: '100% - 1',
        hidden: true,
        style: { bg: 'black' },
      });

      const helpMenu = blessed.box({
        parent: screen,
        top: 'center',
        left: 'center',
        width: '70%',
        height: '70%',
        label: ' Help ',
        border: { type: 'line' },
        hidden: true,
        tags: true,
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        vi: true,
        mouse: true,
        style: {
          border: { fg: 'cyan' },
        }
      });

      const helpClose = blessed.box({
        parent: helpMenu,
        top: 0,
        right: 1,
        height: 1,
        width: 3,
        content: '[x]',
        style: { fg: 'red' },
        mouse: true,
      });

      const helpText = [
        'Keyboard shortcuts',
        '',
        'Navigation:',
        '  Up/Down, j/k   Move selection',
        '  PageUp/PageDown, Home/End   Jump',
        '',
        'Tree:',
        '  Right/Enter    Expand node',
        '  Left           Collapse node / parent',
        '  Space          Toggle expand/collapse',
        '',
        'Focus:',
        '  Tab            Cycle focus panes',
        '',
        'Clipboard:',
        '  C              Copy selected item ID',
        '',
        'Help:',
        '  ?              Toggle this help',
        '',
        'Exit:',
        '  q, Esc, Ctrl-C  Quit'
      ].join('\n');
      helpMenu.setContent(helpText);

      function renderListAndDetail(selectIndex = 0) {
        const visible = buildVisible();
        const lines = visible.map(n => {
          const indent = '  '.repeat(n.depth);
          const marker = n.hasChildren ? (expanded.has(n.item.id) ? '▾' : '▸') : ' ';
          const title = formatTitleOnly(n.item);
          return `${indent}${marker} ${title} ${chalk.gray('(' + n.item.id + ')')}`;
        });
        list.setItems(lines);
        // Keep selection in bounds
        const idx = Math.max(0, Math.min(selectIndex, lines.length - 1));
        list.select(idx);
        updateDetailForIndex(idx, visible);
        // Update footer/help with right-aligned closed toggle
        try {
          const closedCount = items.filter((item: any) => item.status === 'completed' || item.status === 'deleted').length;
          const leftText = 'Press ? for help';
          const rightText = `Closed (${closedCount}): ${showClosed ? 'Shown' : 'Hidden'}`;
          const cols = screen.width as number;
          if (cols && cols > leftText.length + rightText.length + 2) {
            const gap = cols - leftText.length - rightText.length;
            help.setContent(`${leftText}${' '.repeat(gap)}${rightText}`);
          } else {
            help.setContent(`${leftText} • ${rightText}`);
          }
        } catch (err) {
          // ignore
        }
        screen.render();
      }

      function updateDetailForIndex(idx: number, visible?: VisibleNode[]) {
        const v = visible || buildVisible();
        if (v.length === 0) {
          detail.setContent('');
          return;
        }
        const node = v[idx] || v[0];
        const text = humanFormatWorkItem(node.item, db, 'full');
        detail.setContent(text);
        detail.setScroll(0);
      }

      function getSelectedItem(): Item | null {
        const idx = list.selected as number;
        const visible = buildVisible();
        const node = visible[idx] || visible[0];
        return node?.item || null;
      }

      function copyToClipboard(text: string): { success: boolean; error?: string } {
        try {
          if (process.platform === 'darwin') {
            const result = spawnSync('pbcopy', [], { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
            if (result.status === 0) return { success: true };
            return { success: false, error: result.error?.message || 'pbcopy failed' };
          }

          if (process.platform === 'win32') {
            const result = spawnSync('cmd', ['/c', 'clip'], { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
            if (result.status === 0) return { success: true };
            return { success: false, error: result.error?.message || 'clip failed' };
          }

          const xclip = spawnSync('xclip', ['-selection', 'clipboard'], { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
          if (xclip.status === 0) return { success: true };

          const xsel = spawnSync('xsel', ['--clipboard', '--input'], { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
          if (xsel.status === 0) return { success: true };

          return { success: false, error: xclip.error?.message || xsel.error?.message || 'clipboard command not available' };
        } catch (err: any) {
          return { success: false, error: err?.message || 'clipboard copy failed' };
        }
      }

      function copySelectedId() {
        const item = getSelectedItem();
        if (!item) return;
        const result = copyToClipboard(item.id);
        if (result.success) showToast('ID copied');
        else showToast('Copy failed');
      }

      let toastTimer: NodeJS.Timeout | null = null;
      function showToast(message: string) {
        if (!message) return;
        const padded = ` ${message} `;
        toast.setContent(padded);
        toast.width = padded.length;
        toast.show();
        screen.render();
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
          toast.hide();
          screen.render();
        }, 1200);
      }

      // Initial render
      renderListAndDetail(0);

      // Event handlers
      list.on('select', (_el: any, idx: number) => {
        const visible = buildVisible();
        updateDetailForIndex(idx, visible);
        screen.render();
      });

      list.on('select item', (_el: any, idx: number) => {
        const visible = buildVisible();
        updateDetailForIndex(idx, visible);
        screen.render();
      });

      // Update details immediately when navigating with keys or mouse
      list.on('keypress', (_ch: any, key: any) => {
        try {
          const nav = key && key.name && ['up', 'down', 'k', 'j', 'pageup', 'pagedown', 'home', 'end'].includes(key.name);
          if (nav) {
            const idx = list.selected as number;
            const visible = buildVisible();
            updateDetailForIndex(idx, visible);
            screen.render();
          }
        } catch (err) {
          // ignore render errors
        }
      });

      list.on('click', () => {
        setTimeout(() => {
          const idx = list.selected as number;
          const visible = buildVisible();
          updateDetailForIndex(idx, visible);
          screen.render();
        }, 0);
      });

      screen.key(['right', 'enter'], () => {
        const idx = list.selected as number;
        const visible = buildVisible();
        const node = visible[idx];
        if (node && node.hasChildren) {
          expanded.add(node.item.id);
          renderListAndDetail(idx);
        }
      });

      screen.key(['left'], () => {
        const idx = list.selected as number;
        const visible = buildVisible();
        const node = visible[idx];
        if (!node) return;
        if (node.hasChildren && expanded.has(node.item.id)) {
          expanded.delete(node.item.id);
          renderListAndDetail(idx);
          return;
        }
        // collapse parent if possible
        const parentIdx = findParentIndex(idx, visible);
        if (parentIdx >= 0) {
          const parent = visible[parentIdx];
          expanded.delete(parent.item.id);
          renderListAndDetail(parentIdx);
        }
      });

      function findParentIndex(idx: number, visible: VisibleNode[]): number {
        if (idx <= 0) return -1;
        const depth = visible[idx].depth;
        for (let i = idx - 1; i >= 0; i--) {
          if (visible[i].depth < depth) return i;
        }
        return -1;
      }

      // Toggle expand/collapse with space
      screen.key(['space'], () => {
        const idx = list.selected as number;
        const visible = buildVisible();
        const node = visible[idx];
        if (!node || !node.hasChildren) return;
        if (expanded.has(node.item.id)) expanded.delete(node.item.id);
        else expanded.add(node.item.id);
        renderListAndDetail(idx);
        // persist state
        savePersistedState(db.getPrefix?.() || undefined, { expanded: Array.from(expanded) });
      });

      // Quit keys: q and Ctrl-C always quit; Escape should close the help overlay
      // when it's open instead of exiting the whole TUI.
      screen.key(['q', 'C-c'], () => {
        // Persist state before exiting
        try { savePersistedState(db.getPrefix?.() || undefined, { expanded: Array.from(expanded) }); } catch (_) {}
        screen.destroy();
        process.exit(0);
      });

      screen.key(['escape'], () => {
        if (!helpMenu.hidden) {
          // If help overlay is visible, close it instead of quitting
          closeHelp();
          return;
        }
        try { savePersistedState(db.getPrefix?.() || undefined, { expanded: Array.from(expanded) }); } catch (_) {}
        screen.destroy();
        process.exit(0);
      });

      // Focus list to receive keys
      list.focus();
      screen.render();

      function openHelp() {
        overlay.show();
        helpMenu.show();
        helpMenu.focus();
        screen.render();
      }

      function closeHelp() {
        helpMenu.hide();
        overlay.hide();
        list.focus();
        screen.render();
      }

      // Toggle help
      screen.key(['?'], () => {
        if (helpMenu.hidden) openHelp();
        else closeHelp();
      });

      // Copy selected ID
      screen.key(['c', 'C'], () => {
        copySelectedId();
      });

      // Click footer to open help
      help.on('click', (data: any) => {
        try {
          const closedCount = items.filter((item: any) => item.status === 'completed' || item.status === 'deleted').length;
          const rightText = `Closed (${closedCount}): ${showClosed ? 'Shown' : 'Hidden'}`;
          const cols = screen.width as number;
          const rightStart = cols - rightText.length;
          const clickX = data?.x ?? 0;
          if (cols && clickX >= rightStart) {
            showClosed = !showClosed;
            rebuildTree();
            renderListAndDetail(list.selected as number);
            return;
          }
        } catch (err) {
          // ignore
        }
        openHelp();
      });

      // Click help to close
      helpMenu.on('click', () => {
        closeHelp();
      });

      helpClose.on('click', () => {
        closeHelp();
      });

      copyIdButton.on('click', () => {
        copySelectedId();
      });

      // Close help with Esc or q when focused
      helpMenu.key(['escape', 'q'], () => {
        closeHelp();
      });
    });
}
