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

      let items: Item[] = db.list(query);
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
      const screen = blessed.screen({ smartCSR: true, title: 'Worklog TUI', mouse: true });

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
        clickable: true,
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

      const detailOverlay = blessed.box({
        parent: screen,
        top: 0,
        left: 0,
        width: '100%',
        height: '100% - 1',
        hidden: true,
        mouse: true,
        clickable: true,
        style: { bg: 'black' },
      });

      const detailModal = blessed.box({
        parent: screen,
        top: 'center',
        left: 'center',
        width: '70%',
        height: '70%',
        label: ' Item Details ',
        border: { type: 'line' },
        hidden: true,
        tags: true,
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        vi: true,
        mouse: true,
        clickable: true,
        style: { border: { fg: 'green' } },
        content: '',
      });

      const detailClose = blessed.box({
        parent: detailModal,
        top: 0,
        right: 1,
        height: 1,
        width: 3,
        content: '[x]',
        style: { fg: 'red' },
        mouse: true,
      });

      const closeOverlay = blessed.box({
        parent: screen,
        top: 0,
        left: 0,
        width: '100%',
        height: '100% - 1',
        hidden: true,
        mouse: true,
        clickable: true,
        style: { bg: 'black' },
      });

      const closeDialog = blessed.box({
        parent: screen,
        top: 'center',
        left: 'center',
        width: '50%',
        height: 10,
        label: ' Close Work Item ',
        border: { type: 'line' },
        hidden: true,
        tags: true,
        mouse: true,
        clickable: true,
        style: { border: { fg: 'magenta' } },
      });

      const closeDialogText = blessed.box({
        parent: closeDialog,
        top: 1,
        left: 2,
        height: 2,
        width: '100%-4',
        content: 'Close selected item with stage:',
        tags: false,
      });

      const closeDialogOptions = blessed.list({
        parent: closeDialog,
        top: 4,
        left: 2,
        width: '100%-4',
        height: 4,
        keys: true,
        mouse: true,
        style: {
          selected: { bg: 'blue' },
        },
        items: ['Close (in_review)', 'Close (done)', 'Close (deleted)', 'Cancel'],
      });

      const overlay = blessed.box({
        parent: screen,
        top: 0,
        left: 0,
        width: '100%',
        height: '100% - 1',
        hidden: true,
        mouse: true,
        clickable: true,
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
        'Filters:',
        '  I              Show in-progress only',
        '  A              Show open items',
        '  B              Show blocked only',
        '',
        'Refresh:',
        '  R              Reload items from database',
        '',
        'Clipboard:',
        '  C              Copy selected item ID',
        '',
        'Preview:',
        '  P              Open parent in modal',
        '',
        'Close:',
        '  X              Close selected item (in_review/done/deleted)',
        '',
        'Help:',
        '  ?              Toggle this help',
        '',
        'Exit:',
        '  q, Esc, Ctrl-C  Quit'
      ].join('\n');
      helpMenu.setContent(helpText);

      let listLines: string[] = [];
      function renderListAndDetail(selectIndex = 0) {
        const visible = buildVisible();
        const lines = visible.map(n => {
          const indent = '  '.repeat(n.depth);
          const marker = n.hasChildren ? (expanded.has(n.item.id) ? '▾' : '▸') : ' ';
          const title = formatTitleOnly(n.item);
          return `${indent}${marker} ${title} {gray-fg}({underline}${n.item.id}{/underline}){/gray-fg}`;
        });
        listLines = lines;
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
        detail.setContent(decorateIdsForClick(text));
        detail.setScroll(0);
      }

      function stripAnsi(value: string): string {
        return value.replace(/\u001b\[[0-9;]*m/g, '');
      }

      function stripTags(value: string): string {
        return value.replace(/{[^}]+}/g, '');
      }

      function decorateIdsForClick(value: string): string {
        return value.replace(/\b[A-Z][A-Z0-9]+-[A-Z0-9-]+\b/g, '{underline}$&{/underline}');
      }

      function extractIdFromLine(line: string): string | null {
        const plain = stripTags(stripAnsi(line));
        const match = plain.match(/\b[A-Z][A-Z0-9]+-[A-Z0-9-]+\b/);
        return match ? match[0] : null;
      }

      function extractIdAtColumn(line: string, col?: number): string | null {
        const plain = stripTags(stripAnsi(line));
        const matches = Array.from(plain.matchAll(/\b[A-Z][A-Z0-9]+-[A-Z0-9-]+\b/g));
        if (matches.length === 0) return null;
        if (typeof col !== 'number') return matches[0][0];
        for (const match of matches) {
          const start = match.index ?? 0;
          const end = start + match[0].length;
          if (col >= start && col <= end) return match[0];
        }
        return null;
      }

      function getClickRow(box: any, data: any): { row: number; col: number } | null {
        const lpos = box?.lpos;
        const topBase = (lpos?.yi ?? box?.atop ?? 0) + (box?.itop ?? 0);
        const leftBase = (lpos?.xi ?? box?.aleft ?? 0) + (box?.ileft ?? 0);
        const row = (data?.y ?? 0) - topBase;
        const col = (data?.x ?? 0) - leftBase;
        if (row < 0 || col < 0) return null;
        return { row, col };
      }

      function getRenderedLineAtClick(box: any, data: any): string | null {
        const coords = getClickRow(box, data);
        if (!coords) return null;
        const scroll = typeof box.getScroll === 'function' ? (box.getScroll() as number) : 0;
        const lines = (box as any)?._clines?.real || (box as any)?._clines?.fake || box.getContent().split('\n');
        const lineIndex = coords.row + (scroll || 0);
        return lines[lineIndex] ?? null;
      }

      function getRenderedLineAtScreen(box: any, data: any): string | null {
        const lpos = box?.lpos;
        if (!lpos) return null;
        const scroll = typeof box.getScroll === 'function' ? (box.getScroll() as number) : 0;
        const lines = (box as any)?._clines?.real || (box as any)?._clines?.fake || box.getContent().split('\n');
        const base = (lpos.yi ?? 0);
        const offsets = [0, 1, 2, 3, -1, -2];
        for (const off of offsets) {
          const row = (data?.y ?? 0) - base - off;
          if (row < 0) continue;
          const lineIndex = row + (scroll || 0);
          if (lineIndex >= 0 && lineIndex < lines.length) return lines[lineIndex] ?? null;
        }
        return null;
      }

      let suppressDetailCloseUntil = 0;
      function openDetailsForId(id: string) {
        const item = db.get(id);
        if (!item) {
          showToast('Item not found');
          return;
        }
        detailOverlay.show();
        detailModal.setContent(decorateIdsForClick(humanFormatWorkItem(item, db, 'full')));
        detailModal.setScroll(0);
        detailModal.show();
        detailOverlay.setFront();
        detailModal.setFront();
        detailModal.focus();
        suppressDetailCloseUntil = Date.now() + 200;
        screen.render();
      }

      function openDetailsFromClick(line: string | null) {
        if (!line) return;
        const id = extractIdFromLine(line);
        if (!id) return;
        openDetailsForId(id);
      }

      function closeDetails() {
        detailModal.hide();
        detailOverlay.hide();
        list.focus();
        screen.render();
      }

      function openCloseDialog() {
        const item = getSelectedItem();
        if (item) {
          closeDialogText.setContent(`Close: ${item.title}\nID: ${item.id}`);
        } else {
          closeDialogText.setContent('Close selected item with stage:');
        }
        closeOverlay.show();
        closeDialog.show();
        closeOverlay.setFront();
        closeDialog.setFront();
        closeDialogOptions.select(0);
        closeDialogOptions.focus();
        screen.render();
      }

      function closeCloseDialog() {
        closeDialog.hide();
        closeOverlay.hide();
        list.focus();
        screen.render();
      }

      function isInside(box: any, x: number, y: number): boolean {
        const lpos = box?.lpos;
        if (!lpos) return false;
        return x >= lpos.xi && x <= lpos.xl && y >= lpos.yi && y <= lpos.yl;
      }

      function openParentPreview() {
        const item = getSelectedItem();
        const parentId = item?.parentId;
        if (!parentId) {
          showToast('No parent');
          return;
        }
        openDetailsForId(parentId);
      }

      function refreshFromDatabase(preferredIndex?: number) {
        const selected = getSelectedItem();
        const selectedId = selected?.id;
        const query: any = {};
        if (options.inProgress) query.status = 'in-progress';
        items = db.list(query);
        const nextVisible = options.all
          ? items.slice()
          : items.filter((item: any) => item.status !== 'completed' && item.status !== 'deleted');
        if (nextVisible.length === 0) {
          list.setItems([]);
          detail.setContent('');
          screen.render();
          return;
        }
        rebuildTree();
        const visible = buildVisible();
        let nextIndex = 0;
        if (typeof preferredIndex === 'number') {
          nextIndex = Math.max(0, Math.min(preferredIndex, visible.length - 1));
        } else if (selectedId) {
          const found = visible.findIndex(n => n.item.id === selectedId);
          if (found >= 0) nextIndex = found;
        }
        renderListAndDetail(nextIndex);
      }

      function setFilterNext(filter: 'in-progress' | 'open' | 'blocked') {
        options.inProgress = false;
        options.all = false;
        showClosed = false;
        const selected = getSelectedItem();
        const selectedId = selected?.id;
        const query: any = {};
        if (filter === 'in-progress') query.status = 'in-progress';
        if (filter === 'blocked') query.status = 'blocked';
        items = db.list(query);
        const nextVisible = items.filter((item: any) => item.status !== 'completed' && item.status !== 'deleted');
        if (nextVisible.length === 0) {
          list.setItems([]);
          detail.setContent('');
          screen.render();
          return;
        }
        rebuildTree();
        const visible = buildVisible();
        let nextIndex = 0;
        if (selectedId) {
          const found = visible.findIndex(n => n.item.id === selectedId);
          if (found >= 0) nextIndex = found;
        }
        renderListAndDetail(nextIndex);
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

      function closeSelectedItem(stage: 'in_review' | 'done' | 'deleted') {
        const item = getSelectedItem();
        if (!item) {
          showToast('No item selected');
          return;
        }
        const currentIndex = list.selected as number;
        const nextIndex = Math.max(0, currentIndex - 1);
        try {
          const updates = stage === 'deleted'
            ? { status: 'deleted' as const, stage: '' }
            : { status: 'completed' as const, stage };
          const updated = db.update(item.id, updates);
          if (!updated) {
            showToast('Close failed');
            return;
          }
          if (stage === 'deleted') showToast('Closed (deleted)');
          else showToast(stage === 'done' ? 'Closed (done)' : 'Closed (in_review)');
          refreshFromDatabase(nextIndex);
        } catch (err) {
          showToast('Close failed');
        }
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

      list.on('click', (data: any) => {
        const coords = getClickRow(list as any, data);
        if (!coords) return;
        const scroll = list.getScroll() as number;
        const lineIndex = coords.row + (scroll || 0);
        const line = listLines[lineIndex];
        if (!line) return;
        const id = extractIdAtColumn(line, coords.col);
        if (id) openDetailsForId(id);
      });

      detail.on('click', (data: any) => {
        openDetailsFromClick(getRenderedLineAtClick(detail as any, data));
      });

      detailModal.on('click', (data: any) => {
        openDetailsFromClick(getRenderedLineAtClick(detailModal as any, data));
      });

      detail.on('mouse', (data: any) => {
        if (data?.action === 'click') {
          openDetailsFromClick(getRenderedLineAtClick(detail as any, data));
        }
      });

      detail.on('mousedown', (data: any) => {
        openDetailsFromClick(getRenderedLineAtScreen(detail as any, data));
      });

      detail.on('mouseup', (data: any) => {
        openDetailsFromClick(getRenderedLineAtScreen(detail as any, data));
      });

      detailModal.on('mouse', (data: any) => {
        if (data?.action === 'click') {
          openDetailsFromClick(getRenderedLineAtClick(detailModal as any, data));
        }
      });

      detailClose.on('click', () => {
        closeDetails();
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
        if (!closeDialog.hidden) {
          closeCloseDialog();
          return;
        }
        if (!detailModal.hidden) {
          closeDetails();
          return;
        }
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
        overlay.setFront();
        helpMenu.setFront();
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

      // Open parent preview
      screen.key(['p', 'P'], () => {
        openParentPreview();
      });

      // Close selected item
      screen.key(['x', 'X'], () => {
        if (detailModal.hidden && helpMenu.hidden && closeDialog.hidden) {
          openCloseDialog();
        }
      });

      // Refresh from database
      screen.key(['r', 'R'], () => {
        refreshFromDatabase();
      });

      // Filter shortcuts
      screen.key(['i', 'I'], () => {
        setFilterNext('in-progress');
      });

      screen.key(['a', 'A'], () => {
        setFilterNext('open');
      });

      screen.key(['b', 'B'], () => {
        setFilterNext('blocked');
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

      overlay.on('click', () => {
        closeHelp();
      });

      copyIdButton.on('click', () => {
        copySelectedId();
      });

      // Close help with Esc or q when focused
      helpMenu.key(['escape', 'q'], () => {
        closeHelp();
      });

      closeOverlay.on('click', () => {
        closeCloseDialog();
      });

      closeDialogOptions.on('select', (_el: any, idx: number) => {
        if (idx === 0) closeSelectedItem('in_review');
        if (idx === 1) closeSelectedItem('done');
        if (idx === 2) closeSelectedItem('deleted');
        closeCloseDialog();
      });

      closeDialog.key(['escape'], () => {
        closeCloseDialog();
      });

      closeDialogOptions.key(['escape'], () => {
        closeCloseDialog();
      });

      detailOverlay.on('click', () => {
        closeDetails();
      });

      detailModal.key(['escape'], () => {
        closeDetails();
      });

      screen.on('mouse', (data: any) => {
        if (!data || !['mousedown', 'mouseup', 'click'].includes(data.action)) return;
        if (!detailModal.hidden && Date.now() < suppressDetailCloseUntil) return;
        if (!detailModal.hidden && !isInside(detailModal, data.x, data.y)) {
          closeDetails();
          return;
        }
        if (!helpMenu.hidden && !isInside(helpMenu, data.x, data.y)) {
          closeHelp();
          return;
        }
        if (detailModal.hidden && helpMenu.hidden && isInside(detail, data.x, data.y)) {
          if (data.action === 'click' || data.action === 'mousedown') {
            openDetailsFromClick(getRenderedLineAtScreen(detail as any, data));
          }
        }
      });
    });
}
