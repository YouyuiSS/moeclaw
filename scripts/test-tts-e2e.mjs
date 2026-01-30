import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:18789');

function send(msg) {
    ws.send(JSON.stringify(msg));
}

ws.on('open', () => {
    console.log('Connected');
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    // console.log('Received:', msg.type, msg.event || '');

    if (msg.event === 'connect.challenge') {
        console.log('Performing handshake...');
        send({
            type: "req",
            id: "init-" + Date.now(),
            method: "connect",
            params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                    id: "cli-test",
                    displayName: "Test Script",
                    version: "1.0.0",
                    platform: "macos",
                    mode: "cli"
                },
                auth: { token: "17b18a543ea598fc02f99c51de5569c0f3c6ff1a445207ef" }
            }
        });
    }

    if (msg.type === 'res' && msg.id?.startsWith('init-') && msg.ok) {
        console.log('Handshake OK. Enabling TTS...');
        send({
            type: "req",
            id: "tts-enable-" + Date.now(),
            method: "tts.enable"
        });
        // Give it a moment, then set provider
        setTimeout(() => {
            send({
                type: "req",
                id: "tts-set-" + Date.now(),
                method: "tts.setProvider",
                params: { provider: "edge" }
            });

            console.log('Sending chat message...');
            send({
                type: "req",
                id: "req-" + Date.now(),
                method: "chat.send",
                params: {
                    sessionKey: 'test-session-' + Date.now(),
                    message: "Hello, do you have a voice?",
                    idempotencyKey: "msg-" + Date.now()
                }
            });
        }, 500);
    }

    if (msg.event === 'chat') {
        const state = msg.payload?.state;
        const mediaUrls = msg.payload?.message?.mediaUrls;
        const mediaUrl = msg.payload?.message?.mediaUrl;

        console.log(`Chat State: ${state}, Text: ${msg.payload?.message?.content?.[0]?.text?.slice(0, 20)}...`);

        if (mediaUrl || (mediaUrls && mediaUrls.length > 0)) {
            console.log("SUCCESS: Received Media URL!");
            console.log("Media URL:", mediaUrl ? mediaUrl.slice(0, 50) + "..." : mediaUrls);
            process.exit(0);
        }

        if (state === 'final') {
            if (!mediaUrl && (!mediaUrls || mediaUrls.length === 0)) {
                console.error("FAILURE: Final message received but NO audio media found.");
                // Don't exit yet, maybe it comes in a separate event or slightly delayed? 
                // Logic in server-chat says it attaches to final.
                process.exit(1);
            }
        }
    }
});

ws.on('error', (e) => {
    console.error('Socket error:', e);
    process.exit(1);
});
