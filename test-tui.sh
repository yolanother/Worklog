#!/bin/bash
# Quick test script for OpenCode TUI integration

echo "Testing OpenCode TUI Integration"
echo "================================"
echo ""
echo "1. Starting TUI in background..."
wl tui &
TUI_PID=$!
sleep 2

echo "2. TUI started with PID: $TUI_PID"
echo ""
echo "To test:"
echo "  - Press 'O' to open OpenCode dialog"
echo "  - Check server status indicator shows '[OK] Port: 9999'"
echo "  - Type a prompt like 'What is 2+2?'"
echo "  - Press Ctrl+S to send"
echo "  - Observe response in OpenCode pane"
echo ""
echo "Press Ctrl+C to stop the TUI"

wait $TUI_PID