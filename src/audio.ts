/* Synthesized Orion SFX. A single master bus owns volume and cancellable voices. */
export interface AudioSettings { enabled: boolean; volume: number }
function readSettings(): AudioSettings {
    if (typeof window === 'undefined') return { enabled: false, volume: .4 };
    try {
        const saved = localStorage.getItem('orion-volume');
        const volume = saved === null ? .4 : Number(saved);
        return { enabled: localStorage.getItem('orion-sound') === 'on', volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : .4 };
    } catch { return { enabled: false, volume: .4 }; }
}
const AudioFX = (() => {
    let settings = readSettings();
    let ctx: AudioContext | null = null;
    let master: GainNode | null = null;
    const voices = new Set<AudioScheduledSourceNode>();
    const listeners = new Set<() => void>();
    const queue: { play: () => void; duration: number }[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    function getCtx() {
        if (!ctx) {
            const AudioContextClass = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!AudioContextClass) throw new Error('Audio unavailable');
            ctx = new AudioContextClass();
            master = ctx.createGain(); master.gain.value = settings.volume;
            const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -12; limiter.ratio.value = 8;
            master.connect(limiter); limiter.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
        return ctx;
    }
    function stop() {
        queue.length = 0; clearTimeout(timer); timer = undefined;
        if (!ctx || !master) return;
        const time = ctx.currentTime;
        master.gain.cancelScheduledValues(time);
        master.gain.setValueAtTime(master.gain.value, time);
        master.gain.linearRampToValueAtTime(0, time + .025);
        for (const voice of voices) { try { voice.stop(time + .03); } catch { /* Already ended. */ } }
        voices.clear();
    }
    function update(next: AudioSettings) {
        settings = next;
        if (!settings.enabled || settings.volume === 0) stop();
        else if (ctx && master) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setTargetAtTime(settings.volume, ctx.currentTime, .015); }
        try { localStorage.setItem('orion-sound', settings.enabled ? 'on' : 'off'); localStorage.setItem('orion-volume', String(settings.volume)); } catch { /* In-memory settings remain usable. */ }
        listeners.forEach(listener => listener());
    }
    function connect(source: AudioScheduledSourceNode, duration: number, delay: number, volume: number, pan: number, filter?: BiquadFilterNode) {
        const context = getCtx(); const time = context.currentTime + delay;
        const envelope = context.createGain(); const position = context.createStereoPanner(); position.pan.value = pan;
        envelope.gain.setValueAtTime(.0001, time);
        envelope.gain.linearRampToValueAtTime(volume, time + .012);
        envelope.gain.exponentialRampToValueAtTime(.0001, time + duration);
        if (filter) { source.connect(filter); filter.connect(envelope); } else source.connect(envelope);
        envelope.connect(position); position.connect(master!);
        voices.add(source);
        source.onended = () => { voices.delete(source); source.disconnect(); filter?.disconnect(); envelope.disconnect(); position.disconnect(); };
        source.start(time); source.stop(time + duration + .01);
    }
    function note(frequency: number, delay: number, duration = .28, volume = .15, pan = 0, type: OscillatorType = 'sine') {
        const source = getCtx().createOscillator(); source.type = type; source.frequency.value = frequency;
        connect(source, duration, delay, volume, pan);
    }
    function shimmer(delay = 0, duration = .22) {
        const context = getCtx(); const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
        const samples = buffer.getChannelData(0); for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
        const source = context.createBufferSource(); source.buffer = buffer;
        const filter = context.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 3400; filter.Q.value = .7;
        connect(source, duration, delay, .07, 0, filter);
    }
    function play(pattern: () => void) {
        if (!settings.enabled || settings.volume === 0) return;
        try {
            const context = getCtx(); master!.gain.cancelScheduledValues(context.currentTime); master!.gain.setTargetAtTime(settings.volume, context.currentTime, .015);
            pattern();
        } catch { /* Audio is optional and autoplay restrictions never block a save. */ }
    }
    function phrase(notes: number[], step = .09, sustain = .3, bass?: number) {
        notes.forEach((frequency, i) => { note(frequency, i * step, sustain, .15, i % 2 ? .18 : -.18); note(frequency * 2, i * step + .025, sustain * .6, .035, i % 2 ? -.25 : .25); });
        if (bass) note(bass, 0, .6, .18, 0, 'triangle');
    }
    function nextCue() {
        const cue = settings.enabled ? queue.shift() : undefined;
        if (!cue) { timer = undefined; return; }
        cue.play(); timer = setTimeout(nextCue, cue.duration);
    }
    return {
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        settings: () => settings,
        setEnabled(enabled: boolean) { update({ ...settings, enabled }); },
        setVolume(volume: number) { if (Number.isFinite(volume)) update({ ...settings, volume: Math.max(0, Math.min(1, volume)) }); },
        isEnabled: () => settings.enabled,
        stop,
        isPlaying: () => voices.size > 0 || timer !== undefined,
        enqueue(cues: { play: () => void; duration: number }[]) {
            if (!settings.enabled || settings.volume === 0 || !cues.length) return;
            queue.push(...cues); if (timer === undefined) nextCue();
        },
        unlock() { if (settings.enabled) { try { getCtx(); } catch { /* Unsupported browser. */ } } },
        click() { if (!voices.size && timer === undefined) play(() => { note(660, 0, .065, .06, -.1); note(990, .025, .065, .035, .1); }); },
        success() { play(() => phrase([392, 523, 784], .075, .25, 130.81)); },
        todoComplete() { play(() => phrase([659, 988], .07, .23)); },
        habitDone() { play(() => phrase([554, 740, 1109], .09, .3, 185)); },
        recoveryComplete() { play(() => { phrase([440, 659, 880], .11, .4, 146.83); shimmer(.12); }); },
        trainingComplete() { play(() => { phrase([196, 294, 392, 587], .08, .3, 98); shimmer(0, .12); }); },
        questComplete() { play(() => { phrase([659, 988, 1319], .14, .35, 164.81); shimmer(.2); }); },
        achievement() { play(() => { phrase([523, 659, 784, 1047], .1, .5, 130.81); shimmer(.2, .4); }); },
        levelUp() { play(() => { phrase([262, 330, 392, 523, 659, 784, 1047], .07, .35, 130.81); [523, 659, 784].forEach(f => note(f, .55, .8, .09)); shimmer(.5, .5); }); },
        rankUp() { play(() => { phrase([196, 294, 392, 587, 784, 1175], .12, .6, 98); [392, 494, 587, 784].forEach(f => note(f, .6, 1.05, .08)); shimmer(.65, .6); }); },
        bossVictory() { play(() => { phrase([196, 294, 392, 494, 587, 784], .1, .45, 98); shimmer(.45, .4); }); },
        bossFailure() { play(() => phrase([330, 294, 220, 165], .13, .3, 82.41)); },
        loss() { play(() => { note(330, 0, .24, .1); note(220, .12, .28, .09); }); },
        counterUp() { play(() => phrase([440, 660], .05, .16)); },
    };
})();
export default AudioFX;
