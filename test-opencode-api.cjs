#!/usr/bin/env node

const http = require('http');

const PORT = 9999;

// Test 1: Create session
function createSession() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ title: 'Test Session' });
    
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: '/session',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    
    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => { responseData += chunk; });
      res.on('end', () => {
        try {
          const session = JSON.parse(responseData);
          console.log('✓ Session created:', session.id);
          resolve(session.id);
        } catch (err) {
          console.error('✗ Failed to parse session response:', err);
          reject(err);
        }
      });
    });
    
    req.on('error', (err) => {
      console.error('✗ Failed to create session:', err.message);
      reject(err);
    });
    
    req.write(data);
    req.end();
  });
}

// Test 2: Send prompt
function sendPrompt(sessionId, prompt) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      parts: [{ type: 'text', text: prompt }]
    });
    
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: `/session/${sessionId}/prompt_async`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    
    const req = http.request(options, (res) => {
      console.log('  Response status:', res.statusCode);
      
      let responseData = '';
      res.on('data', chunk => { responseData += chunk; });
      res.on('end', () => {
        if (res.statusCode === 204) {
          console.log('✓ Prompt sent successfully (async)');
          resolve();
        } else {
          console.error('✗ Unexpected response:', res.statusCode, responseData);
          reject(new Error(`Status ${res.statusCode}: ${responseData}`));
        }
      });
    });
    
    req.on('error', (err) => {
      console.error('✗ Failed to send prompt:', err.message);
      reject(err);
    });
    
    req.write(data);
    req.end();
  });
}

// Test 3: Connect to SSE
function connectToSSE(sessionId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: '/event',
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    };
    
    console.log('  Connecting to SSE stream...');
    
    const req = http.request(options, (res) => {
      console.log('  SSE Response status:', res.statusCode);
      console.log('  SSE Headers:', res.headers['content-type']);
      
      let buffer = '';
      let messageCount = 0;
      
      const timeout = setTimeout(() => {
        console.log('✓ SSE test complete, received', messageCount, 'messages');
        req.destroy();
        resolve();
      }, 5000);
      
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              messageCount++;
              
              if (data.type === 'message.part' && data.properties) {
                const part = data.properties.part;
                if (part && part.sessionID === sessionId) {
                  console.log('  ✓ Received message part:', part.type);
                  if (part.text) {
                    console.log('    Text:', part.text.substring(0, 50) + '...');
                  }
                }
              }
            } catch (err) {
              // Ignore parse errors for non-JSON SSE messages
            }
          }
        }
      });
      
      res.on('end', () => {
        clearTimeout(timeout);
        console.log('  SSE stream ended');
        resolve();
      });
    });
    
    req.on('error', (err) => {
      console.error('✗ SSE connection error:', err.message);
      reject(err);
    });
    
    req.end();
  });
}

// Run tests
async function runTests() {
  console.log('Testing OpenCode API on port', PORT);
  console.log('=====================================\n');
  
  try {
    // Test 1: Create session
    console.log('1. Creating session...');
    const sessionId = await createSession();
    
    // Test 2: Send prompt
    console.log('\n2. Sending prompt...');
    await sendPrompt(sessionId, 'Hello, this is a test prompt');
    
    // Test 3: Connect to SSE
    console.log('\n3. Testing SSE stream...');
    await connectToSSE(sessionId);
    
    console.log('\n✓ All tests passed!');
  } catch (err) {
    console.error('\n✗ Test failed:', err);
    process.exit(1);
  }
}

runTests();