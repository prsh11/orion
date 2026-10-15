/* Orion audio engine. Sounds play only after explicit opt-in. */
/* All sounds synthesized via Web Audio API — no external files needed */

const AudioFX = (() => {
    let ctx: AudioContext | null = null;
    let enabled = (() => {
        if (typeof window === 'undefined') return false;
        try { return localStorage.getItem('orion-sound') === 'on'; } catch { return false; }
    })();

    function getCtx() {
        if (!ctx) {
            const AudioContextClass = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!AudioContextClass) throw new Error('Web Audio is unavailable');
            ctx = new AudioContextClass();
        }
        if (ctx.state === 'suspended') {
            void ctx.resume().catch(() => {});
        }
        return ctx;
    }

    function play(fn: (context: AudioContext) => void) {
        if (!enabled) return;
        try {
            fn(getCtx());
        } catch {
            // Audio not ready yet (browser autoplay policy) — fail silently
        }
    }

    function tone(freq: number, type: OscillatorType, duration: number, startTime = 0, volume = 0.3) {
        return (ctx: AudioContext) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(volume, ctx.currentTime + startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime + startTime);
            osc.stop(ctx.currentTime + startTime + duration);
        };
    }

    function noise(duration: number, startTime = 0, volume = 0.15, filterFreq = 2000) {
        return (ctx: AudioContext) => {
            const bufferSize = ctx.sampleRate * duration;
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            const noise = ctx.createBufferSource();
            noise.buffer = buffer;
            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = filterFreq;
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(volume, ctx.currentTime + startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            noise.start(ctx.currentTime + startTime);
            noise.stop(ctx.currentTime + startTime + duration);
        };
    }

    return {
        setEnabled(value: boolean) { enabled = value; },
        unlock() {
            if (!enabled) return;
            try { getCtx(); } catch { /* Audio is optional on unsupported browsers. */ }
        },
        toggle() {
            enabled = !enabled;
            return enabled;
        },
        isEnabled() { return enabled; },

        click() {
            play(tone(800, 'sine', 0.08, 0, 0.15));
        },

        success() {
            play((ctx) => {
                tone(523, 'sine', 0.15, 0, 0.2)(ctx);
                tone(659, 'sine', 0.15, 0.08, 0.2)(ctx);
                tone(784, 'sine', 0.2, 0.16, 0.25)(ctx);
            });
        },

        achievement() {
            play((ctx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(200, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.3);
                gain.gain.setValueAtTime(0.15, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.4);
                [523, 659, 784, 1047].forEach((f) => {
                    tone(f, 'triangle', 0.5, 0.25, 0.15)(ctx);
                });
                noise(0.3, 0.25, 0.08, 6000)(ctx);
            });
        },

        levelUp() {
            play((ctx) => {
                const notes = [262, 330, 392, 523, 659, 784, 1047];
                notes.forEach((f, i) => {
                    tone(f, 'square', 0.2, i * 0.07, 0.1)(ctx);
                });
                [523, 659, 784, 1047].forEach((f) => {
                    tone(f, 'triangle', 0.8, 0.5, 0.12)(ctx);
                });
                noise(0.5, 0.5, 0.06, 8000)(ctx);
            });
        },

        bossVictory() {
            play((ctx) => {
                [196, 294, 392, 494, 587, 784].forEach((f, i) => tone(f, 'triangle', 0.45, i * 0.1, 0.15)(ctx));
                noise(0.3, 0.5, 0.06, 4000)(ctx);
            });
        },

        bossFailure() {
            play((ctx) => {
                [330, 294, 220, 165].forEach((f, i) => tone(f, 'triangle', 0.3, i * 0.13, 0.12)(ctx));
            });
        },

        press() {
            play((ctx) => {
                tone(200, 'sine', 0.1, 0, 0.25)(ctx);
                noise(0.05, 0, 0.1, 1000)(ctx);
            });
        },

        habitDone() {
            play((ctx) => {
                tone(880, 'sine', 0.2, 0, 0.2)(ctx);
                tone(1109, 'sine', 0.3, 0.08, 0.15)(ctx);
            });
        },

        habitUndo() {
            play((ctx) => {
                tone(400, 'sine', 0.15, 0, 0.15)(ctx);
                tone(300, 'sine', 0.2, 0.08, 0.12)(ctx);
            });
        },

        counterUp() {
            play((ctx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(300, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.08);
                gain.gain.setValueAtTime(0.15, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.1);
            });
        },

        counterDown() {
            play((ctx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(500, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(250, ctx.currentTime + 0.08);
                gain.gain.setValueAtTime(0.12, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.1);
            });
        },

        questComplete() {
            play((ctx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(100, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.15);
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.2);
                [392, 523, 659].forEach((f) => {
                    tone(f, 'triangle', 0.4, 0.15, 0.15)(ctx);
                });
            });
        },

        streakBonus() {
            play((ctx) => {
                noise(0.4, 0, 0.1, 3000)(ctx);
                noise(0.3, 0.1, 0.08, 4000)(ctx);
                tone(1047, 'sine', 0.3, 0.2, 0.12)(ctx);
                tone(1319, 'sine', 0.4, 0.3, 0.1)(ctx);
            });
        },
    };
})();

export default AudioFX;
