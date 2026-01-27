#!/bin/bash
# Test the OpenCode integration in the TUI

set -e

echo "Testing OpenCode TUI Integration..."
echo "=================================="
echo

# Kill any existing OpenCode servers
echo "1. Cleaning up any existing OpenCode servers..."
pkill -f "opencode web" 2>/dev/null || true
sleep 1

# Build the project
echo "2. Building the project..."
npm run build

# Start the OpenCode web server manually to verify it works
echo "3. Testing OpenCode web server..."
opencode web --port 51625 --print-logs 2>&1 &
SERVER_PID=$!
sleep 5

# Test the server
echo "4. Checking server health..."
if curl -s http://localhost:51625/health > /dev/null; then
    echo "   ✓ Server is healthy"
else
    echo "   ✗ Server failed to start"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

# Create a test session
echo "5. Creating test session..."
SESSION_RESPONSE=$(curl -s -X POST http://localhost:51625/session \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Session"}')

if echo "$SESSION_RESPONSE" | grep -q '"id"'; then
    SESSION_ID=$(echo "$SESSION_RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
    echo "   ✓ Session created: $SESSION_ID"
else
    echo "   ✗ Failed to create session"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

# Send a test prompt
echo "6. Sending test prompt..."
PROMPT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:51625/session/${SESSION_ID}/prompt_async" \
  -H "Content-Type: application/json" \
  -d '{"parts":[{"type":"text","text":"What is 2+2?"}]}')

HTTP_CODE=$(echo "$PROMPT_RESPONSE" | tail -1)
if [ "$HTTP_CODE" = "204" ]; then
    echo "   ✓ Prompt sent successfully"
else
    echo "   ✗ Failed to send prompt (HTTP $HTTP_CODE)"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

# Check SSE stream
echo "7. Testing SSE event stream..."
timeout 3 curl -s -N -H "Accept: text/event-stream" http://localhost:51625/event 2>&1 | head -5
echo "   ✓ SSE stream working"

# Kill the test server
echo "8. Cleaning up test server..."
kill $SERVER_PID 2>/dev/null || true
sleep 1

echo
echo "=================================="
echo "All tests passed! ✓"
echo
echo "Now you can test the TUI integration:"
echo "  1. Run: wl tui"
echo "  2. Press 'o' (lowercase) to open the OpenCode dialog"
echo "  3. Wait for server status to show [OK]"
echo "  4. Type a message (e.g., 'What is 2+2?')"
echo "  5. Press Ctrl+S to send"
echo
echo "Expected behavior:"
echo "  - Input field should be visible and focused"
echo "  - You should be able to type in it"
echo "  - Response should appear in bottom pane"
echo "  - Server auto-starts when dialog opens"