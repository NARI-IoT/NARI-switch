/* NARI Smart Switch - microphone DSP engine.
 *
 * Clap recognition pipeline
 *   1. AudioWorklet (falls back to ScriptProcessor) watches 128-sample blocks, tracks the ambient noise floor and
 *      fires only on a *transient*: a sudden jump above both the floor and the last ~20 ms of audio.
 *   2. The ~170 ms of samples around the onset are shipped to the main thread and turned into a feature vector:
 *      attack time, decay time, crest factor, spectral flatness / centroid / roll-off, low-frequency ratio,
 *      zero-crossing rate, periodicity (voiced speech has it, claps don't) and 20 log-band energies.
 *   3. A generic "is this physically a clap" gate rejects shouts, music, knocks on wood, doors, etc.
 *   4. Optionally the vector is compared (z-score distance) with the user's *trained* profile so that only
 *      their own clap - not a similar-loudness noise - passes.
 *   5. Cadence (single / double / triple) is resolved by the consumer (sensors.js) from timestamps.
 *
 * Whistle detection runs on an AnalyserNode: a sustained, stable, narrow-band peak between 900 Hz and 4 kHz.
 */
(function (global) {
  "use strict";
  const NARI = global.NARI;
  const { bus } = NARI;
 
  const CAPTURE_LEN = 8192;        // samples captured per candidate (~170 ms @ 48 kHz)
  const PRE_ROLL = 512;
 
  // ---------------------------------------------------------------------------------------------
  // Worklet source (kept as a string so the app stays a static, single-origin GitHub Pages site).
  // ---------------------------------------------------------------------------------------------
  const WORKLET_SRC = `
  class NariTransientDetector extends AudioWorkletProcessor {
    constructor() {
      super();
      this.floor = 0.002; this.recent = new Float32Array(8); this.ri = 0;
      this.ring = new Float32Array(${PRE_ROLL}); this.rp = 0;
      this.capturing = false; this.cap = null; this.cp = 0; this.capPeak = 0; this.onsetTime = 0; this.onsetFloor = 0;
      this.refractoryUntil = 0; this.levelAcc = 0; this.levelN = 0; this.blocks = 0;
      this.minAbs = 0.01; this.floorRatio = 4; this.riseRatio = 3;
      this.port.onmessage = (e) => { const d = e.data || {}; if (d.minAbs) this.minAbs = d.minAbs; if (d.floorRatio) this.floorRatio = d.floorRatio; if (d.riseRatio) this.riseRatio = d.riseRatio; };
    }
    process(inputs) {
      const ch = inputs[0] && inputs[0][0];
      if (!ch) return true;
      let sum = 0, peak = 0;
      for (let i = 0; i < ch.length; i++) { const v = ch[i]; sum += v * v; const a = v < 0 ? -v : v; if (a > peak) peak = a; }
      const rms = Math.sqrt(sum / ch.length);
      const t = currentTime;
 
      // level meter (~every 12 blocks = 32 ms)
      this.levelAcc += rms; this.levelN++; this.blocks++;
      if (this.blocks % 12 === 0) { this.port.postMessage({ type: 'level', rms: this.levelAcc / this.levelN, floor: this.floor }); this.levelAcc = 0; this.levelN = 0; }
 
      if (this.capturing) {
        for (let i = 0; i < ch.length && this.cp < this.cap.length; i++) this.cap[this.cp++] = ch[i];
        if (peak > this.capPeak) this.capPeak = peak;
        if (this.cp >= this.cap.length) {
          this.port.postMessage({ type: 'candidate', samples: this.cap, sampleRate, time: this.onsetTime, floor: this.onsetFloor, peak: this.capPeak, preRoll: ${PRE_ROLL} }, [this.cap.buffer]);
          this.capturing = false; this.cap = null; this.refractoryUntil = t + 0.05;
        }
      } else {
        let rsum = 0; for (let i = 0; i < 8; i++) rsum += this.recent[i];
        const recentAvg = rsum / 8;
        const isOnset = t > this.refractoryUntil && rms > this.minAbs && rms > this.floor * this.floorRatio && rms > recentAvg * this.riseRatio;
        if (isOnset) {
          this.capturing = true; this.cap = new Float32Array(${CAPTURE_LEN}); this.cp = 0; this.capPeak = peak;
          this.onsetTime = t; this.onsetFloor = this.floor;
          for (let i = 0; i < ${PRE_ROLL}; i++) this.cap[this.cp++] = this.ring[(this.rp + i) % ${PRE_ROLL}];
          for (let i = 0; i < ch.length && this.cp < this.cap.length; i++) this.cap[this.cp++] = ch[i];
        } else {
          // ambient floor: rises slowly, falls a bit faster -> transients never lift it
          const a = rms > this.floor ? 0.004 : 0.03;
          this.floor += (rms - this.floor) * a;
          if (this.floor < 0.0005) this.floor = 0.0005;
        }
      }
      for (let i = 0; i < ch.length; i++) { this.ring[this.rp] = ch[i]; this.rp = (this.rp + 1) % ${PRE_ROLL}; }
      this.recent[this.ri] = rms; this.ri = (this.ri + 1) % 8;
      return true;
    }
  }
  registerProcessor('nari-transient', NariTransientDetector);`;
 
  // ---------------------------------------------------------------------------------------------
  // Small radix-2 FFT (real input) - returns magnitude spectrum
  // ---------------------------------------------------------------------------------------------
  function fftMag(re) {
    const n = re.length;
    const im = new Float32Array(n);
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < len / 2; j++) {
          const ur = re[i + j], ui = im[i + j];
          const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
          const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
          re[i + j] = ur + vr; im[i + j] = ui + vi;
          re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
    const mag = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    return mag;
  }
 
  // 20 bands, roughly log spaced 150 Hz .. 8 kHz
  const BAND_EDGES = (function () {
    const out = [];
    const lo = Math.log(150), hi = Math.log(8000);
    for (let i = 0; i <= 20; i++) out.push(Math.exp(lo + (hi - lo) * i / 20));
    return out;
  })();
 
  // ---------------------------------------------------------------------------------------------
  // Feature extraction
  // ---------------------------------------------------------------------------------------------
  function extractFeatures(samples, sampleRate, preRoll) {
    const n = samples.length;
    // --- envelope (1 ms hops) ---
    const hop = Math.max(8, Math.round(sampleRate / 1000));
    const env = [];
    for (let i = 0; i + hop <= n; i += hop) {
      let s = 0; for (let j = i; j < i + hop; j++) s += samples[j] * samples[j];
      env.push(Math.sqrt(s / hop));
    }
    let peakIdx = 0, peakVal = 0;
    for (let i = 0; i < env.length; i++) if (env[i] > peakVal) { peakVal = env[i]; peakIdx = i; }
    if (peakVal <= 0) return null;
 
    // attack: ms from 10% of peak to peak (searching backwards)
    let a = peakIdx;
    while (a > 0 && env[a] > peakVal * 0.1) a--;
    const attackMs = peakIdx - a;
 
    // decay: ms from peak until envelope stays under -20 dB (10%) for 5 consecutive ms
    let d = peakIdx, below = 0;
    for (; d < env.length; d++) { if (env[d] < peakVal * 0.1) { if (++below >= 5) break; } else below = 0; }
    const decayMs = Math.min(d - peakIdx, env.length - peakIdx);
 
    // sustain ratio: how much energy remains 60-120 ms after the peak (claps ~0, voice/music high)
    let late = 0, lateN = 0;
    for (let i = peakIdx + 60; i < Math.min(env.length, peakIdx + 120); i++) { late += env[i]; lateN++; }
    const sustain = lateN ? (late / lateN) / peakVal : 0;
 
    // tail ratio: energy 20-40 ms after the peak vs peak (knocks/doors ring longer than hand claps)
    let mid = 0, midN = 0;
    for (let i = peakIdx + 20; i < Math.min(env.length, peakIdx + 40); i++) { mid += env[i]; midN++; }
    const tail = midN ? (mid / midN) / peakVal : 0;
 
    // --- spectral analysis on 2048 samples starting just before the peak ---
    const N = 2048;
    let start = Math.max(0, peakIdx * hop - Math.round(0.002 * sampleRate));
    if (start + N > n) start = n - N;
    const frame = new Float32Array(N);
    let peakAbs = 0, rmsAcc = 0, zc = 0;
    for (let i = 0; i < N; i++) {
      const v = samples[start + i];
      frame[i] = v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
      const av = Math.abs(v); if (av > peakAbs) peakAbs = av; rmsAcc += v * v;
      if (i > 0 && ((v >= 0) !== (samples[start + i - 1] >= 0))) zc++;
    }
    const rms = Math.sqrt(rmsAcc / N);
    const crest = rms > 0 ? peakAbs / rms : 0;
    const zcr = zc / N;
 
    // periodicity via normalized autocorrelation (lags 2.5 ms .. 12.5 ms == 80..400 Hz voice pitch)
    let bestCorr = 0;
    {
      const minLag = Math.round(sampleRate / 400), maxLag = Math.round(sampleRate / 80);
      const M = 1024;
      let e0 = 0; for (let i = 0; i < M; i++) e0 += samples[start + i] * samples[start + i];
      for (let lag = minLag; lag <= maxLag && start + M + lag <= n; lag += 2) {
        let c = 0, e1 = 0;
        for (let i = 0; i < M; i++) { const b = samples[start + i + lag]; c += samples[start + i] * b; e1 += b * b; }
        const norm = Math.sqrt(e0 * e1) || 1;
        const r = c / norm;
        if (r > bestCorr) bestCorr = r;
      }
    }
 
    const mag = fftMag(frame);
    const binHz = sampleRate / N;
    let total = 0, weighted = 0, low = 0, geo = 0, cnt = 0, high = 0;
    for (let k = 1; k < mag.length; k++) {
      const f = k * binHz, p = mag[k] * mag[k];
      total += p; weighted += p * f;
      if (f < 300) low += p;
      if (f > 5000) high += p;
      if (f >= 150 && f <= 8000) { geo += Math.log(p + 1e-12); cnt++; }
    }
    const centroid = total > 0 ? weighted / total : 0;
    const lowRatio = total > 0 ? low / total : 0;
    const highRatio = total > 0 ? high / total : 0;
    // spectral flatness (geometric / arithmetic mean) inside 150..8000 Hz
    let arith = 0, cnt2 = 0;
    for (let k = 1; k < mag.length; k++) { const f = k * binHz; if (f >= 150 && f <= 8000) { arith += mag[k] * mag[k]; cnt2++; } }
    arith = cnt2 ? arith / cnt2 : 1e-12;
    const flatness = cnt ? Math.exp(geo / cnt) / (arith || 1e-12) : 0;
    // roll-off 85 %
    let acc = 0, rolloff = 0;
    for (let k = 1; k < mag.length; k++) { acc += mag[k] * mag[k]; if (acc >= total * 0.85) { rolloff = k * binHz; break; } }
 
    // 20 log band energies, normalised (shape only)
    const bands = new Array(20).fill(0);
    for (let k = 1; k < mag.length; k++) {
      const f = k * binHz;
      if (f < BAND_EDGES[0] || f >= BAND_EDGES[20]) continue;
      let b = 0; while (b < 19 && f >= BAND_EDGES[b + 1]) b++;
      bands[b] += mag[k] * mag[k];
    }
    const bandsDb = bands.map(v => 10 * Math.log10(v + 1e-10));
    const meanDb = bandsDb.reduce((s, v) => s + v, 0) / bandsDb.length;
    const bandsNorm = bandsDb.map(v => v - meanDb);
 
    return {
      attackMs, decayMs, sustain, tail, crest, zcr, periodicity: bestCorr,
      centroid, lowRatio, highRatio, flatness, rolloff, peak: peakAbs, rms,
      bands: bandsNorm
    };
  }
 
  // ---------------------------------------------------------------------------------------------
  // Generic clap gate - physics of a hand clap, independent of the user
  // ---------------------------------------------------------------------------------------------
  function genericGate(f, sensitivity) {
    // sensitivity 0..1 : 1 == very permissive
    const s = Math.min(1, Math.max(0, sensitivity === undefined ? 0.6 : sensitivity));
    const reasons = [];
    if (f.attackMs > 6 + s * 6) reasons.push("attack too slow (not a snap)");
    if (f.decayMs < 6) reasons.push("too short (click/pop)");
    if (f.decayMs > 90 + s * 90) reasons.push("rings too long (door/knock/voice)");
    if (f.sustain > 0.12 + s * 0.15) reasons.push("sound continues (voice/music)");
    if (f.periodicity > 0.45 + s * 0.25) reasons.push("tonal/voiced");
    if (f.flatness < 0.06 - s * 0.03) reasons.push("too tonal");
    if (f.centroid < 800 - s * 300) reasons.push("too bassy (thud/knock)");
    if (f.centroid > 8500) reasons.push("too hissy");
    if (f.lowRatio > 0.35 + s * 0.2) reasons.push("low-frequency thump");
    if (f.crest < 2.2) reasons.push("not impulsive");
    return { pass: reasons.length === 0, reasons };
  }
 
  // ---------------------------------------------------------------------------------------------
  // Trained profile
  // ---------------------------------------------------------------------------------------------
  const PROFILE_KEYS = ["attackMs", "decayMs", "sustain", "tail", "crest", "zcr", "periodicity", "centroid", "lowRatio", "highRatio", "flatness", "rolloff"];
  // std floors so a handful of training claps can't produce an over-tight profile
  const STD_FLOOR = { attackMs: 1.5, decayMs: 12, sustain: 0.04, tail: 0.06, crest: 0.8, zcr: 0.03, periodicity: 0.08, centroid: 350, lowRatio: 0.05, highRatio: 0.06, flatness: 0.05, rolloff: 600, band: 3 };
 
  function toVector(f) {
    const v = PROFILE_KEYS.map(k => f[k]);
    return v.concat(f.bands);
  }
 
  function buildProfile(featureList) {
    const vecs = featureList.map(toVector);
    const dim = vecs[0].length;
    const mean = new Array(dim).fill(0), std = new Array(dim).fill(0);
    vecs.forEach(v => v.forEach((x, i) => { mean[i] += x / vecs.length; }));
    vecs.forEach(v => v.forEach((x, i) => { std[i] += (x - mean[i]) * (x - mean[i]) / vecs.length; }));
    for (let i = 0; i < dim; i++) {
      const floor = i < PROFILE_KEYS.length ? STD_FLOOR[PROFILE_KEYS[i]] : STD_FLOOR.band;
      std[i] = Math.max(Math.sqrt(std[i]), floor);
    }
    return { v: 2, n: vecs.length, mean, std, createdAt: Date.now() };
  }
 
  function profileDistance(f, profile) {
    if (!profile || !Array.isArray(profile.mean)) return Infinity;
    const v = toVector(f);
    if (v.length !== profile.mean.length) return Infinity;
    let acc = 0;
    for (let i = 0; i < v.length; i++) { const z = (v[i] - profile.mean[i]) / profile.std[i]; acc += z * z; }
    return Math.sqrt(acc / v.length);   // RMS z-score
  }
 
  /** Full classification. Returns {pass, reasons, distance, generic}. */
  function classify(features, opts) {
    opts = opts || {};
    const sens = opts.sensitivity === undefined ? 0.6 : opts.sensitivity;
    const generic = genericGate(features, sens);
    const out = { pass: generic.pass, reasons: generic.reasons.slice(), distance: null, generic: generic.pass };
    if (opts.profile && opts.profile.mean) {
      out.distance = profileDistance(features, opts.profile);
      const limit = 1.6 + sens * 1.6;        // 1.6 (strict) .. 3.2 (loose)
      if (out.distance > limit) { out.pass = false; out.reasons.push(`doesn't match your trained clap (d=${out.distance.toFixed(2)} > ${limit.toFixed(1)})`); }
      else if (opts.strict === false && !generic.pass && out.distance < limit * 0.6) {
        // Very close to the trained profile: allow it even if a generic rule was borderline.
        out.pass = true; out.reasons = [];
      }
    }
    return out;
  }
 
  // ---------------------------------------------------------------------------------------------
  // Engine
  // ---------------------------------------------------------------------------------------------
  const audio = {
    ctx: null, stream: null, source: null, worklet: null, analyser: null, scriptNode: null,
    running: false, consumers: new Set(), level: 0, floor: 0, lastCandidate: null,
    _whistleTimer: null, _whistle: { startAt: 0, freq: 0, fired: false },
    sensitivity: 0.6,
 
    supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (global.AudioContext || global.webkitAudioContext)); },
 
    /** Acquire the mic (once) and start the DSP graph. Consumers are tags like "clap:<id>" / "whistle:<id>". */
    async start(consumer) {
      if (consumer) this.consumers.add(consumer);
      if (this.running) { if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume().catch(() => {}); return true; }
      if (!this.supported()) { bus.emit("toast", { text: "Microphone / Web Audio not supported in this browser", level: "error" }); return false; }
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
        });
      } catch (e) {
        bus.emit("audio:error", e);
        bus.emit("toast", { text: "Microphone permission denied. Allow the mic for this site to use sound modes.", level: "error" });
        return false;
      }
      const Ctx = global.AudioContext || global.webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: "interactive" });
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.2;
      this.source.connect(this.analyser);
 
      let ok = false;
      if (this.ctx.audioWorklet) {
        try {
          const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
          await this.ctx.audioWorklet.addModule(url);
          this.worklet = new AudioWorkletNode(this.ctx, "nari-transient", { numberOfInputs: 1, numberOfOutputs: 0 });
          this.worklet.port.onmessage = (e) => this._onWorkletMessage(e.data);
          this.source.connect(this.worklet);
          ok = true;
        } catch (e) { console.warn("AudioWorklet unavailable, falling back", e); }
      }
      if (!ok) this._startScriptProcessorFallback();
 
      this.running = true;
      this.setSensitivity(this.sensitivity);
      this._startWhistleLoop();
      if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
      bus.emit("audio:state", { running: true });
      return true;
    },
 
    stop(consumer) {
      if (consumer) this.consumers.delete(consumer);
      if (this.consumers.size && consumer) return;
      this.consumers.clear();
      clearInterval(this._whistleTimer); this._whistleTimer = null;
      try { this.worklet && this.worklet.disconnect(); } catch (e) {}
      try { this.scriptNode && this.scriptNode.disconnect(); } catch (e) {}
      try { this.source && this.source.disconnect(); } catch (e) {}
      try { this.stream && this.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
      try { this.ctx && this.ctx.close(); } catch (e) {}
      this.ctx = this.stream = this.source = this.worklet = this.analyser = this.scriptNode = null;
      this.running = false; this.level = 0;
      bus.emit("audio:state", { running: false });
      bus.emit("audio:level", { level: 0, floor: 0 });
    },
 
    setSensitivity(s) {
      this.sensitivity = Math.min(1, Math.max(0, s));
      // very sensitive -> lower absolute threshold and smaller jump over the floor
      const params = {
        minAbs: 0.03 - this.sensitivity * 0.026,      // 0.03 .. 0.004
        floorRatio: 8 - this.sensitivity * 5.5,       // 8 .. 2.5
        riseRatio: 4 - this.sensitivity * 1.8         // 4 .. 2.2
      };
      this._params = params;
      if (this.worklet) this.worklet.port.postMessage(params);
    },
 
    _onWorkletMessage(d) {
      if (!d) return;
      if (d.type === "level") {
        this.level = d.rms; this.floor = d.floor;
        bus.emit("audio:level", { level: d.rms, floor: d.floor });
      } else if (d.type === "candidate") {
        this._handleCandidate(d.samples, d.sampleRate, d.time, d.floor, d.preRoll);
      }
    },
 
    _handleCandidate(samples, sampleRate, time, floor, preRoll) {
      const f = extractFeatures(samples, sampleRate, preRoll);
      if (!f) return;
      f.snrDb = floor > 0 ? 20 * Math.log10((f.peak || 1e-6) / floor) : 60;
      const cand = { features: f, time: time || (this.ctx ? this.ctx.currentTime : performance.now() / 1000), wall: Date.now(), generic: genericGate(f, this.sensitivity) };
      this.lastCandidate = cand;
      bus.emit("audio:candidate", cand);
    },
 
    // ScriptProcessor fallback (older WebViews). Same detector, coarser (1024-sample) time resolution.
    _startScriptProcessorFallback() {
      const node = this.ctx.createScriptProcessor(1024, 1, 1);
      const self = this;
      let floor = 0.002, refractoryUntil = 0, recent = [0, 0, 0, 0];
      let cap = null, cp = 0, onsetTime = 0, onsetFloor = 0;
      node.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        let sum = 0; for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
        const rms = Math.sqrt(sum / ch.length);
        const t = self.ctx.currentTime;
        self.level = rms; self.floor = floor;
        bus.emit("audio:level", { level: rms, floor });
        if (cap) {
          for (let i = 0; i < ch.length && cp < cap.length; i++) cap[cp++] = ch[i];
          if (cp >= cap.length) { const s = cap; cap = null; refractoryUntil = t + 0.05; self._handleCandidate(s, self.ctx.sampleRate, onsetTime, onsetFloor, 0); }
        } else {
          const p = self._params || { minAbs: 0.01, floorRatio: 4, riseRatio: 3 };
          const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
          if (t > refractoryUntil && rms > p.minAbs && rms > floor * p.floorRatio && rms > recentAvg * p.riseRatio) {
            cap = new Float32Array(CAPTURE_LEN); cp = 0; onsetTime = t; onsetFloor = floor;
            for (let i = 0; i < ch.length && cp < cap.length; i++) cap[cp++] = ch[i];
          } else {
            floor += (rms - floor) * (rms > floor ? 0.02 : 0.1);
            if (floor < 0.0005) floor = 0.0005;
          }
        }
        recent.push(rms); recent.shift();
      };
      this.source.connect(node);
      const sink = this.ctx.createGain(); sink.gain.value = 0; node.connect(sink); sink.connect(this.ctx.destination);
      this.scriptNode = node;
    },
 
    // ---------------- whistle ----------------
    _startWhistleLoop() {
      clearInterval(this._whistleTimer);
      const buf = new Float32Array(this.analyser.frequencyBinCount);
      this._whistleTimer = setInterval(() => {
        if (!this.analyser || !this.ctx) return;
        this.analyser.getFloatFrequencyData(buf);
        const binHz = this.ctx.sampleRate / this.analyser.fftSize;
        const lo = Math.floor(900 / binHz), hi = Math.ceil(4000 / binHz);
        let peakIdx = lo, peakDb = -Infinity, sum = 0, n = 0;
        for (let k = Math.floor(150 / binHz); k < Math.ceil(8000 / binHz) && k < buf.length; k++) { sum += buf[k]; n++; }
        for (let k = lo; k <= hi && k < buf.length; k++) if (buf[k] > peakDb) { peakDb = buf[k]; peakIdx = k; }
        const meanDb = n ? sum / n : -100;
        // tonal: peak stands >= 22 dB above the band mean, is loud enough, and its neighbours fall off fast
        const side = Math.max(buf[Math.max(0, peakIdx - 6)] || -200, buf[Math.min(buf.length - 1, peakIdx + 6)] || -200);
        const isTone = peakDb > -55 && peakDb - meanDb > 22 && peakDb - side > 12;
        const freq = peakIdx * binHz;
        const w = this._whistle;
        const now = performance.now();
        if (isTone && (w.startAt === 0 || Math.abs(freq - w.freq) / w.freq < 0.08)) {
          if (w.startAt === 0) { w.startAt = now; w.freq = freq; w.fired = false; }
          if (!w.fired && now - w.startAt > 280) {
            w.fired = true;
            bus.emit("audio:whistle", { freq, durationMs: now - w.startAt, wall: Date.now() });
          }
        } else if (!isTone) {
          if (w.startAt && now - w.startAt > 120) { w.startAt = 0; }
        } else {
          w.startAt = now; w.freq = freq; w.fired = false;
        }
      }, 40);
    },
 
    // ---------------- training ----------------
    /**
     * Collect `count` gated claps. onProgress(collected, count, info). Resolves the profile or null when cancelled.
     * Returns a controller with .cancel().
     */
    train(count, onProgress) {
      count = count || 6;
      const collected = [];
      let done = false, resolveFn;
      const promise = new Promise(res => { resolveFn = res; });
      const off = bus.on("audio:candidate", (cand) => {
        if (done) return;
        const g = genericGate(cand.features, Math.min(1, this.sensitivity + 0.2));
        if (!g.pass) { onProgress && onProgress(collected.length, count, { rejected: true, reasons: g.reasons }); return; }
        if (collected.length && cand.wall - collected[collected.length - 1].wall < 250) return; // same clap echo
        collected.push({ f: cand.features, wall: cand.wall });
        onProgress && onProgress(collected.length, count, { accepted: true });
        if (collected.length >= count) {
          done = true; off();
          resolveFn(buildProfile(collected.map(c => c.f)));
        }
      });
      const ctrl = { promise, cancel() { if (!done) { done = true; off(); resolveFn(null); } } };
      this.start("train");
      promise.finally(() => this.stop("train"));
      return ctrl;
    },
 
    classify, genericGate, extractFeatures, buildProfile, profileDistance
  };
 
  NARI.audio = audio;
})(window);
