const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const safeVolume = (value) => Number.isFinite(Number(value)) ? clamp(Number(value), 0, 1) : 0.35;

/** Gesture-unlocked, asset-free flight ambience. No audio objects exist at construction. */
export class FlightAudio {
  constructor({ enabled = true, volume = 0.35 } = {}) {
    this._enabled = Boolean(enabled);
    this._volume = safeVolume(volume);
    this._active = false;
    this._speed = 14;
    this._boost = false;
    this._context = null;
    this._nodes = null;
    this._unlockPromise = null;
    this._unavailable = false;
    this._disposed = false;
  }

  /** Call only from a click, tap, or keyboard gesture. Returns false if unsupported/blocked. */
  async unlock() {
    if (this._disposed) return false;
    if (this._unlockPromise) return this._unlockPromise;
    this._unlockPromise = this._unlock();
    try {
      return await this._unlockPromise;
    } finally {
      this._unlockPromise = null;
    }
  }

  async _unlock() {
    try {
      if (!this._context) {
        const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContextClass) {
          this._unavailable = true;
          return false;
        }
        this._context = new AudioContextClass();
        this._createNodes();
      }
      if (this._context.state !== 'running') await this._context.resume();
      this._applyMix();
      return this._context.state === 'running';
    } catch {
      // Browsers without WebAudio or with a blocked audio device still support
      // the game. A later gesture can retry an existing suspended context.
      if (this._context && !this._nodes) {
        try { await this._context.close(); } catch { /* Already closed. */ }
        this._context = null;
      }
      return false;
    }
  }

  _createNodes() {
    const context = this._context;
    const master = context.createGain();
    master.gain.value = 0;
    const ambient = context.createGain();
    ambient.gain.value = 0;
    ambient.connect(master);

    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -18;
    limiter.knee.value = 18;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.008;
    limiter.release.value = 0.2;
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    master.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(context.destination);

    const windSource = context.createBufferSource();
    const noiseLength = Math.floor(context.sampleRate * 4);
    const noiseBuffer = context.createBuffer(2, noiseLength, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = noiseBuffer.getChannelData(channel);
      for (let frame = 0; frame < noiseLength; frame++) data[frame] = Math.random() * 2 - 1;
      // Match the loop's edge without fading the whole wind bed to silence.
      const blendLength = Math.floor(context.sampleRate * 0.02);
      const edgeDifference = data[0] - data[noiseLength - 1];
      for (let frame = 0; frame < blendLength; frame++) {
        data[noiseLength - blendLength + frame] += edgeDifference * frame / (blendLength - 1);
      }
    }
    windSource.buffer = noiseBuffer;
    windSource.loop = true;
    const windHighpass = context.createBiquadFilter();
    windHighpass.type = 'highpass';
    windHighpass.frequency.value = 140;
    windHighpass.Q.value = 0.5;
    const windBandpass = context.createBiquadFilter();
    windBandpass.type = 'bandpass';
    windBandpass.frequency.value = 650;
    windBandpass.Q.value = 0.55;
    const windLowpass = context.createBiquadFilter();
    windLowpass.type = 'lowpass';
    windLowpass.frequency.value = 2600;
    windLowpass.Q.value = 0.5;
    const windGain = context.createGain();
    windGain.gain.value = 0.1;
    windSource.connect(windHighpass);
    windHighpass.connect(windBandpass);
    windBandpass.connect(windLowpass);
    windLowpass.connect(windGain);
    windGain.connect(ambient);

    const engines = [
      { type: 'sine', multiplier: 1, gain: 0.13 },
      { type: 'triangle', multiplier: 2.01, gain: 0.045 },
      { type: 'sine', multiplier: 3.03, gain: 0.018 },
    ].map((settings) => {
      const oscillator = context.createOscillator();
      oscillator.type = settings.type;
      oscillator.frequency.value = 48 * settings.multiplier;
      const gain = context.createGain();
      gain.gain.value = settings.gain;
      oscillator.connect(gain);
      gain.connect(ambient);
      return { oscillator, gain, multiplier: settings.multiplier, baseGain: settings.gain };
    });
    // These oscillators are also reused: collecting stars never allocates a
    // new graph, and the tiny envelope starts and ends smoothly.
    const chimes = [523.25, 659.25, 783.99].map((frequency) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.value = 0;
      oscillator.connect(gain);
      gain.connect(master);
      return { oscillator, gain };
    });

    this._nodes = {
      master, ambient, limiter, analyser, meter: new Float32Array(analyser.fftSize),
      windSource, windHighpass, windBandpass, windLowpass, windGain, engines, chimes,
    };
    windSource.start();
    for (const { oscillator } of [...engines, ...chimes]) oscillator.start();
  }

  _ramp(parameter, target, seconds = 0.15) {
    const now = this._context.currentTime;
    if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(now);
    else {
      parameter.cancelScheduledValues(now);
      parameter.setValueAtTime(parameter.value, now);
    }
    parameter.linearRampToValueAtTime(target, now + seconds);
  }

  _applyMix() {
    if (!this._nodes || this._context.state === 'closed') return;
    const { master, ambient, windGain, windBandpass, engines } = this._nodes;
    const throttle = clamp((this._speed - 14) / 57 + (this._boost ? 0.08 : 0), 0, 1);
    this._ramp(master.gain, this._enabled ? this._volume : 0, 0.09);
    this._ramp(ambient.gain, this._enabled && this._active ? 1 : 0, 0.12);
    this._ramp(windGain.gain, 0.10 + throttle * 0.10, 0.3);
    this._ramp(windBandpass.frequency, 650 + throttle * 1000, 0.3);
    for (const engine of engines) {
      this._ramp(engine.oscillator.frequency, (48 + throttle * 26) * engine.multiplier, 0.3);
      this._ramp(engine.gain.gain, engine.baseGain * (1 + throttle * 0.28), 0.3);
    }
  }

  setEnabled(enabled) {
    const nextEnabled = Boolean(enabled);
    if (nextEnabled === this._enabled) return;
    this._enabled = nextEnabled;
    if (!this._enabled) this._silenceChimes();
    this._applyMix();
  }

  setVolume(volume) {
    this._volume = safeVolume(volume);
    this._applyMix();
  }

  setActive(active) {
    const nextActive = Boolean(active);
    if (nextActive === this._active) return;
    this._active = nextActive;
    if (!this._active) this._silenceChimes();
    this._applyMix();
  }

  _silenceChimes() {
    if (!this._nodes || this._context.state === 'closed') return;
    for (const { gain } of this._nodes.chimes) this._ramp(gain.gain, 0, 0.09);
  }

  setFlight(speed, boost = false) {
    const nextSpeed = Number.isFinite(Number(speed)) ? clamp(Number(speed), 14, 80) : 14;
    const nextBoost = Boolean(boost);
    if (Math.abs(nextSpeed - this._speed) < 0.02 && nextBoost === this._boost) return;
    this._speed = nextSpeed;
    this._boost = nextBoost;
    this._applyMix();
  }

  playChime() {
    if (!this._nodes || !this._enabled || this._volume === 0 || this._context.state !== 'running') return;
    const now = this._context.currentTime;
    this._nodes.chimes.forEach(({ gain }, index) => {
      const start = now + index * 0.095;
      this._ramp(gain.gain, 0, 0.01);
      gain.gain.setValueAtTime(0, start + 0.012);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.028);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      gain.gain.linearRampToValueAtTime(0, start + 0.34);
    });
  }

  getStatus() {
    let level = 0;
    if (this._nodes && this._context.state === 'running') {
      const { analyser, meter } = this._nodes;
      analyser.getFloatTimeDomainData(meter);
      let sum = 0;
      for (const sample of meter) sum += sample * sample;
      level = Math.sqrt(sum / meter.length);
    }
    return {
      initialized: Boolean(this._context),
      enabled: this._enabled,
      volume: this._volume,
      active: this._active,
      contextState: this._context?.state || (this._disposed ? 'closed' : this._unavailable ? 'unsupported' : 'uninitialized'),
      boost: this._boost,
      level,
    };
  }

  async dispose() {
    this._disposed = true;
    this._active = false;
    if (!this._context) return;
    if (this._nodes) {
      this._nodes.windSource.stop();
      for (const { oscillator } of [...this._nodes.engines, ...this._nodes.chimes]) oscillator.stop();
      this._nodes.analyser.disconnect();
    }
    try { await this._context.close(); } catch { /* Already closed. */ }
    this._context = null;
    this._nodes = null;
  }
}
