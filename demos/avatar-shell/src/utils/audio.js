export class AudioQueue {
    constructor(onVolumeChange, onPlay) {
        this.queue = [];
        this.isPlaying = false;
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.onVolumeChange = onVolumeChange;
        this.onPlay = onPlay;
        this.animationFrameId = null;
    }

    enqueue(blob) {
        console.log("AudioQueue: Enqueueing blob", blob.size);
        this.queue.push(blob);
        if (!this.isPlaying) {
            this.playNext();
        }
    }

    async playNext() {
        if (this.queue.length === 0) {
            this.isPlaying = false;
            console.log("AudioQueue: Queue empty, stopping");
            return;
        }

        this.isPlaying = true;
        const blob = this.queue.shift();
        console.log("AudioQueue: Playing next blob", blob.size);

        try {
            const arrayBuffer = await blob.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            // Resume context if suspended (browser autoplay policy)
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
                console.log("AudioQueue: Resumed AudioContext");
            }

            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);

            source.onended = () => {
                console.log("AudioQueue: Source ended");
                this.stopAnalysis();
                this.playNext();
            };

            this.startAnalysis();
            if (this.onPlay) {
                this.onPlay(audioBuffer.duration);
            }
            source.start(0);
            console.log("AudioQueue: Source started");
        } catch (error) {
            console.error("AudioQueue: Error playing audio:", error);
            this.playNext();
        }
    }

    startAnalysis() {
        console.log("AudioQueue: Starting analysis");
        const update = () => {
            this.analyser.getByteFrequencyData(this.dataArray);
            // Calculate average volume
            let sum = 0;
            for (let i = 0; i < this.dataArray.length; i++) {
                sum += this.dataArray[i];
            }
            const average = sum / this.dataArray.length;
            // Normalize volume to 0-1 range roughly
            const normalized = Math.min(1, average / 128);

            if (this.onVolumeChange) {
                this.onVolumeChange(normalized);
            }
            this.animationFrameId = requestAnimationFrame(update);
        };
        update();
    }

    stopAnalysis() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        if (this.onVolumeChange) {
            this.onVolumeChange(0);
        }
    }

    // Helper to resume AudioContext on user interaction
    resume() {
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }
}
