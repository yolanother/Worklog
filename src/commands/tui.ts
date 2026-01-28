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
import { spawnSync, spawn, ChildProcess } from 'child_process';
import * as http from 'http';

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
      const isVerbose = !!program.opts().verbose;
      const debugLog = (message: string) => {
        if (!isVerbose) return;
        console.error(`[tui:opencode] ${message}`);
      };

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
          const val = j[prefix || 'default'] || null;
          debugLog(`loadPersistedState prefix=${String(prefix || 'default')} path=${statePath} present=${val !== null}`);
          return val;
        } catch (err) {
          debugLog(`loadPersistedState error: ${String(err)}`);
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
          try {
            const keys = Object.keys(state || {}).join(',');
            debugLog(`savePersistedState prefix=${String(prefix || 'default')} path=${statePath} keys=[${keys}]`);
          } catch (_) {}
        } catch (err) {
          debugLog(`savePersistedState error: ${String(err)}`);
          // ignore persistence errors but log for debugging
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

      const updateOverlay = blessed.box({
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

      const updateDialog = blessed.box({
        parent: screen,
        top: 'center',
        left: 'center',
        width: '50%',
        height: 14,
        label: ' Update Work Item ',
        border: { type: 'line' },
        hidden: true,
        tags: true,
        mouse: true,
        clickable: true,
        style: { border: { fg: 'magenta' } },
      });

      const updateDialogText = blessed.box({
        parent: updateDialog,
        top: 1,
        left: 2,
        height: 2,
        width: '100%-4',
        content: 'Update selected item stage:',
        tags: false,
      });

      // Stages offered here — keep list conservative; this UI is intended to grow.
      const updateDialogOptions = blessed.list({
        parent: updateDialog,
        top: 4,
        left: 2,
        width: '100%-4',
        height: 8,
        keys: true,
        mouse: true,
        style: {
          selected: { bg: 'blue' },
        },
        items: ['idea', 'prd_complete', 'plan_complete', 'in_progress', 'in_review', 'done', 'blocked', 'Cancel'],
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

      // Opencode prompt dialog
      const opencodeOverlay = blessed.box({
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

      // Larger dialog and textbox for multi-line prompts
      const opencodeDialog = blessed.box({
        parent: screen,
        top: 'center',
        left: 'center',
        width: '80%',
        height: '60%',
        label: ' Run opencode ',
        border: { type: 'line' },
        hidden: true,
        tags: true,
        mouse: true,
        clickable: true,
        style: { border: { fg: 'yellow' } },
      });
      
      // Server status indicator (footer centered)
      const serverStatusBox = blessed.box({
        parent: screen,
        bottom: 0,
        left: 'center',
        width: 1,
        height: 1,
        content: '',
        tags: true,
        align: 'center',
        style: { fg: 'white' }
      });

      // Use a textarea so multi-line input works and Enter inserts newlines
      const opencodeText = blessed.textarea({
        parent: opencodeDialog,
        top: 1,
        left: 2,
        width: '100%-4',
        height: '100%-6',
        inputOnFocus: true,
        keys: true,
        vi: false,
        mouse: true,
        clickable: true,
        scrollable: true,     // Enable scrolling
        alwaysScroll: true,   // Always show scrollbar when needed
        border: { type: 'line' },
        style: { focus: { border: { fg: 'green' } } },
      });
      const opencodeTextDefaults = {
        top: 1,
        left: 2,
        width: '100%-4',
        height: '100%-6',
        border: { type: 'line' }
      };

      // Command autocomplete support
      const AVAILABLE_COMMANDS = [
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
        '/revert'
      ];

      // Autocomplete state
      let currentSuggestion = '';
      let isCommandMode = false;
      let userTypedText = '';
      let isWaitingForResponse = false; // Track if we're waiting for OpenCode response

      // Create a text element to show the suggestion below the input
      const suggestionHint = blessed.text({
        parent: opencodeDialog,
        top: '100%-4',
        left: 2,
        width: '100%-4',
        height: 1,
        tags: true,
        style: {
          fg: 'gray'
        },
        content: ''
      });

      function applyCommandSuggestion(target: any) {
        if (isCommandMode && currentSuggestion) {
          target.setValue(currentSuggestion + ' ');
          if (target.moveCursor) {
            target.moveCursor(currentSuggestion.length + 1);
          }
          currentSuggestion = '';
          isCommandMode = false;
          suggestionHint.setContent('');
          screen.render();
          return true;
        }
        return false;
      }

      function updateAutocomplete() {
        const value = opencodeText.getValue ? opencodeText.getValue() : '';
        userTypedText = value;
        const lines = value.split('\n');
        const firstLine = lines[0];
        const commandLine = firstLine;
        
        // Check if we're in command mode (first line starts with '/')
        if (commandLine.startsWith('/') && lines.length === 1) {
          isCommandMode = true;
          const input = commandLine.toLowerCase();
          
          // Find the best matching command
          const matches = AVAILABLE_COMMANDS.filter(cmd => 
            cmd.toLowerCase().startsWith(input)
          );
          
          if (matches.length > 0 && matches[0] !== input) {
            currentSuggestion = matches[0];
            // Show suggestion as hint text below the input
            suggestionHint.setContent(`{gray-fg}↳ ${currentSuggestion}{/gray-fg}`);
          } else {
            currentSuggestion = '';
            suggestionHint.setContent('');
          }
        } else {
          isCommandMode = false;
          currentSuggestion = '';
          suggestionHint.setContent('');
        }
        screen.render();
      }

      // Hook into textarea input to update autocomplete
      opencodeText.on('keypress', function(this: any, _ch: any, _key: any) {
        // Handle Ctrl+Enter for newline insertion  
        if (_key && _key.name === 'linefeed') {
          // Get CURRENT value BEFORE the textarea adds the newline
          const currentValue = this.getValue ? this.getValue() : '';
          const currentLines = currentValue.split('\n').length;
          
          // Calculate what the height WILL BE after the newline
          const futureLines = currentLines + 1;
          const desiredHeight = Math.min(Math.max(MIN_INPUT_HEIGHT, futureLines + 2), inputMaxHeight());
          
          // Resize the dialog FIRST
          opencodeDialog.height = desiredHeight;
          opencodeText.height = desiredHeight - 2;
          
          if (opencodePane) {
            opencodePane.bottom = desiredHeight + FOOTER_HEIGHT;
            opencodePane.height = paneHeight();
          }
          
          // Render with new size
          screen.render();
          
          // After the event loop completes and blessed inserts the newline, scroll to bottom
          setImmediate(() => {
            // Scroll to bottom to keep cursor visible
            if (this.setScrollPerc) {
              this.setScrollPerc(100);
            }
            
            screen.render();
          });
          
          // Don't call updateOpencodeInputLayout as we've handled the resize
          return;
        }
        
        // Update immediately on keypress for better responsiveness
        process.nextTick(() => {
          updateAutocomplete();
          updateOpencodeInputLayout();
        });
      });

      const opencodeSend = blessed.box({
        parent: opencodeDialog,
        bottom: 0,
        right: 12,
        height: 1,
        width: 10,
        tags: true,
        content: '[ {underline}S{/underline}end ]',
        mouse: true,
        clickable: true,
        style: { fg: 'white', bg: 'green' },
      });

      const opencodeCancel = blessed.box({
        parent: opencodeDialog,
        top: 0,
        right: 1,
        height: 1,
        width: 3,
        content: '[x]',
        style: { fg: 'red' },
        mouse: true,
        clickable: true,
      });

      // Active opencode pane/process tracking
      let opencodePane: any = null;

      const MIN_INPUT_HEIGHT = 3;  // Minimum height for input dialog (single line + borders)
      const MAX_INPUT_LINES = 7;   // Maximum visible lines of input text
      const FOOTER_HEIGHT = 1;
      const availableHeight = () => Math.max(10, (screen.height as number) - FOOTER_HEIGHT);
      const inputMaxHeight = () => Math.min(MAX_INPUT_LINES + 2, Math.floor(availableHeight() * 0.3)); // +2 for borders
      const paneHeight = () => Math.max(6, Math.floor(availableHeight() * 0.5));

      function updateOpencodeInputLayout() {
        if (!opencodeText.getValue) return;
        const value = opencodeText.getValue();
        const lines = value.split('\n').length;
        // Dialog height = content lines + 2 for borders
        const desiredHeight = Math.min(Math.max(MIN_INPUT_HEIGHT, lines + 2), inputMaxHeight());
        opencodeDialog.height = desiredHeight;
        
        // Always use compact mode settings
        (opencodeText as any).border = false;
        opencodeText.top = 0;  // Position at top of dialog interior
        opencodeText.left = 0;  // Position at left of dialog interior
        opencodeText.width = '100%-2';  // Leave 1 char padding on each side
        opencodeText.height = desiredHeight - 2;  // Height minus top and bottom borders
        // Reset styles by clearing properties without replacing the style object
        if (!opencodeText.style) {
          opencodeText.style = {};
        }
        // Clear border and focus styles without replacing the entire style object
        if (opencodeText.style.border) {
          Object.keys(opencodeText.style.border).forEach(key => {
            delete opencodeText.style.border[key];
          });
        }
        if (opencodeText.style.focus) {
          if (opencodeText.style.focus.border) {
            Object.keys(opencodeText.style.focus.border).forEach(key => {
              delete opencodeText.style.focus.border[key];
            });
          }
        }
        
        if (opencodePane) {
          opencodePane.bottom = desiredHeight + FOOTER_HEIGHT;
          opencodePane.height = paneHeight();
          // No longer need to update close button position since it's in the label
        }
        screen.render();
      }

      async function openOpencodeDialog() {
        // Always use compact mode at bottom
        opencodeDialog.setLabel(' prompt [esc] ');
        opencodeDialog.top = undefined;  // Clear the center positioning
        opencodeDialog.left = 0;  // Clear the center positioning
        opencodeDialog.bottom = FOOTER_HEIGHT;
        opencodeDialog.width = '100%';
        opencodeDialog.height = MIN_INPUT_HEIGHT;
        
        // Adjust button positioning for compact mode
        suggestionHint.hide();
        opencodeSend.hide();  // Hide the send button
        opencodeCancel.hide();  // Hide the old cancel button since it's in the label now
        // Remove textarea border since dialog has the border
        (opencodeText as any).border = false;
        opencodeText.top = 0;  // Position at top of dialog interior
        opencodeText.left = 0;  // Position at left of dialog interior  
        opencodeText.width = '100%-2';  // Leave 1 char padding on each side
        opencodeText.height = MIN_INPUT_HEIGHT - 2;  // Height minus borders
        // Reset styles by clearing properties without replacing the style object
        if (!opencodeText.style) {
          opencodeText.style = {};
        }
        // Clear border and focus styles without replacing the entire style object
        if (opencodeText.style.border) {
          Object.keys(opencodeText.style.border).forEach(key => {
            delete opencodeText.style.border[key];
          });
        }
        if (opencodeText.style.focus) {
          if (opencodeText.style.focus.border) {
            Object.keys(opencodeText.style.focus.border).forEach(key => {
              delete opencodeText.style.focus.border[key];
            });
          }
        }
        
        opencodeDialog.show();
        opencodeDialog.setFront();
        
        // Clear previous contents and focus textbox so typed characters appear
        try { if (typeof opencodeText.clearValue === 'function') opencodeText.clearValue(); } catch (_) {}
        try { if (typeof opencodeText.setValue === 'function') opencodeText.setValue(''); } catch (_) {}
        
        // Reset autocomplete state
        currentSuggestion = '';
        isCommandMode = false;
        userTypedText = '';
        suggestionHint.setContent('');
        opencodeText.focus();
        // Don't move cursor since there's no prompt anymore
        updateOpencodeInputLayout();
        
        // Start the server if not already running
        await startOpencodeServer();
        
        // Open the response pane automatically
        ensureOpencodePane();
        
        screen.render();
      }

      function closeOpencodeDialog() {
        // In compact mode, don't hide the dialog - it stays as the input bar
        // Just clear the input and keep it open
        try { if (typeof opencodeText.clearValue === 'function') opencodeText.clearValue(); } catch (_) {}
        try { if (typeof opencodeText.setValue === 'function') opencodeText.setValue(''); } catch (_) {}
        screen.render();
      }

      function closeOpencodePane() {
        if (opencodePane) {
          opencodePane.hide();
        }
        screen.render();
      }

      // OpenCode server management
      let opencodeServerProc: ChildProcess | null = null;
      let opencodeServerPort = 0;
      let opencodeServerStatus: 'stopped' | 'starting' | 'running' | 'error' = 'stopped';
      const OPENCODE_SERVER_PORT = parseInt(process.env.OPENCODE_SERVER_PORT || '9999', 10);
      
      function updateServerStatus() {
        let statusText = '';
        let statusColor = 'white';
        
        switch (opencodeServerStatus) {
          case 'stopped':
            statusText = '[-] Server stopped';
            statusColor = 'gray';
            break;
          case 'starting':
            statusText = '[~] Starting...';
            statusColor = 'yellow';
            break;
          case 'running':
            statusText = `[OK] Port: ${opencodeServerPort}`;
            statusColor = 'green';
            break;
          case 'error':
            statusText = '[X] Server error';
            statusColor = 'red';
            break;
        }
        const taggedContent = `{${statusColor}-fg}${statusText}{/}`;
        const plainLength = statusText.length;
        serverStatusBox.setContent(taggedContent);
        serverStatusBox.width = Math.max(1, plainLength + 2);
        screen.render();
      }
      
      async function checkOpencodeServer(port: number): Promise<boolean> {
        return new Promise((resolve) => {
          const req = http.request({
            hostname: '127.0.0.1',
            port,
            path: '/global/health',
            method: 'GET',
            timeout: 1000,
          }, (res) => {
            const ok = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300;
            res.resume();
            debugLog(`health status=${res.statusCode ?? 'unknown'} ok=${ok}`);
            resolve(ok);
          });

          req.on('timeout', () => {
            req.destroy();
            debugLog('health check timed out');
            resolve(false);
          });

          req.on('error', () => {
            debugLog('health check error');
            resolve(false);
          });

          req.end();
        });
      }
      
      async function startOpencodeServer(): Promise<boolean> {
        // Check if server is already running on the configured port
        const isRunning = await checkOpencodeServer(OPENCODE_SERVER_PORT);
        if (isRunning) {
          opencodeServerStatus = 'running';
          opencodeServerPort = OPENCODE_SERVER_PORT;
          updateServerStatus();
          return true;
        }
        
        opencodeServerStatus = 'starting';
        updateServerStatus();
        showToast('Starting OpenCode server...');
        
        try {
          // Start the API server
          debugLog(`starting opencode server port=${OPENCODE_SERVER_PORT}`);
          opencodeServerProc = spawn('opencode', ['serve', '--port', String(OPENCODE_SERVER_PORT)], {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false
          });

          if (opencodeServerProc.stdout) {
            opencodeServerProc.stdout.on('data', (chunk) => {
              debugLog(`server stdout: ${chunk.toString().trim()}`);
            });
          }
          if (opencodeServerProc.stderr) {
            opencodeServerProc.stderr.on('data', (chunk) => {
              debugLog(`server stderr: ${chunk.toString().trim()}`);
            });
          }
          opencodeServerProc.on('exit', (code, signal) => {
            debugLog(`server exit code=${code ?? 'null'} signal=${signal ?? 'null'}`);
          });
          
          opencodeServerPort = OPENCODE_SERVER_PORT;
          
          // Give the server time to start
          let retries = 10;
          while (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const isUp = await checkOpencodeServer(OPENCODE_SERVER_PORT);
            if (isUp) {
              opencodeServerStatus = 'running';
              updateServerStatus();
              showToast('OpenCode server started');
              return true;
            }
            retries--;
          }
          
          // Server didn't start in time
          opencodeServerStatus = 'error';
          updateServerStatus();
          showToast('OpenCode server failed to start');
          if (opencodeServerProc) {
            opencodeServerProc.kill();
            opencodeServerProc = null;
          }
          return false;
          
        } catch (err) {
          opencodeServerStatus = 'error';
          updateServerStatus();
          showToast(`Failed to start OpenCode server: ${String(err)}`);
          return false;
        }
      }
      
      function stopOpencodeServer() {
        if (opencodeServerProc) {
          try {
            opencodeServerProc.kill();
            opencodeServerProc = null;
            opencodeServerStatus = 'stopped';
            updateServerStatus();
          } catch (err) {
            // ignore
          }
        }
      }

      // Store current session ID and associated work-item id for server communication
      let currentSessionId: string | null = null;
      let currentSessionWorkItemId: string | null = null;
      
      // Function to communicate with OpenCode server via HTTP API with SSE streaming
      async function sendPromptToServer(
        prompt: string, 
        pane: any, 
        indicator: any, 
        inputField: any,
        onComplete?: () => void
      ): Promise<void> {
        const serverUrl = `http://localhost:${opencodeServerPort}`;
        debugLog(`send prompt length=${prompt.length}`);
        
        return new Promise((resolve, reject) => {
          // First, create or reuse a session
          // Prefer using the currently-selected work item ID as the OpenCode session ID
          const preferredSessionId = (typeof getSelectedItem === 'function' && getSelectedItem()) ? getSelectedItem()?.id : null;
          // If we already have a session that matches the preferred ID, reuse it.
          const sessionPromise = (currentSessionId && preferredSessionId && currentSessionId === preferredSessionId)
            ? Promise.resolve(currentSessionId)
            : createSession(serverUrl, preferredSessionId);
            
           sessionPromise
             .then(async (sessionObj) => {
               // sessionObj may be a string (older behaviour) or an object { id, workItemId, existing }
               const sessionId = typeof sessionObj === 'string' ? sessionObj : sessionObj.id;
               const sessionWorkItemId = typeof sessionObj === 'string' ? null : (sessionObj.workItemId || null);
               const sessionExisting = typeof sessionObj === 'object' && !!(sessionObj as any).existing;
               currentSessionId = sessionId;
               currentSessionWorkItemId = sessionWorkItemId;
               // Update pane label to show the associated work-item id when available
               if (pane.setLabel) {
                 if (currentSessionWorkItemId) {
                   pane.setLabel(` opencode - Work Item: ${currentSessionWorkItemId} [esc] `);
                 } else {
                   pane.setLabel(` opencode - Session: ${sessionId} [esc] `);
                 }
               }

                // If we found an existing session, load its history into the pane first
                if (sessionExisting) {
                  try {
                    const history = await getSessionMessages(sessionId);
                    if (pane.setContent) {
                     let histText = '';
                     for (const m of history) {
                       const role = m.info?.role || 'unknown';
                       histText += `{gray-fg}[${role}]{/}\n`;
                       const parts = m.parts || [];
                       for (const p of parts) {
                         if (p.type === 'text' && p.text) {
                           histText += `${p.text}\n`;
                         } else if (p.type === 'tool-result' && p.content) {
                           histText += `{green-fg}[Tool Result]{/}\n`;
                           histText += `${p.content}\n`;
                         } else if (p.type === 'tool-use' && p.tool) {
                           histText += `{yellow-fg}[Tool: ${p.tool.name}]{/}\n`;
                           if (p.tool.description) histText += `${p.tool.description}\n`;
                         }
                       }
                       histText += '\n';
                     }
                      pane.setContent(histText + '\n');
                    }
                  } catch (err) {
                    debugLog(`failed to load session history: ${String(err)}`);
                  }
                } else {
                  // No existing server session was found/used. If we have a locally
                  // persisted history for this work-item, surface it read-only so
                  // the user can inspect prior messages without auto-replaying them.
                  try {
                    const localHist = (sessionObj as any)?.localHistory;
                    if (localHist && Array.isArray(localHist) && localHist.length > 0) {
                      debugLog(`rendering local persisted history messages=${localHist.length} for workitem=${String(sessionWorkItemId)}`);
                      if (pane.setContent) {
                        let histText = '{yellow-fg}[Local persisted history - read-only]{/}\n\n';
                        for (const m of localHist) {
                          const role = m.info?.role || 'unknown';
                          histText += `{gray-fg}[${role}]{/}\n`;
                          const parts = m.parts || [];
                          for (const p of parts) {
                            if (p.type === 'text' && p.text) {
                              histText += `${p.text}\n`;
                            } else if (p.type === 'tool-result' && p.content) {
                              histText += `{green-fg}[Tool Result]{/}\n`;
                              histText += `${p.content}\n`;
                            } else if (p.type === 'tool-use' && p.tool) {
                              histText += `{yellow-fg}[Tool: ${p.tool.name}]{/}\n`;
                              if (p.tool.description) histText += `${p.tool.description}\n`;
                            }
                          }
                          histText += '\n';
                        }
                        // Add a clear separator so the user's new prompt is visually separated
                        histText += '{yellow-fg}[End of local history]{/}\n\n';
                        pane.setContent(histText + '\n');
                      }
                    }
                  } catch (err) {
                    debugLog(`failed to render local history: ${String(err)}`);
                  }
                }
                // If we rendered a local history above (server session wasn't reused)
                // offer the user a safe restore flow: Show only / Restore via summary / Full replay.
                let finalPrompt = prompt;
                if (!sessionExisting) {
                  try {
                    const localHist = (sessionObj as any)?.localHistory;
                    if (localHist && Array.isArray(localHist) && localHist.length > 0) {
                      // Present a small modal to ask how to proceed.
                      const choice = await new Promise<number>((resolve) => {
                        const restoreOverlay = blessed.box({ parent: screen, top: 0, left: 0, width: '100%', height: '100% - 1', mouse: true, clickable: true, style: { bg: 'black' } });
                        const restoreDialog = blessed.box({ parent: screen, top: 'center', left: 'center', width: '60%', height: 10, label: ' Restore session ', border: { type: 'line' }, tags: true, mouse: true, clickable: true });
                        const text = blessed.box({ parent: restoreDialog, top: 1, left: 2, width: '100%-4', height: 3, content: 'Local persisted conversation found. How would you like to proceed?', tags: false });
                        const opts = blessed.list({ parent: restoreDialog, top: 4, left: 2, width: '100%-4', height: 4, keys: true, mouse: true, items: ['Show only (no restore)', 'Restore via summary (recommended)', 'Full replay (danger)', 'Cancel'], style: { selected: { bg: 'blue' } } });
                        opts.select(0);
                        restoreOverlay.setFront(); restoreDialog.setFront(); opts.focus(); screen.render();
                        function cleanup() { try { restoreDialog.hide(); restoreOverlay.hide(); restoreDialog.destroy(); restoreOverlay.destroy(); } catch (_) {} }
                        opts.on('select', (_el: any, idx: number) => { cleanup(); resolve(idx); });
                        // Allow escape to cancel
                        restoreDialog.key(['escape'], () => { cleanup(); resolve(3); });
                      });

                      if (choice === 1) {
                        // Restore via summary: generate editable summary, then prepend to prompt
                        const generated = generateSummaryFromHistory(localHist);
                        const edited = await new Promise<string>((resolve) => {
                          const overlay = blessed.box({ parent: screen, top: 0, left: 0, width: '100%', height: '100% - 1', mouse: true, clickable: true, style: { bg: 'black' } });
                          const dialog = blessed.box({ parent: screen, top: 'center', left: 'center', width: '80%', height: '60%', label: ' Edit summary (sent as context) ', border: { type: 'line' }, tags: true, mouse: true, clickable: true });
                          const ta = blessed.textarea({ parent: dialog, top: 1, left: 1, width: '100%-2', height: '100%-4', inputOnFocus: true, keys: true, mouse: true, scrollable: true, alwaysScroll: true });
                          try { if (typeof ta.setValue === 'function') ta.setValue(generated); } catch (_) {}
                          const btns = blessed.list({ parent: dialog, bottom: 0, left: 1, height: 1, width: '100%-2', items: ['Send summary', 'Cancel'], keys: true, mouse: true, style: { selected: { bg: 'blue' } } });
                          btns.select(0);
                          overlay.setFront(); dialog.setFront(); ta.focus(); screen.render();
                          function cleanup() { try { dialog.hide(); overlay.hide(); dialog.destroy(); overlay.destroy(); } catch (_) {} }
                          btns.on('select', (_el: any, idx: number) => {
                            const val = ta.getValue ? ta.getValue() : generated;
                            cleanup(); if (idx === 0) resolve(val); else resolve('');
                          });
                          dialog.key(['escape'], () => { cleanup(); resolve(''); });
                        });
                        if (edited && edited.trim()) {
                          finalPrompt = `Context summary (user-edited):\n${edited}\n\nUser prompt:\n${prompt}`;
                        }
                      } else if (choice === 2) {
                        // Full replay chosen — confirm with the user
                        const confirm = await new Promise<boolean>((resolve) => {
                          const overlay = blessed.box({ parent: screen, top: 0, left: 0, width: '100%', height: '100% - 1', mouse: true, clickable: true, style: { bg: 'black' } });
                          const dialog = blessed.box({ parent: screen, top: 'center', left: 'center', width: '60%', height: 8, label: ' Confirm full replay ', border: { type: 'line' }, tags: true, mouse: true, clickable: true });
                          const text = blessed.box({ parent: dialog, top: 1, left: 2, width: '100%-4', height: 3, content: '{red-fg}Warning:{/red-fg} Full replay may re-run tool calls or side-effects. Type YES to confirm, or select Cancel.', tags: true });
                          const input = blessed.textbox({ parent: dialog, bottom: 0, left: 2, width: '50%', height: 1, inputOnFocus: true });
                          const cancelBtn = blessed.box({ parent: dialog, bottom: 0, right: 2, height: 1, width: 8, content: '[Cancel]', mouse: true, clickable: true, style: { fg: 'yellow' } });
                          overlay.setFront(); dialog.setFront(); input.focus(); screen.render();
                          cancelBtn.on('click', () => { try { dialog.hide(); overlay.hide(); dialog.destroy(); overlay.destroy(); } catch(_){}; resolve(false); });
                          input.on('submit', (val: string) => { try { dialog.hide(); overlay.hide(); dialog.destroy(); overlay.destroy(); } catch(_){}; resolve((val||'').trim() === 'YES'); });
                          dialog.key(['escape'], () => { try { dialog.hide(); overlay.hide(); dialog.destroy(); overlay.destroy(); } catch(_){}; resolve(false); });
                        });
                        if (confirm) {
                          // build a raw replay string — join textual parts
                          const allText: string[] = [];
                          for (const m of localHist) {
                            const parts = m.parts || [];
                            for (const p of parts) {
                              if (p.type === 'text' && p.text) allText.push(p.text);
                              else if (p.type === 'tool-result' && p.content) allText.push('[Tool Result]\n' + String(p.content));
                            }
                          }
                          const replayText = allText.join('\n\n---\n\n');
                          finalPrompt = `Full replay of previous conversation:\n${replayText}\n\nUser prompt:\n${prompt}`;
                        }
                      }
                    }
                  } catch (err) {
                    debugLog(`restore flow error: ${String(err)}`);
                  }
                }

                pane.pushLine('');
                // Show the user's short prompt in the pane (finalPrompt may contain extra context)
                pane.pushLine(`{gray-fg}${prompt}{/}`);
                pane.pushLine('');
               // Ensure we scroll to the bottom after adding content
               if (pane.setScrollPerc) {
                 pane.setScrollPerc(100);
               }
               screen.render();
               debugLog(`session id=${sessionId} workitem=${String(currentSessionWorkItemId)}`);

               // Use async prompt endpoint for better streaming
                const messageData = JSON.stringify({
                  parts: [{ type: 'text', text: finalPrompt }]
                });

               // First, send the prompt asynchronously
               const sendOptions = {
                 hostname: 'localhost',
                 port: opencodeServerPort,
                 path: `/session/${sessionId}/prompt_async`,
                 method: 'POST',
                 headers: {
                   'Content-Type': 'application/json',
                   'Content-Length': Buffer.byteLength(messageData)
                 }
               };

               const sendReq = http.request(sendOptions, (res) => {
                 debugLog(`prompt_async status=${res.statusCode ?? 'unknown'}`);
                 if (res.statusCode === 204) {
                   // Success - now connect to SSE for streaming response
                    connectToSSE(sessionId, finalPrompt, pane, indicator, inputField, resolve, reject, onComplete);
                 } else {
                   let errorData = '';
                   res.on('data', chunk => { errorData += chunk; });
                   res.on('end', () => {
                     debugLog(`prompt_async error response status=${res.statusCode} length=${errorData.length}`);
                     const errorMsg = errorData || `HTTP ${res.statusCode} error`;
                     pane.pushLine(`{red-fg}Error sending prompt: ${errorMsg}{/}`);
                     screen.render();
                     reject(new Error(`Failed to send prompt: ${errorMsg}`));
                   });
                 }
               });

               sendReq.on('error', (err) => {
                 debugLog(`prompt_async request error: ${String(err)}`);
                 pane.pushLine(`{red-fg}Request error: ${err}{/}`);
                 screen.render();
                 reject(err);
               });

               sendReq.write(messageData);
               sendReq.end();
             })
             .catch(err => {
               pane.pushLine(`{red-fg}Session error: ${err}{/}`);
               screen.render();
               reject(err);
             });
        });
      }
      
      // Connect to SSE for streaming responses
      function connectToSSE(
        sessionId: string,
        prompt: string,
        pane: any,
        indicator: any,
        inputField: any,
        resolve: Function,
        reject: Function,
        onComplete?: () => void
      ) {
        const getSessionId = (value: any) => {
          return value?.sessionID || value?.sessionId || value?.session_id;
        };
        const partTextById = new Map<string, string>();
        const messageRoleById = new Map<string, string>();
        let lastUserMessageId: string | null = null;
        let streamText = pane.getContent ? pane.getContent() : '';
        let sseClosed = false;
        const appendText = (text: string) => {
          streamText += text;
        };
        const appendLine = (line: string) => {
          if (streamText && !streamText.endsWith('\n')) {
            streamText += '\n';
          }
          streamText += line;
        };
        const updatePane = () => {
          if (pane.setContent) {
            pane.setContent(streamText);
          }
          if (typeof pane.setScrollPerc === 'function') {
            pane.setScrollPerc(100);
          }
          screen.render();
        };
        const options = {
          hostname: 'localhost',
          port: opencodeServerPort,
          path: '/event',
          method: 'GET',
          headers: {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          }
        };
        debugLog(`sse connect session=${sessionId}`);
        
        const req = http.request(options, (res) => {
          debugLog(`sse status=${res.statusCode ?? 'unknown'}`);
          let buffer = '';
          let waitingForInput = false;
          
          res.on('data', (chunk) => {
            buffer += chunk.toString();
            debugLog(`sse chunk bytes=${chunk.length}`);
            const lines = buffer.split('\n');
            
            // Keep the last incomplete line in the buffer
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              if (line.startsWith('data:')) {
                try {
                  const payload = line.slice(5).trimStart();
                  if (!payload) {
                    continue;
                  }
                  const payloadPreview = payload.length > 200 ? `${payload.slice(0, 200)}...` : payload;
                  debugLog(`sse payload length=${payload.length} preview=${payloadPreview}`);
                  const data = JSON.parse(payload);
                  const dataType = data?.type || 'unknown';
                  debugLog(`sse data type=${dataType}`);
                  
                  // Handle different event types
                  const isMessagePart = data.type === 'message.part' || data.type === 'message.part.updated' || data.type === 'message.part.created';
                  if (isMessagePart && data.properties) {
                    const part = data.properties.part;
                    const partSessionId = getSessionId(part);
                    const eventSessionId = partSessionId || getSessionId(data.properties) || getSessionId(data);
                    if (part && eventSessionId === sessionId) {
                      const role = messageRoleById.get(part.messageID);
                      const isUserMessage = role === 'user' || (lastUserMessageId !== null && part.messageID === lastUserMessageId);
                      const promptMatches = prompt && part.text && part.text.trim() === prompt.trim();
                      if (isUserMessage || promptMatches) {
                        debugLog(`sse message.part skipped user prompt role=${role ?? 'unknown'} messageID=${part.messageID}`);
                        partTextById.set(part.id || 'unknown', part.text || '');
                        continue;
                      }
                      if (part.type === 'text' && part.text) {
                        // Display text in real-time (append only new diff)
                        const partId = part.id || 'unknown';
                        const prevText = partTextById.get(partId) || '';
                        if (part.text.startsWith(prevText)) {
                          const diff = part.text.slice(prevText.length);
                          if (diff) {
                            appendText(diff);
                            updatePane();
                          }
                          debugLog(`sse text diff chars=${diff.length}`);
                        } else if (!prevText.startsWith(part.text)) {
                          appendLine(part.text);
                          updatePane();
                          debugLog(`sse text reset chars=${part.text.length}`);
                        } else {
                          debugLog(`sse text unchanged chars=${part.text.length}`);
                        }
                        partTextById.set(partId, part.text);
                      } else if (part.type === 'tool-use' && part.tool) {
                        appendLine(`{yellow-fg}[Tool: ${part.tool.name}]{/}`);
                        if (part.tool.description) {
                          appendLine(`  ${part.tool.description}`);
                        }
                        updatePane();
                        debugLog(`sse tool use=${part.tool.name}`);
                      } else if (part.type === 'tool-result' && part.content) {
                        appendLine('{green-fg}[Tool Result]{/}');
                        const resultLines = part.content.split('\n');
                        for (const line of resultLines.slice(0, 10)) {
                          appendLine(`  ${line}`);
                        }
                        if (resultLines.length > 10) {
                          appendLine(`  ... (${resultLines.length - 10} more lines)`);
                        }
                        updatePane();
                        debugLog(`sse tool result lines=${resultLines.length}`);
                      } else if (part.type === 'permission-request') {
                        // Handle permission requests (similar to input)
                        waitingForInput = true;
                        indicator.setContent('{yellow-fg}[!] Permission Required{/}');
                        indicator.show();
                        inputField.setLabel(' Permission Request ');
                        inputField.show();
                        inputField.focus();
                        updatePane();
                        debugLog('sse permission request');
                      }
                    } else {
                      debugLog(`sse message.part ignored session=${eventSessionId ?? 'unknown'}`);
                    }
                  } else if (data.type === 'message.updated' && data.properties?.info) {
                    const info = data.properties.info;
                    const messageId = info.id;
                    const messageRole = info.role;
                    if (messageId && messageRole) {
                      messageRoleById.set(messageId, messageRole);
                      if (messageRole === 'user') {
                        lastUserMessageId = messageId;
                      }
                      debugLog(`sse message updated role=${messageRole} id=${messageId}`);
                    }
                  } else if (data.type === 'message.finish' && data.properties) {
                    const finishSessionId = getSessionId(data.properties) || getSessionId(data);
                    if (finishSessionId === sessionId) {
                      debugLog('sse message finish');
                      
                      // Close SSE connection
                      sseClosed = true;
                      req.abort();
                      if (onComplete) {
                        onComplete();
                      }
                      resolve();
                    }
                  } else if (data.type === 'session.status' && data.properties) {
                    const statusSessionId = getSessionId(data.properties) || getSessionId(data);
                    const statusType = data.properties.status?.type;
                    if (statusSessionId === sessionId && statusType === 'idle') {
                      debugLog('sse session idle');
                      sseClosed = true;
                      req.abort();
                      if (onComplete) {
                        onComplete();
                      }
                      resolve();
                    }
                  } else if (data.type === 'question.asked' && data.properties) {
                    // Handle question.asked events - auto-answer with first option (usually recommended)
                    const questionSessionId = getSessionId(data.properties) || getSessionId(data);
                    if (questionSessionId === sessionId) {
                      const questions = data.properties.questions;
                      if (questions && questions.length > 0) {
                        const question = questions[0];
                        const options = question.options || [];
                        debugLog(`sse question asked: ${question.question}`);
                        debugLog(`sse question options: ${JSON.stringify(options)}`);
                        
                        // Show the question in the response pane
                        appendLine(`{yellow-fg}OpenCode asking: ${question.question}{/}`);
                        
                        // Auto-answer with first option (recommended) or "save" as fallback
                        let answer = 'save';
                        if (options.length > 0) {
                          answer = options[0].label || options[0].value || 'save';
                          appendLine(`{green-fg}Auto-answering with: ${answer}{/}`);
                          debugLog(`sse question answering with: ${answer} from options: ${JSON.stringify(options[0])}`);
                        } else {
                          debugLog(`sse question no options, using default: ${answer}`);
                        }
                        
                        // Send the answer back - try different formats
                        // First try the format that might work
                        const answerData = JSON.stringify({
                          questionID: data.properties.id,
                          answer: answer  // Try singular 'answer' instead of 'answers' array
                        });
                        
                        debugLog(`sse question sending answer: ${answerData}`);
                        
                        const answerOptions = {
                          hostname: 'localhost',
                          port: opencodeServerPort,
                          path: `/session/${sessionId}/answer`,  // Try /answer instead of /question
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(answerData)
                          }
                        };
                        
                        const answerReq = http.request(answerOptions, (res) => {
                          debugLog(`question answer status=${res.statusCode ?? 'unknown'}`);
                        });
                        
                        answerReq.on('error', (err) => {
                          debugLog(`question answer error: ${String(err)}`);
                          appendLine(`{red-fg}Failed to answer question: ${String(err)}{/}`);
                        });
                        
                        answerReq.write(answerData);
                        answerReq.end();
                      }
                    }
                  } else if (data.type === 'input.request' && data.properties) {
                    // Handle input requests
                    const inputSessionId = getSessionId(data.properties) || getSessionId(data);
                    if (inputSessionId === sessionId) {
                      waitingForInput = true;
                      const inputType = data.properties.type || 'text';
                      const prompt = data.properties.prompt || 'Input required';
                      
                      appendLine(`{yellow-fg}${prompt}{/}`);
                      indicator.setContent('{yellow-fg}[!] Input Required{/}');
                      indicator.show();
                      
                      if (inputType === 'boolean') {
                        inputField.setLabel(' Yes/No Input ');
                      } else if (inputType === 'password') {
                        inputField.setLabel(' Password Input ');
                      } else {
                        inputField.setLabel(' Input Required ');
                      }
                      
                      inputField.show();
                      inputField.focus();
                      updatePane();
                      debugLog(`sse input request type=${inputType}`);
                      
                      // Set up input handler
                      inputField.once('submit', (value: string) => {
                        // Send input response back to server
                        sendInputResponse(sessionId, value);
                        
                        // Hide input UI
                        waitingForInput = false;
                        indicator.hide();
                        inputField.hide();
                        inputField.clearValue();
                        pane.focus();
                        
                        // Show user input in pane
                        appendLine(`{cyan-fg}> ${value}{/}`);
                        updatePane();
                      });
                    }
                  }
                } catch (err) {
                  debugLog(`sse parse error: ${String(err)}`);
                  // Ignore parse errors for incomplete data
                }
              }
            }
          });
          
          res.on('end', () => {
            if (sseClosed) {
              debugLog('sse ended after close');
              resolve();
              return;
            }
            appendLine('{yellow-fg}Stream ended{/}');
            updatePane();
            debugLog('sse ended');
            resolve();
          });
          
          res.on('error', (err) => {
            const errMessage = String(err);
            const errCode = (err as any)?.code;
            if (sseClosed || errMessage.includes('aborted') || errCode === 'ECONNRESET') {
              debugLog(`sse response closed: ${errMessage}`);
              resolve();
              return;
            }
            debugLog(`sse response error: ${errMessage}`);
            appendLine(`{red-fg}SSE error: ${err}{/}`);
            updatePane();
            reject(err);
          });
        });
        
        req.on('error', (err) => {
          const errMessage = String(err);
          const errCode = (err as any)?.code;
          if (sseClosed || errMessage.includes('aborted') || errCode === 'ECONNRESET') {
            debugLog(`sse connection closed: ${errMessage}`);
            resolve();
            return;
          }
          debugLog(`sse connection error: ${errMessage}`);
          pane.pushLine(`{red-fg}Connection error: ${errMessage}{/}`);
          screen.render();
          reject(err);
        });
        
        req.end();
      }
      
      // Send input response back to the server
      function sendInputResponse(sessionId: string, input: string) {
        const responseData = JSON.stringify({ input });
        debugLog(`send input response length=${input.length}`);
        
        const options = {
          hostname: 'localhost',
          port: opencodeServerPort,
          path: `/session/${sessionId}/input`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(responseData)
          }
        };
        
        const req = http.request(options, (res) => {
          // Response handled via SSE
          debugLog(`input response status=${res.statusCode ?? 'unknown'}`);
        });
        
        req.on('error', (err) => {
          debugLog(`input response error: ${String(err)}`);
          console.error('Failed to send input response:', err);
        });
        
        req.write(responseData);
        req.end();
      }
      
      // Persisted session mapping helpers (workItemId -> sessionId)
      function getPersistedSessionIdForWorkItem(workItemId: string): string | null {
        try {
          const persisted = loadPersistedState(db.getPrefix?.() || undefined) || {};
          return persisted.sessionMap && persisted.sessionMap[workItemId] ? persisted.sessionMap[workItemId] : null;
        } catch (_) { return null; }
      }

      function persistSessionMapping(workItemId: string, sessionId: string) {
        try {
          const prefix = db.getPrefix?.();
          const state = loadPersistedState(prefix) || {};
          state.sessionMap = state.sessionMap || {};
          state.sessionMap[workItemId] = sessionId;
          savePersistedState(prefix, state);
          debugLog(`persistSessionMapping workitem=${workItemId} -> session=${sessionId}`);
        } catch (err) {
          debugLog(`failed to persist session mapping: ${String(err)}`);
        }
      }

      function persistSessionHistory(workItemId: string, history: any[]) {
        try {
          const prefix = db.getPrefix?.();
          const state = loadPersistedState(prefix) || {};
          state.sessionHistories = state.sessionHistories || {};
          state.sessionHistories[workItemId] = history;
          savePersistedState(prefix, state);
          debugLog(`persistSessionHistory workitem=${workItemId} messages=${(history || []).length}`);
        } catch (err) {
          debugLog(`failed to persist session history: ${String(err)}`);
        }
      }

      function loadPersistedSessionHistory(workItemId: string): any[] | null {
        try {
          const persisted = loadPersistedState(db.getPrefix?.() || undefined) || {};
          return persisted.sessionHistories && persisted.sessionHistories[workItemId] ? persisted.sessionHistories[workItemId] : null;
        } catch (_) { return null; }
      }

      // Produce a short, editable summary from persisted session history.
      // This is intentionally simple: extract recent text parts and join them
      // into a paragraph suitable for sending as context to the server.
      function generateSummaryFromHistory(history: any[]): string {
        try {
          if (!history || history.length === 0) return '';
          const pieces: string[] = [];
          // Walk from the end (most recent) back and collect text parts
          for (let i = history.length - 1; i >= 0 && pieces.length < 8; i--) {
            const m = history[i];
            const parts = m.parts || [];
            for (let j = parts.length - 1; j >= 0; j--) {
              const p = parts[j];
              if (p.type === 'text' && p.text) {
                const t = String(p.text).trim();
                if (t) pieces.push(t);
              } else if (p.type === 'tool-result' && p.content) {
                const t = String(p.content).split('\n').slice(0, 4).join(' ').trim();
                if (t) pieces.push(`[Tool result] ${t}`);
              }
              if (pieces.length >= 8) break;
            }
          }
          pieces.reverse(); // maintain chronological order
          let joined = pieces.join('\n\n');
          // Trim to reasonable length for sending
          if (joined.length > 1200) joined = joined.slice(0, 1200) + '...';
          return joined;
        } catch (err) {
          debugLog(`summary error: ${String(err)}`);
          return '';
        }
      }

      // Retrieve messages for a session: GET /session/:id/message
      function getSessionMessages(sessionId: string): Promise<any[]> {
        return new Promise((resolve, reject) => {
          const opts = {
            hostname: 'localhost',
            port: opencodeServerPort,
            path: `/session/${encodeURIComponent(sessionId)}/message`,
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          };
          const r = http.request(opts, (resp) => {
            let body = '';
            resp.on('data', c => body += c);
            resp.on('end', () => {
              if (!body) return resolve([]);
              try {
                const parsed = JSON.parse(body);
                if (Array.isArray(parsed)) return resolve(parsed);
                return resolve([]);
              } catch (err) {
                return reject(err);
              }
            });
          });
          r.on('error', (err) => reject(err));
          r.end();
        });
      }

      function checkSessionExists(sessionId: string): Promise<boolean> {
        return new Promise((resolve) => {
          const opts = {
            hostname: 'localhost',
            port: opencodeServerPort,
            path: `/session/${encodeURIComponent(sessionId)}`,
            method: 'GET',
            timeout: 2000,
            headers: { 'Accept': 'application/json' }
          } as any;
          const r = http.request(opts, (resp) => {
            const ok = resp.statusCode !== undefined && resp.statusCode >= 200 && resp.statusCode < 300;
            resp.resume();
            resolve(ok);
          });
          r.on('error', () => resolve(false));
          r.on('timeout', () => { r.destroy(); resolve(false); });
          r.end();
        });
      }

        // Find an existing session whose title contains the workitem marker.
      function findSessionByTitle(preferredId: string): Promise<string | null> {
        return new Promise((resolve) => {
          const searchTitle = `workitem:${preferredId}`;
          const opts = {
            hostname: 'localhost',
            port: opencodeServerPort,
            path: '/session',
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          };
          const r = http.request(opts, (resp) => {
            let body = '';
            resp.on('data', c => body += c);
            resp.on('end', () => {
              if (!body) return resolve(null);
              try {
                const parsed = JSON.parse(body);
                if (!Array.isArray(parsed)) return resolve(null);
                for (const s of parsed) {
                  const title = s?.title || s?.name || '';
                  if (typeof title === 'string' && title.includes(searchTitle)) {
                    return resolve(s.id || s.sessionId || s.session_id || null);
                  }
                }
                return resolve(null);
              } catch (_) {
                return resolve(null);
              }
            });
          });
          r.on('error', () => resolve(null));
          r.end();
        });
      }

      // Helper function to create or reuse a session. Returns an object { id, workItemId, existing? }.
      async function createSession(serverUrl: string, preferredId?: string | null): Promise<{ id: string; workItemId?: string | null; existing?: boolean; localHistory?: any[] | null }> {
        const sessionPayload: any = { title: 'TUI Session ' + new Date().toISOString() };
        if (preferredId) sessionPayload.title = `workitem:${preferredId} ${sessionPayload.title}`;
        if (preferredId) sessionPayload.id = preferredId;
        const sessionData = JSON.stringify(sessionPayload);
        debugLog('create session');

        try {
          if (preferredId) {
            const persistedId = getPersistedSessionIdForWorkItem(preferredId);
            if (persistedId) {
              const exists = await checkSessionExists(persistedId);
              if (exists) {
                debugLog(`reusing persisted session mapping for workitem=${preferredId} id=${persistedId}`);
                return { id: persistedId, workItemId: preferredId, existing: true };
              }
              const persistedHistory = loadPersistedSessionHistory(preferredId);
              if (persistedHistory) {
                debugLog(`found ${persistedHistory.length} persisted messages for workitem=${preferredId} (will NOT auto-replay)`);
                // keep local history to present to the user if we must create a new session
                // it will be attached to the returned object as `localHistory`
                // fallthrough to attempt to find session by title or create new one
              }
            }

            const existing = await findSessionByTitle(preferredId);
            if (existing) {
              debugLog(`found existing session for workitem=${preferredId} id=${existing}`);
              persistSessionMapping(preferredId, existing);
              return { id: existing, workItemId: preferredId, existing: true };
            }
          }
        } catch (err) {
          debugLog(`session lookup error: ${String(err)}`);
        }

        // Create a new session on the server
        const options = {
          hostname: 'localhost',
          port: opencodeServerPort,
          path: '/session',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(sessionData)
          }
        } as any;

        const sessionResponse: any = await new Promise((resolve, reject) => {
          const req = http.request(options, (res) => {
            let responseData = '';
            debugLog(`create session status=${res.statusCode ?? 'unknown'}`);

            res.on('data', (chunk) => {
              responseData += chunk;
            });

            res.on('end', () => {
              try {
                const parsed = JSON.parse(responseData);
                resolve(parsed);
              } catch (err) {
                reject(err);
              }
            });
          });
          req.on('error', reject);
          req.write(sessionData);
          req.end();
        });

          try {
            const session = sessionResponse;
            debugLog(`create session response length=${JSON.stringify(session).length}`);
            const returnedId = session?.id || session?.sessionId || session?.session_id || preferredId;
            let returnedWorkItemId: string | null = null;
            const returnedTitle = session?.title || session?.name || '';
            if (typeof returnedTitle === 'string') {
              const m = returnedTitle.match(/workitem:([A-Za-z0-9_\-]+)/);
              if (m) returnedWorkItemId = m[1];
            }
            if (preferredId && returnedId) {
              persistSessionMapping(preferredId, returnedId);
            }

            // Persist server messages for future restarts
            try {
              const fetched = returnedId ? await getSessionMessages(returnedId as string) : null;
              if (preferredId && fetched && fetched.length > 0) persistSessionHistory(preferredId, fetched);
            } catch (err) {
              // ignore
            }

            // Also surface any locally persisted history (from previous mapping) so the caller
            // can render it when the server session couldn't be reused.
            const localHistory = preferredId ? loadPersistedSessionHistory(preferredId) : null;

            return { id: returnedId as string, workItemId: returnedWorkItemId || preferredId || null, localHistory };
          } catch (err) {
            debugLog(`create session parse error: ${String(err)}`);
            throw new Error('Failed to create session: ' + String(err));
          }
        }
      
      function ensureOpencodePane() {
        if (opencodePane) {
          opencodePane.show();
          opencodePane.setFront();
          // In compact mode, adjust pane position to be above the input
          const currentHeight = opencodeDialog.height || MIN_INPUT_HEIGHT;
          opencodePane.bottom = currentHeight + FOOTER_HEIGHT;
          opencodePane.height = paneHeight();
          return;
        }

        const bottomOffset = MIN_INPUT_HEIGHT + FOOTER_HEIGHT;

        opencodePane = blessed.box({
          parent: screen,
          bottom: bottomOffset,
          left: 0,
          width: '100%',
          height: paneHeight(),
          label: ` opencode [esc] `,
          border: { type: 'line' },
          tags: true,
          scrollable: true,
          alwaysScroll: true,
          keys: true,
          vi: true,
          mouse: true,
          clickable: true,
          style: { border: { fg: 'magenta' } },
        });

        // Add Escape key handler to close only the response pane.
        // When Escape is pressed in the response pane we want to close
        // the pane but leave the input dialog open so the user can edit
        // or resubmit the prompt without re-opening the prompt dialog.
      opencodePane.key(['escape'], () => {
        closeOpencodePane();
        // Return focus to the input textbox if it's visible so the
        // user can continue typing. If the input dialog is in compact
        // mode it will remain visible.
        try {
          opencodeText.focus();
        } catch (_) {}
        // Prevent the global Escape handler from acting immediately
        // after we closed the pane.
        suppressEscapeUntil = Date.now() + 250;
      });
        
        opencodePane.show();
        opencodePane.setFront();
        opencodePane.focus();
      }

      async function runOpencode(prompt: string) {
        if (!prompt || prompt.trim() === '') {
          showToast('Empty prompt');
          return;
        }

        // Block if we're already waiting for a response
        if (isWaitingForResponse) {
          showToast('Please wait for current response to complete');
          return;
        }

        // Check server is running
        if (opencodeServerStatus !== 'running' || opencodeServerPort === 0) {
          showToast('OpenCode server not running');
          return;
        }

        ensureOpencodePane();
        opencodePane.show();
        opencodePane.setFront();
        screen.render();

        // Set flag to block new requests and update label
        isWaitingForResponse = true;
        opencodeDialog.setLabel(' prompt (waiting...) [esc] ');
        screen.render();

        // Use HTTP API to communicate with server
        try {
          await sendPromptToServer(prompt, opencodePane, null, opencodeText, () => {
            // Clear flag when response completes and restore label
            isWaitingForResponse = false;
            opencodeDialog.setLabel(' prompt [esc] ');
            openOpencodeDialog();
          });
        } catch (err) {
          // Clear flag on error too and restore label
          isWaitingForResponse = false;
          opencodeDialog.setLabel(' prompt [esc] ');
          opencodePane.pushLine(`{red-fg}Server communication error: ${err}{/red-fg}`);
          screen.render();
        }
      }

      // Opencode dialog controls
      opencodeSend.on('click', () => {
        const prompt = opencodeText.getValue ? opencodeText.getValue() : '';
        closeOpencodeDialog();
        runOpencode(prompt);
      });

      // Add Escape key handler to close the opencode dialog
      opencodeText.key(['escape'], function(this: any) {
        opencodeDialog.hide();
        if (opencodePane) {
          opencodePane.hide();
        }
        list.focus();
        screen.render();
      });

      // Accept Ctrl+S to send (keep for backward compatibility)
      opencodeText.key(['C-s'], function(this: any) {
        if (applyCommandSuggestion(this)) {
          return;
        }
        const prompt = this.getValue ? this.getValue() : '';
        closeOpencodeDialog();
        runOpencode(prompt);
      });

      // Accept Enter to send, Ctrl+Enter for newline
      opencodeText.key(['enter'], function(this: any) {
        if (applyCommandSuggestion(this)) {
          return;
        }
        // Send the message
        const prompt = this.getValue ? this.getValue() : '';
        closeOpencodeDialog();
        runOpencode(prompt);
      });


      // Pressing Escape while the dialog (or any child) is focused should
      // close both the input dialog and the response pane so the user returns
      // to the main list. This mirrors the behaviour when Escape is pressed
      // inside the textarea itself.
      opencodeDialog.key(['escape'], () => {
        opencodeDialog.hide();
        if (opencodePane) {
          opencodePane.hide();
        }
        // Prevent the global Escape handler from acting on the same
        // keypress and exiting the TUI.
        suppressEscapeUntil = Date.now() + 250;
        list.focus();
        screen.render();
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
      // Prevent the global Escape handler from immediately exiting when
      // a child control handles Escape (e.g. the input textarea).
      // Child handlers set this timestamp briefly to suppress the
      // global handler from acting on the same key event.
      let suppressEscapeUntil = 0;
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

      function openUpdateDialog() {
        const item = getSelectedItem();
        if (item) {
          updateDialogText.setContent(`Update: ${item.title}\nID: ${item.id}`);
        } else {
          updateDialogText.setContent('Update selected item stage:');
        }
        updateOverlay.show();
        updateDialog.show();
        updateOverlay.setFront();
        updateDialog.setFront();
        updateDialogOptions.select(0);
        updateDialogOptions.focus();
        screen.render();
      }

      function closeUpdateDialog() {
        updateDialog.hide();
        updateOverlay.hide();
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
        // Stop the OpenCode server if we started it
        stopOpencodeServer();
        screen.destroy();
        process.exit(0);
      });

      screen.key(['escape'], () => {
        // If a child handler just handled Escape, ignore this global
        // handler to avoid exiting the TUI unexpectedly.
        if (suppressEscapeUntil && Date.now() < suppressEscapeUntil) {
          return;
        }
        // Close any active overlays/panes in reverse-open order
        if (!closeDialog.hidden) {
          closeCloseDialog();
          return;
        }
        if (!updateDialog.hidden) {
          closeUpdateDialog();
          return;
        }
        if (!opencodeDialog.hidden) {
          closeOpencodeDialog();
          return;
        }
        if (opencodePane) {
          closeOpencodePane();
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
        // Stop the OpenCode server if we started it
        stopOpencodeServer();
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

      // Open opencode prompt dialog (shortcut O)
      screen.key(['o', 'O'], async () => {
        if (detailModal.hidden && helpMenu.hidden && closeDialog.hidden && updateDialog.hidden) {
          await openOpencodeDialog();
        }
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

      // Update selected item (quick edit) - shortcut U
      screen.key(['u', 'U'], () => {
        if (detailModal.hidden && helpMenu.hidden && closeDialog.hidden && updateDialog.hidden) {
          openUpdateDialog();
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
        if (idx === 3) showToast('Cancelled');
        closeCloseDialog();
      });

      updateDialogOptions.on('select', (_el: any, idx: number) => {
        const item = getSelectedItem();
        if (!item) {
          showToast('No item selected');
          closeUpdateDialog();
          return;
        }
        try {
          if (idx === 0) db.update(item.id, { stage: 'idea' });
          else if (idx === 1) db.update(item.id, { stage: 'prd_complete' });
          else if (idx === 2) db.update(item.id, { stage: 'plan_complete' });
          else if (idx === 3) db.update(item.id, { stage: 'in_progress' });
          else if (idx === 4) db.update(item.id, { stage: 'in_review' });
          else if (idx === 5) db.update(item.id, { stage: 'done' });
          else if (idx === 6) db.update(item.id, { stage: 'blocked' });
          else if (idx === 7) { /* Cancel - no action */ }
          if (idx !== 7) showToast('Updated');
          else showToast('Cancelled');
          refreshFromDatabase(Math.max(0, (list.selected as number) - 0));
        } catch (err) {
          showToast('Update failed');
        }
        closeUpdateDialog();
      });

      updateDialog.key(['escape'], () => {
        closeUpdateDialog();
      });

      updateDialogOptions.key(['escape'], () => {
        closeUpdateDialog();
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
