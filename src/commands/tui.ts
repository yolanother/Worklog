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
      opencodeText.on('keypress', function(_ch: any, _key: any) {
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

      // Store current session ID for server communication
      let currentSessionId: string | null = null;
      
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
          const sessionPromise = currentSessionId 
            ? Promise.resolve(currentSessionId)
            : createSession(serverUrl);
            
          sessionPromise
            .then(sessionId => {
              currentSessionId = sessionId;
              // Update pane label to include session ID
              if (pane.setLabel) {
                pane.setLabel(` opencode - Session: ${sessionId} [esc] `);
              }
              pane.pushLine('');
              pane.pushLine(`{gray-fg}${prompt}{/}`);
              pane.pushLine('');
              // Ensure we scroll to the bottom after adding content
              if (pane.setScrollPerc) {
                pane.setScrollPerc(100);
              }
              screen.render();
              debugLog(`session id=${sessionId}`);
              
              // Use async prompt endpoint for better streaming
              const messageData = JSON.stringify({
                parts: [{ type: 'text', text: prompt }]
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
                  connectToSSE(sessionId, prompt, pane, indicator, inputField, resolve, reject, onComplete);
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
      
      // Helper function to create a new session
      function createSession(serverUrl: string): Promise<string> {
        return new Promise((resolve, reject) => {
          const sessionData = JSON.stringify({
            title: 'TUI Session ' + new Date().toISOString()
          });
          debugLog('create session');
          
          const options = {
            hostname: 'localhost',
            port: opencodeServerPort,
            path: '/session',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(sessionData)
            }
          };
          
          const req = http.request(options, (res) => {
            let responseData = '';
            debugLog(`create session status=${res.statusCode ?? 'unknown'}`);
            
            res.on('data', (chunk) => {
              responseData += chunk;
            });
            
            res.on('end', () => {
              try {
                const session = JSON.parse(responseData);
                debugLog(`create session response length=${responseData.length}`);
                resolve(session.id);
              } catch (err) {
                debugLog(`create session parse error: ${String(err)}`);
                reject(new Error('Failed to parse session response: ' + err));
              }
            });
          });
          
          req.on('error', reject);
          req.write(sessionData);
          req.end();
        });
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

        // Check server is running
        if (opencodeServerStatus !== 'running' || opencodeServerPort === 0) {
          showToast('OpenCode server not running');
          return;
        }

        ensureOpencodePane();
        opencodePane.show();
        opencodePane.setFront();
        screen.render();

        // Use HTTP API to communicate with server
        try {
          await sendPromptToServer(prompt, opencodePane, null, opencodeText, () => openOpencodeDialog());
        } catch (err) {
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

      // Ctrl+Enter inserts newline
      opencodeText.key(['C-enter'], function(this: any) {
        // Get current state
        const value = this.getValue ? this.getValue() : '';
        const pos = this.getCaretPosition ? this.getCaretPosition() : value.length;
        const before = value.substring(0, pos);
        const after = value.substring(pos);
        const newValue = before + '\n' + after;
        const newCursorPos = before.length + 1;
        
        // Calculate new height
        const lines = newValue.split('\n').length;
        const desiredHeight = Math.min(Math.max(MIN_INPUT_HEIGHT, lines + 2), inputMaxHeight());
        
        // Set the new value first
        this.setValue(newValue);
        if (this.moveCursor) {
          this.moveCursor(newCursorPos);
        }
        
        // Update dialog height
        opencodeDialog.height = desiredHeight;
        opencodeText.height = desiredHeight - 2;
        
        // Force blessed to recalculate the textarea's render
        // This is a hack but might fix the display issue
        if (this._parseContent) {
          this._parseContent();
        }
        if (this.setContent && this.getContent) {
          this.setContent(this.getContent());
        }
        
        // Update pane if needed
        if (opencodePane) {
          opencodePane.bottom = desiredHeight + FOOTER_HEIGHT;
          opencodePane.height = paneHeight();
        }
        
        // Scroll handling - ensure content is visible
        const cursorLine = (before.match(/\n/g) || []).length + 1;
        const totalLines = newValue.split('\n').length;
        const visibleLines = desiredHeight - 2;
        
        if (this.setScroll) {
          if (totalLines <= visibleLines) {
            // All content fits - scroll to top
            this.setScroll(0);
          } else if (cursorLine > visibleLines) {
            // Content doesn't fit and cursor is beyond visible area - scroll down
            this.setScroll(cursorLine - visibleLines);
          }
          // Otherwise keep current scroll position
        }
        
        // Multiple renders to ensure display
        this.focus();
        screen.render();
        
        // Force another render after the event loop
        setImmediate(() => {
          screen.render();
        });
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
