import React, { useState, useEffect, useRef } from 'react';

export default function ChatBox({ messages, onSendMessage }) {
    const [inputValue, setInputValue] = useState('');
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (inputValue.trim()) {
            onSendMessage(inputValue);
            setInputValue('');
        }
    };

    return (
        <div style={{
            position: 'absolute',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '90%',
            maxWidth: '800px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            zIndex: 10,
            pointerEvents: 'none', // Allow clicks to pass through usually, but buttons need pointer-events-auto
        }}>


            {/* Input Area - Minimal */}
            <form onSubmit={handleSubmit} style={{
                display: 'flex',
                gap: '10px',
                width: '100%',
                maxWidth: '600px',
                pointerEvents: 'auto', // Re-enable clicks
                background: 'rgba(255, 255, 255, 0.1)',
                padding: '8px',
                borderRadius: '30px',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                backdropFilter: 'blur(5px)',
            }}>
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="Chat..."
                    style={{
                        flex: 1,
                        padding: '10px 20px',
                        borderRadius: '24px',
                        border: 'none',
                        background: 'transparent',
                        fontSize: '16px',
                        color: '#fff',
                        outline: 'none',
                        textShadow: '0 1px 2px rgba(0,0,0,0.5)'
                    }}
                />
                <MicButton onSpeechResult={onSendMessage} />
                <button type="submit" style={{
                    padding: '0 24px',
                    borderRadius: '24px',
                    border: 'none',
                    background: 'rgba(100, 108, 255, 0.8)',
                    color: '#fff',
                    fontSize: '16px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                }}>
                    Send
                </button>
            </form>
        </div>
    );
}

function MicButton({ onSpeechResult }) {
    const [listening, setListening] = useState(false);
    const recognitionRef = useRef(null);

    useEffect(() => {
        if ('webkitSpeechRecognition' in window) {
            const recognition = new window.webkitSpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.lang = 'zh-CN'; // Default to Chinese

            recognition.onstart = () => setListening(true);
            recognition.onend = () => setListening(false);
            recognition.onerror = (event) => {
                console.error("Speech recognition error", event.error);
                setListening(false);
            };
            recognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                if (transcript) {
                    onSpeechResult(transcript);
                }
            };

            recognitionRef.current = recognition;
        }
    }, [onSpeechResult]);

    const toggleListening = () => {
        if (!recognitionRef.current) {
            alert("Speech recognition not supported in this browser.");
            return;
        }

        if (listening) {
            recognitionRef.current.stop();
        } else {
            recognitionRef.current.start();
        }
    };

    return (
        <button
            type="button"
            onClick={toggleListening}
            style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                border: 'none',
                background: listening ? '#ff4444' : '#4caf50',
                color: '#fff',
                fontSize: '20px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.3s',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
            }}
            title={listening ? "Stop Listening" : "Start Listening"}
        >
            {listening ? '⏹' : '🎤'}
        </button>
    );
}
