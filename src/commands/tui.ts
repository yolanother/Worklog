/**
 * TUI command - interactive tree view for work items
 */

import type { PluginContext } from '../plugin-types.js';
// Declare module to avoid missing type errors in this codebase (runtime dependency exists)
declare module 'blessed';
import blessed from 'blessed';
import { humanFormatWorkItem, sortByPriorityAndDate } from './helpers.js';

type Item = any;

export default function register(ctx: PluginContext): void {
  const { program, utils } = ctx;

  program
    .command('tui')
    .description('Interactive TUI: browse work items in a tree (use --in-progress to show only in-progress)')
    .option('--in-progress', 'Show only in-progress items')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((options: { inProgress?: boolean; prefix?: string }) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);

      const query: any = {};
      if (options.inProgress) query.status = 'in-progress';

      const items: Item[] = db.list(query);
      if (items.length === 0) {
        console.log('No work items found');
        return;
      }

      // Build parent -> children map
      const itemsById = new Map<string, Item>();
      for (const it of items) itemsById.set(it.id, it);

      const childrenMap = new Map<string, Item[]>();
      for (const it of items) {
        const pid = it.parentId;
        if (pid && itemsById.has(pid)) {
          const arr = childrenMap.get(pid) || [];
          arr.push(it);
          childrenMap.set(pid, arr);
        }
      }

      // Find roots (parentId null or parent not present in current set)
      const roots = items.filter(it => !it.parentId || !itemsById.has(it.parentId)).slice();
      roots.sort(sortByPriorityAndDate);

      // Track expanded state by id
      const expanded = new Set<string>();
      // Default expand roots
      for (const r of roots) expanded.add(r.id);

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

      const help = blessed.box({
        parent: screen,
        bottom: 0,
        left: 0,
        height: 1,
        width: '100%',
        content: 'Arrows: move • Right/Enter: expand • Left: collapse • q/Esc: quit',
        style: { fg: 'grey' },
      });

      function renderListAndDetail(selectIndex = 0) {
        const visible = buildVisible();
        const lines = visible.map(n => {
          const indent = '  '.repeat(n.depth);
          const marker = n.hasChildren ? (expanded.has(n.item.id) ? '▾' : '▸') : ' ';
          const title = typeof n.item.title === 'string' ? n.item.title : String(n.item.id);
          return `${indent}${marker} ${title} (${n.item.id})`;
        });
        list.setItems(lines);
        // Keep selection in bounds
        const idx = Math.max(0, Math.min(selectIndex, lines.length - 1));
        list.select(idx);
        updateDetailForIndex(idx, visible);
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

      // Initial render
      renderListAndDetail(0);

      // Event handlers
      list.on('select', (_el: any, idx: number) => {
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
        const idx = list.selected as number;
        const visible = buildVisible();
        updateDetailForIndex(idx, visible);
        screen.render();
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
      });

      // Quit keys
      screen.key(['q', 'C-c', 'escape'], () => {
        screen.destroy();
        process.exit(0);
      });

      // Focus list to receive keys
      list.focus();
      screen.render();
    });
}
