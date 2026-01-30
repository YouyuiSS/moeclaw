import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:18789');

ws.on('open', () => {
    console.log('Connected to gateway');

    // Handshake
    ws.send(JSON.stringify({
        type: 'req',
        id: 'hs-1',
        method: 'connect',
        params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
                id: 'cli',
                mode: 'cli',
                platform: 'macos',
                version: '1.0.0'
            },
            auth: {
                token: '17b18a543ea598fc02f99c51de5569c0f3c6ff1a445207ef' // Found in App.jsx
            }
        }
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('Received:', JSON.stringify(msg, null, 2));

    if (msg.id === 'hs-1' && msg.type === 'res' && msg.ok === true) {
        console.log('Handshake success. Enabling TTS...');
        ws.send(JSON.stringify({
            type: "req",
            id: "tts-enable",
            method: "tts.enable"
        }));

        setTimeout(() => {
            console.log('Sending chat message...');
            ws.send(JSON.stringify({
                type: 'req',
                id: 'chat-1',
                method: 'chat.send',
                params: {
                    sessionKey: 'avatar-demo',
                    message: 'Hi',
                    idempotencyKey: Date.now().toString()
                }
            }));
        }, 1000);
    }
});

ws.on('error', (err) => {
    console.error('WebSocket error:', err);
});

ws.on('close', () => {
    console.log('Disconnected');
});
