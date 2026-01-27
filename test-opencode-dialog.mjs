#!/usr/bin/env node
/**
 * Test script to verify the OpenCode dialog opens correctly
 */

import blessed from 'blessed';

// Create a test screen
const screen = blessed.screen({ smartCSR: true, title: 'Test OpenCode Dialog', mouse: true });

// Create overlay
const opencodeOverlay = blessed.box({
  parent: screen,
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  style: { bg: 'black' },
});

// Create dialog
const opencodeDialog = blessed.box({
  parent: screen,
  top: 'center',
  left: 'center',
  width: '80%',
  height: '60%',
  label: ' OpenCode Prompt ',
  border: { type: 'line' },
  tags: true,
  style: { border: { fg: 'yellow' } },
});

// Server status
const serverStatusBox = blessed.box({
  parent: opencodeDialog,
  top: 0,
  right: 2,
  width: 20,
  height: 1,
  content: '{green-fg}[OK] Port: 51625{/}',
  tags: true,
  style: { fg: 'white' }
});

// Textarea
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
  border: { type: 'line' },
  style: { focus: { border: { fg: 'green' } } },
  content: 'Type your message here...'
});

// Send button
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

// Cancel button
const opencodeCancel = blessed.box({
  parent: opencodeDialog,
  bottom: 0,
  right: 1,
  height: 1,
  width: 10,
  content: '[ Cancel ]',
  mouse: true,
  clickable: true,
  style: { fg: 'white', bg: 'red' },
});

// Suggestion hint
const suggestionHint = blessed.text({
  parent: opencodeDialog,
  top: '100%-4',
  left: 2,
  width: '100%-4',
  height: 1,
  tags: true,
  style: { fg: 'gray' },
  content: '{gray-fg}↳ Type "/" to see available commands{/}'
});

// Focus the textarea
opencodeText.focus();

// Handle escape to exit
screen.key(['escape', 'q', 'C-c'], () => {
  process.exit(0);
});

// Show what happens when keys are pressed
opencodeText.on('keypress', (ch, key) => {
  console.log(`Key pressed: ${ch} (${key ? key.name : 'unknown'})`);
});

// Render
screen.render();

// Show debug info
console.log('Dialog opened. Textarea should be visible and focused.');
console.log('Try typing in the textarea. Press ESC to exit.');