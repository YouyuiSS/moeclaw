import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import Live2DViewer from './components/Live2DViewer';
import ChatBox from './components/ChatBox';
import { AudioQueue } from './utils/audio';

// Configuration - Point this to your Moltbot Gateway
const GATEWAY_URL = 'http://localhost:18789';
const LIVE2D_MODEL_PATH = '/models/Hiyori/hiyori_free_t08.model3.json'; // Ensure you place a model here!

function App() {
    const [messages, setMessages] = useState([]);
    const [connected, setConnected] = useState(false);
    const [talkingVolume, setTalkingVolume] = useState(0);

    const [currentAudioDuration, setCurrentAudioDuration] = useState(0);
    const [audioStartTime, setAudioStartTime] = useState(0);

    const socketRef = useRef(null);
    const audioQueueRef = useRef(null);

    // Initialize Audio Logic
    useEffect(() => {
        audioQueueRef.current = new AudioQueue(
            (volume) => setTalkingVolume(volume),
            (duration) => {
                setCurrentAudioDuration(duration);
                setAudioStartTime(Date.now());
            }
        );

        // Cleanup
        return () => {
            if (audioQueueRef.current) {
                audioQueueRef.current.stopAnalysis();
            }
        };
    }, []);

    // Initialize Socket connection
    useEffect(() => {
        // Note: Moltbot Gateway usually uses raw WebSocket for some parts, 
        // but standard Socket.IO client might need specific namespace config if Moltbot supports IO.
        // Based on Moltbot code, it uses `ws` module which is raw websocket often.
        // Let's assume standard WebSocket for compatibility if IO fails, 
        // BUT pure implementation:

        // Using native WebSocket as Moltbot seems to rely on that in server.impl.ts
        const ws = new WebSocket(`ws://127.0.0.1:18789`);

        ws.onopen = () => {
            console.log('Connected to WebSocket, waiting for handshake...');
        };

        ws.onmessage = async (event) => {
            // Handle Blobs (likely Audio)
            if (event.data instanceof Blob) {
                console.log("Received Audio Blob");
                audioQueueRef.current?.enqueue(event.data);
                return;
            }

            // Handle Text (JSON)
            try {
                const data = JSON.parse(event.data);

                // Handshake Challenge
                if (data.type === 'event' && data.event === 'connect.challenge') {
                    console.log('Received handshake challenge', data);
                    // Respond to handshake
                    const challengeResponse = {
                        type: "req",
                        id: "init-" + Date.now(),
                        method: "connect",
                        params: {
                            minProtocol: 3,
                            maxProtocol: 3,
                            client: {
                                id: "cli",
                                displayName: "Avatar Shell CLI",
                                version: "1.0.0",
                                platform: "macos",
                                mode: "cli"
                            },
                            auth: { token: "17b18a543ea598fc02f99c51de5569c0f3c6ff1a445207ef" }
                        }
                    };
                    ws.send(JSON.stringify(challengeResponse));
                    return;
                }

                // Handshake Response
                if (data.type === 'res' && data.id?.startsWith('init-')) {
                    if (data.ok) {
                        console.log('Handshake successful!');
                        setConnected(true);
                        setMessages(prev => [...prev, { role: 'system', text: "Connected to Moltbot Gateway" }]);

                        // Enable TTS automatically
                        setTimeout(() => enableTTS(), 1000);
                    } else {
                        console.error('Handshake failed:', data.error);
                        setMessages(prev => [...prev, { role: 'error', text: `Connection Failed: ${data.error?.message || 'Unknown error'}` }]);
                    }
                    return;
                }

                // Normal Messages (after handshake)
                if (data.type === 'chat.text') {
                    setMessages(prev => [...prev, { role: 'bot', text: data.text }]);
                } else if (data.type === 'chat.audio') {
                    // Assuming Moltbot sends audio patches? 
                    // Verify structure later, for now sticking to previous assumption or logging
                    console.log('Received audio data', data);
                    // The original code handled `event.data instanceof Blob` for audio.
                    // If `data.blob` is expected here, it implies the JSON contains a base64 or similar.
                    // For now, we'll assume the Blob handling above is primary for audio.
                    // If Moltbot sends audio as JSON with a blob property, this would need adjustment.
                    // audioQueueRef.current.enqueue(data.blob); // This line would be used if data.blob was the audio.
                } else if (data.event === 'agent.message') {
                    // Handle agent events if they come in this format
                    const payload = data.payload;
                    if (payload && payload.text) {
                        setMessages(prev => [...prev, { role: 'bot', text: payload.text }]);
                    }
                } else {
                    // Audio Handling
                    // This block is for handling audio messages that might come as a URL within a JSON object.
                    // The `handleAudioMessage` function is defined here to process such URLs.
                    const handleAudioMessage = async (base64Audio) => {
                        console.log("App: Received audio chunk, length:", base64Audio.length);
                        try {
                            // Assuming base64Audio is actually a URL or data URI that fetch can handle
                            const response = await fetch(base64Audio);
                            const blob = await response.blob();
                            audioQueueRef.current.enqueue(blob);
                        } catch (error) {
                            console.error("App: Error processing audio message:", error);
                        }
                    };

                    // Fallback to original handleSocketMessage for other events
                    handleSocketMessage(data);
                }

            } catch (e) {
                console.error("Failed to parse socket message:", e);
            }
        };

        ws.onclose = () => {
            console.log('Disconnected');
            setConnected(false);
        };

        socketRef.current = ws;

        return () => {
            ws.close();
        };
    }, []);

    const handleSocketMessage = (data) => {
        console.log("WS Data Full:", JSON.stringify(data, null, 2));

        // Handle generic 'chat' event (Moltbot Protocol)
        if (data.event === 'chat') {
            const { state, message } = data.payload || {};

            // Extract text from message (supports { text: ... } or { content: [{ type: 'text', text: ... }] })
            let text = "";
            if (message?.content && Array.isArray(message.content)) {
                const textItem = message.content.find(item => item.type === 'text');
                if (textItem) text = textItem.text;
            } else {
                text = message?.text || message?.content || "";
            }

            // Check for Audio URL in message (Moltbot TTS)
            // It might be in 'message.mediaUrl' or 'payload.mediaUrl' depending on exact structure
            const mediaUrl = message?.mediaUrl || data.payload?.mediaUrl;
            if (mediaUrl) {
                console.log("Received Audio URL:", mediaUrl);
                // Fetch and enqueue for analysis/playback
                fetch(mediaUrl)
                    .then(res => res.blob())
                    .then(blob => {
                        audioQueueRef.current.enqueue(blob);
                        audioQueueRef.current.resume(); // Ensure context is running
                    })
                    .catch(e => console.error("Failed to fetch audio:", e));
            }

            if (state === 'delta') {
                setMessages(prev => {
                    const last = prev[prev.length - 1];
                    if (last && last.role === 'bot' && last.streaming) {
                        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
                    }
                    return [...prev, { role: 'bot', text, streaming: true }];
                });
            } else if (state === 'final') {
                setMessages(prev => {
                    const last = prev[prev.length - 1];
                    // If we were streaming, just update the state, but 'final' might contain the full text or just the last chunk?
                    // Usually 'final' in delta streams is just a marker, OR it contains the full final message.
                    // Let's assume it appends if we are streaming, or adds new if not.
                    if (last && last.role === 'bot' && last.streaming) {
                        // If final has text, append it? Or is it the full text?
                        // If text is present, assume it's a chunk or full replacement.
                        // Safest: mark streaming false.
                        return [...prev.slice(0, -1), { ...last, streaming: false, text: last.text + text }];
                    }
                    if (text) {
                        return [...prev, { role: 'bot', text }];
                    }
                    return prev;
                });
            }
        }

        // Handle specific TTS event
        if (data.event === 'tts.audio') {
            // ...
        }

        // Handle specific playback event if it exists
        if (data.event === 'audio.play') { // Hypothetical event
            // ...
        }
    };

    const enableTTS = () => {
        if (!socketRef.current || !connected) return;
        // Enable TTS configuration
        socketRef.current.send(JSON.stringify({
            type: "req",
            id: "tts-enable-" + Date.now(),
            method: "tts.enable"
        }));
        // Set provider to Edge (Free)
        socketRef.current.send(JSON.stringify({
            type: "req",
            id: "tts-set-" + Date.now(),
            method: "tts.setProvider",
            params: { provider: "edge" }
        }));
        console.log("Requested TTS Enabled (Edge)");
    };

    const sendMessage = (text) => {
        if (!socketRef.current || !connected) return;

        // Add user message to UI
        setMessages(prev => [...prev, { role: 'user', text }]);

        // Send to Moltbot
        // Send to Moltbot using RequestFrame
        const reqId = "req-" + Date.now();
        socketRef.current.send(JSON.stringify({
            type: "req",
            id: reqId,
            method: "chat.send",
            params: {
                sessionKey: 'avatar-demo',
                message: text,
                idempotencyKey: "msg-" + Date.now()
            }
        }));

        // Ensure Audio Context is resumed (browser policy requires user interaction)
        audioQueueRef.current?.resume();
    };

    return (
        <>
            <div
                style={{
                    position: 'fixed',
                    top: '20px',
                    right: '20px',
                    background: connected ? '#4caf50' : '#f44336',
                    padding: '8px 16px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    zIndex: 100
                }}
            >
                {connected ? 'CONNECTED' : 'DISCONNECTED'}
            </div>

            <Live2DViewer
                modelPath={LIVE2D_MODEL_PATH}
                talkingVolume={talkingVolume}
            />

            <ChatBox
                messages={messages}
                onSendMessage={sendMessage}
                audioDuration={currentAudioDuration}
                startTime={audioStartTime}
            />
        </>
    );
}

export default App;
