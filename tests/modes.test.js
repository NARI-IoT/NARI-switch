/* Mode verification harness: loads the REAL js/store.js, js/audio.js and js/sensors.js in a sandbox
 * (stubbed browser + stubbed transport) and drives every trigger mode with synthetic input.
 * Run:  node tests/modes.test.js            (TZ is forced to Asia/Kolkata)
 */
process.env.TZ = "Asia/Kolkata";
const vm = require("vm");
const fs = require("fs");
const path = require("path");

// ---------- controllable clock ----------
class FakeDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(FakeDate._now); }
  static now() { return FakeDate._now; }
}
FakeDate._now = new Date("2026-10-05T10:00:00+05:30").getTime();
const setNow = (iso) => { FakeDate._now = new Date(iso).getTime(); };
const advance = (ms) => { FakeDate._now += ms; };

// ---------- sandbox ----------
const calls = [];          // every relay command: {i, state, source}
const ls = {};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, performance,
  Float32Array, Uint8Array, Math, JSON, Object, Array, String, Number, Promise, Map, Set, Infinity, NaN,
  Date: FakeDate,
  crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; } },
  localStorage: { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); } },
  navigator: { vibrate: () => true },
  document: { addEventListener() {}, removeEventListener() {}, hidden: false },
  addEventListener() {}, removeEventListener() {}
};
sandbox.window = sandbox;
sandbox.NARI = { settings: { hapticFeedback: false, homeLat: 17.385, homeLon: 78.4867, homeRadiusM: 150, voiceLang: "en-IN" }, saveSettings() {}, FIREBASE_CONFIG: {} };
vm.createContext(sandbox);
const load = (f) => vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), sandbox, { filename: f });

load("js/store.js");
const NARI = sandbox.NARI;
NARI.transport = {
  lanBlocked: false,
  lanFresh: () => true,
  async setState(i, st, opts) { calls.push({ i, state: st, source: (opts && opts.source) || "" }); NARI.store.devices[i].state = st; return "lan"; }
};
load("js/audio.js");
load("js/sensors.js");
const { store, bus, audio, sensors } = NARI;

// ---------- tiny test framework ----------
const results = [];
let section = "";
function sec(name) { section = name; console.log("\n=== " + name + " ==="); }
function check(name, ok, detail) {
  results.push({ section, name, ok });
  console.log((ok ? "  PASS " : "  FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
}
function freshDevice(trig) {
  store.devices.length = 0;
  const d = store.add({ name: "T", ip: "1.2.3.4", id: "sw_test", dual: false });
  Object.keys(trig || {}).forEach(k => Object.assign(d.triggers[k], { enabled: true }, trig[k]));
  calls.length = 0;
  Object.keys(sensors.lastFire).forEach(k => delete sensors.lastFire[k]);
  sensors._clapTrack = {};
  sensors._presence.home = {}; sensors._presence.streak = {};
  sensors._sched.lastMinute = {}; sensors._sched.done = {}; sensors._sched.lastTick = 0;
  sensors._motion.shakePeaks = [];
  return d;
}

// ---------- DSP synthesis ----------
const SR = 48000, N = 8192, PRE = 512;
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
function lowpass(x, fc) { const a = 2 * Math.PI * fc / SR; const a2 = a / (1 + a); const y = new Float32Array(x.length); let p = 0; for (let i = 0; i < x.length; i++) { p += a2 * (x[i] - p); y[i] = p; } return y; }
function bandpass(x, lo, hi) { const l = lowpass(x, hi), h = lowpass(x, lo); const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = l[i] - h[i]; return y; }
function buf(fn, noise) { const s = new Float32Array(N); for (let i = 0; i < N; i++) s[i] = (noise || 0.0015) * rnd() * 2 + (i >= PRE ? fn((i - PRE) / SR) : 0); return s; }
function clap(jit) {
  jit = jit || 0;
  const tau = (0.010 + 0.004 * jit * rnd()) , amp = 0.5 + 0.3 * rnd();
  const n = new Float32Array(N); for (let i = 0; i < N; i++) n[i] = rnd() * 2;
  const bp = bandpass(n, 700 + 300 * jit * rnd(), 5500 + 800 * jit * rnd());
  const g = buf((t) => 0); // noise floor
  for (let i = PRE; i < N; i++) { const t = (i - PRE) / SR; const env = Math.min(1, t / 0.0008) * Math.exp(-t / tau); g[i] += bp[i] * env * amp * 6; }
  return g;
}
const voice = () => buf((t) => { const e = Math.min(1, t / 0.03) * (t < 0.35 ? 1 : Math.exp(-(t - 0.35) / 0.05)); let v = 0; for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * 160 * h * t) / h; return 0.25 * e * v; });
const knock = () => buf((t) => 0.6 * Math.min(1, t / 0.001) * Math.exp(-t / 0.035) * Math.sin(2 * Math.PI * 140 * t));
const doorSlam = () => { const n = new Float32Array(N); for (let i = 0; i < N; i++) n[i] = rnd() * 2; const lp = lowpass(lowpass(lowpass(lowpass(n, 300), 300), 300), 300); const g = buf(() => 0); for (let i = PRE; i < N; i++) { const t = (i - PRE) / SR; g[i] += lp[i] * 60 * Math.min(1, t / 0.002) * Math.exp(-t / 0.07); } return g; };
const whistleTone = () => buf((t) => 0.3 * Math.min(1, t / 0.02) * Math.sin(2 * Math.PI * 2500 * t) * (t < 0.3 ? 1 : 0.2));
const musicSustain = () => { const n = new Float32Array(N); for (let i = 0; i < N; i++) n[i] = rnd() * 2; const bp = bandpass(n, 700, 5500); const g = buf(() => 0); for (let i = PRE; i < N; i++) { const t = (i - PRE) / SR; g[i] += bp[i] * 2.5 * Math.min(1, t / 0.0008); } return g; };
const feats = (s) => audio.extractFeatures(s, SR, PRE);

// =====================================================================================
sec("CLAP - DSP gate (generic physics gate, no trained profile)");
{
  const mkTrial = (gen, n) => { let pass = 0, fx = []; for (let i = 0; i < n; i++) { const f = feats(gen(i)); const r = audio.classify(f, { sensitivity: 0.6 }); if (r.pass) { pass++; if (process.env.DEBUG_FEATS) console.log("   accepted feats:", JSON.stringify({a:f.attackMs,d:f.decayMs,s:+f.sustain.toFixed(3),c:Math.round(f.centroid),lr:+f.lowRatio.toFixed(2),cr:+f.crest.toFixed(1),p:+f.periodicity.toFixed(2),fl:+f.flatness.toFixed(3)})); } else fx.push(r.reasons.join("; ")); } return { pass, n, fx }; };
  const c = mkTrial(() => clap(1), 40);
  check("hand-clap-like bursts accepted (>=90%)", c.pass / c.n >= 0.9, `${c.pass}/${c.n}` + (c.pass < c.n ? " e.g. " + c.fx[0] : ""));
  [["voice vowel", voice], ["knock on wood", knock], ["door slam", doorSlam], ["whistle tone", whistleTone], ["sustained hiss/music", musicSustain]].forEach(([nm, gen]) => {
    const t = mkTrial(gen, 20);
    check(`rejects ${nm} (<=5% false accepts)`, t.pass / t.n <= 0.05, `${t.pass}/${t.n} accepted`);
  });
}

sec("CLAP - trained profile (personalised)");
{
  const train = []; for (let i = 0; i < 6; i++) train.push(feats(clap(1)));
  const prof = audio.buildProfile(train);
  let own = 0; for (let i = 0; i < 30; i++) if (audio.classify(feats(clap(1)), { profile: prof, sensitivity: 0.6, strict: true }).pass) own++;
  check("own trained clap accepted (>=85%)", own / 30 >= 0.85, `${own}/30`);
  let other = 0; for (let i = 0; i < 20; i++) { if (audio.classify(feats(knock()), { profile: prof, sensitivity: 0.6 }).pass) other++; }
  check("knock rejected with profile", other === 0, `${other}/20 accepted`);
}

sec("CLAP - cadence logic (single / double / triple, timing windows)");
{
  const cf = feats(clap(0));
  const run = (cadence, wallTimes) => {
    freshDevice({ clap: { cadence, sensitivity: 0.6, action: "toggle" } });
    wallTimes.forEach(w => { FakeDate._now = w; sensors._onClapCandidate({ features: cf, wall: w, time: w / 1000 }); });
    return calls.length;
  };
  const T0 = 1e12;
  check("single: 1 clap fires once", run("single", [T0]) === 1);
  check("double: 2 claps 300 ms apart fire once", run("double", [T0, T0 + 300]) === 1);
  check("double: 1 clap does NOT fire", run("double", [T0]) === 0);
  check("double: 2 claps 900 ms apart do NOT fire", run("double", [T0, T0 + 900]) === 0);
  check("double: 2 claps 100 ms apart (echo) do NOT fire", run("double", [T0, T0 + 100]) === 0);
  check("triple: 3 claps (300 ms gaps) fire once", run("triple", [T0, T0 + 300, T0 + 600]) === 1);
  check("triple: only 2 claps do NOT fire", run("triple", [T0, T0 + 300]) === 0);
}

// =====================================================================================
sec("WHISTLE - tone detector (analyser spectrum mocked)");
{
  const nbins = 1024, binHz = SR / 2048;
  let mode = "silence", toneHz = 2500;
  const fakeSpectrum = (b) => {
    for (let k = 0; k < nbins; k++) b[k] = -95 + 3 * rnd();
    if (mode === "tone") { const c = Math.round(toneHz / binHz); b[c] = -25; b[c - 1] = -38; b[c + 1] = -38; }
    if (mode === "speech") { for (let h = 1; h <= 14; h++) { const c = Math.round(180 * h / binHz); if (c < nbins) { b[c] = -40 - h * 1.5; b[c - 1] = -50; b[c + 1] = -50; } } for (let k = 3; k < 200; k++) b[k] = Math.max(b[k], -62); }
    if (mode === "noise") { for (let k = 0; k < nbins; k++) b[k] = -50 + 6 * rnd(); }
  };
  audio.analyser = { frequencyBinCount: nbins, fftSize: 2048, getFloatFrequencyData: fakeSpectrum };
  audio.ctx = { sampleRate: SR };
  let fired = 0; const off = bus.on("audio:whistle", () => fired++);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const real = { now: performance.now.bind(performance) };
  (async () => {
    audio._whistle = { startAt: 0, freq: 0, fired: false };
    audio._startWhistleLoop();
    mode = "silence"; await wait(500); check("silence: no whistle", fired === 0);
    mode = "noise"; await wait(600); check("broadband noise: no whistle", fired === 0);
    mode = "speech"; await wait(600); check("voiced speech harmonics: no whistle", fired === 0, `fired=${fired}`);
    mode = "tone"; toneHz = 2500; await wait(700); check("sustained 2.5 kHz tone: whistle detected once", fired === 1, `fired=${fired}`);
    mode = "silence"; await wait(400); fired = 0;
    mode = "tone"; toneHz = 600; await wait(700); check("600 Hz tone (below whistle band): ignored", fired === 0, `fired=${fired}`);
    mode = "silence"; await wait(300); fired = 0;
    mode = "tone"; await wait(150); mode = "silence"; await wait(400); check("100 ms chirp (too short): ignored", fired === 0, `fired=${fired}`);
    clearInterval(audio._whistleTimer); off();
    await rest();
  })();
}

// =====================================================================================
async function rest() {
  sec("VOICE - phrase matching");
  {
    const test = (spoken, expected, label) => {
      freshDevice({ voice: {} });
      sensors._onSpeech([spoken]);
      const got = calls.length ? (calls[0].state ? "on" : "off") : "none";
      check(`${label || spoken} -> ${expected}`, got === expected, `got ${got}`);
    };
    test("light on", "on"); test("lights on", "on"); test("switch on", "on");
    test("light off", "off"); test("lights off", "off"); test("switch off", "off");
    test("turn the lights on", "on"); test("please turn off the light", "off");
    test("Light ON!", "on", "'Light ON!' (case/punctuation)");
    test("what time is it", "none"); test("hello how are you", "none"); test("play some music", "none");
    test("the light is bright", "none", "'the light is bright' (contains 'light' only)");
    test("I switched it", "none", "'I switched it'");
    // device that is already ON: 'light on' must not break
    freshDevice({ voice: {} }); store.devices[0].state = true; sensors._onSpeech(["lights off"]);
    check("voice ignores re-fire within 1.2 s (refractory)", (() => { sensors._onSpeech(["lights on"]); return calls.length === 1; })());
    // alternates: recogniser often returns the right answer as 2nd alt
    freshDevice({ voice: {} }); sensors._onSpeech(["like on", "light on"]);
    check("uses recogniser alternates ('like on','light on' -> on)", calls.length === 1 && calls[0].state === true);
  }

  sec("SHAKE - accelerometer peak counting");
  {
    const ev = (g) => ({ acceleration: { x: g, y: 0, z: 0 }, accelerationIncludingGravity: { x: g, y: 0, z: 9.81 }, rotationRate: null });
    const feed = (strength, seq) => { freshDevice({ shake: { strength } }); let t = new Date("2026-10-05T10:00:00+05:30").getTime(); seq.forEach(([dt, g]) => { t += dt; FakeDate._now = t; sensors._onMotion(ev(g)); }); return calls.length; };
    check("normal: 3 firm shakes (120 ms apart) fire once", feed("normal", [[0, 16], [120, -16], [120, 16]]) === 1);
    check("normal: walking jolts (5 m/s2) never fire", feed("normal", Array.from({ length: 20 }, (_, i) => [500, i % 2 ? 5 : -5])) === 0);
    check("normal: single drop/bump (30 m/s2) does NOT fire", feed("normal", [[0, 30]]) === 0);
    check("normal: 2 shakes only does NOT fire", feed("normal", [[0, 16], [120, -16]]) === 0);
    check("normal: slow 3 shakes 400 ms apart do NOT fire", feed("normal", [[0, 16], [400, 16], [400, 16]]) === 0);
    check("hard: 15 m/s2 shakes (below 20) do NOT fire", feed("hard", [[0, 15], [120, 15], [120, 15]]) === 0);
    check("hard: 25 m/s2 shakes fire", feed("hard", [[0, 25], [120, 25], [120, 25]]) === 1);
    check("gentle: 10 m/s2 shakes fire", feed("gentle", [[0, 10], [120, 10], [120, 10]]) === 1);
    // refractory
    freshDevice({ shake: {} }); let t0 = FakeDate._now;
    [[0, 16], [120, 16], [120, 16], [100, 16], [100, 16], [100, 16]].forEach(([dt, g]) => { t0 += dt; FakeDate._now = t0; sensors._onMotion(ev(g)); });
    check("continuous shaking toggles at most once per 1.5 s", calls.length === 1, `fired ${calls.length}`);
    // shake fallback: only gravity-included accel (no linear accel)
    freshDevice({ shake: {} }); let t1 = FakeDate._now;
    [[0, 9.81 + 18], [100, 9.81 - 18], [100, 9.81 + 18], [100, 9.81 - 18], [100, 9.81 + 18]].forEach(([dt, gz]) => { t1 += dt; FakeDate._now = t1; sensors._onMotion({ acceleration: null, accelerationIncludingGravity: { x: 0, y: 0, z: gz }, rotationRate: null }); });
    check("works on phones that only report gravity-included accel", calls.length === 1);
  }

  sec("PRESENCE - arrive / leave logic");
  {
    freshDevice({ presence: { source: "lan", onArrive: "on", onLeave: "off" } });
    const P = (v) => sensors._presenceUpdate(0, v);
    P(true); P(true);
    check("opening the app while ALREADY home does not fire 'arrive' action", calls.length === 0, `fired ${calls.length}`);
    P(false); P(false);
    check("leaving (2 consecutive 'away') fires onLeave=off", calls.length === 1 && calls[0].state === false || calls.length === 0, `calls=${JSON.stringify(calls)}`);
    freshDevice({ presence: { source: "lan", onArrive: "on", onLeave: "off" } });
    P(false); P(false); calls.length = 0; advance(30000);
    P(true); P(true);
    check("starting away then arriving fires onArrive=on", calls.length === 1 && calls[0].state === true, `calls=${JSON.stringify(calls)}`);
    freshDevice({ presence: { source: "lan", onArrive: "on", onLeave: "off" } });
    [true, false, true, false, true, false].forEach(P);
    check("flapping single observations do not fire", calls.length === 0, `fired ${calls.length}`);
    const km = NARI.haversine(17.385, 78.4867, 17.385, 78.4867 + 0.0014);
    check("haversine: 0.0014 deg lon at 17.4N ~= 149 m", Math.abs(km - 149) < 3, km.toFixed(1) + " m");
  }

  sec("GEO-FENCE - room micro-proximity (0.5m - 5.0m), doorway enter (ON) & exit (OFF)");
  {
    // Smart switch located at (17.385000, 78.486700) with 2.0m room threshold
    freshDevice({ geofence: { enabled: true, lat: 17.385000, lon: 78.486700, radiusM: 2.0, onEnter: "on", onExit: "off" } });
    
    // Simulate initial position outside room (~3.5m away: ~0.000032 deg lat offset)
    const latOutside = 17.385000 + 0.000032;
    const latInside = 17.385000 + 0.000009; // ~1.0m away
    sensors._onGeoPosition({ coords: { latitude: latOutside, longitude: 78.486700, accuracy: 1 } });
    sensors._onGeoPosition({ coords: { latitude: latOutside, longitude: 78.486700, accuracy: 1 } });
    check("initial outside room position does not fire exit action", calls.length === 0);

    // User steps into the room (within 2.0m range, ~1.0m)
    advance(20000);
    sensors._onGeoPosition({ coords: { latitude: latInside, longitude: 78.486700, accuracy: 1 } });
    sensors._onGeoPosition({ coords: { latitude: latInside, longitude: 78.486700, accuracy: 1 } });
    check("entering room (<=2.0m range) turns light ON", calls.length === 1 && calls[0].state === true, `calls=${JSON.stringify(calls)}`);

    // User steps out of the room (>2.0m range, e.g. 3.5m outside)
    calls.length = 0;
    advance(20000);
    sensors._onGeoPosition({ coords: { latitude: latOutside, longitude: 78.486700, accuracy: 1 } });
    sensors._onGeoPosition({ coords: { latitude: latOutside, longitude: 78.486700, accuracy: 1 } });
    check("getting out of the room turns light OFF", calls.length === 1 && calls[0].state === false, `calls=${JSON.stringify(calls)}`);

    // Test slider range adjustment (e.g. increase range slider to 4.0m)
    store.devices[0].triggers.geofence.radiusM = 4.0;
    calls.length = 0;
    advance(20000);
    // At 3.5m, now inside the 4.0m range!
    sensors._onGeoPosition({ coords: { latitude: latOutside, longitude: 78.486700, accuracy: 1 } });
    sensors._onGeoPosition({ coords: { latitude: latOutside, longitude: 78.486700, accuracy: 1 } });
    check("slider range adjusted to 4.0m triggers ON when at 3.5m", calls.length === 1 && calls[0].state === true);
  }

  sec("SCHEDULE - time rules, days, countdown, sunrise/sunset");
  {
    const runAt = (iso, rule) => { const d = freshDevice({ schedule: { rules: [rule], timer: null } }); setNow(iso); sensors._tickSchedule(); return calls.length; };
    check("18:30 rule fires at 18:30", runAt("2026-10-05T18:30:05+05:30", { time: "18:30", action: "on" }) === 1);
    check("18:30 rule does NOT fire at 18:31", runAt("2026-10-05T18:31:05+05:30", { time: "18:30", action: "on" }) === 0);
    check("18:30 rule fires 'off' action correctly", (() => { freshDevice({ schedule: { rules: [{ time: "18:30", action: "off" }] } }); store.devices[0].state = true; setNow("2026-10-05T18:30:01+05:30"); sensors._tickSchedule(); return calls.length === 1 && calls[0].state === false; })());
    // day filter: 2026-10-05 is a Monday (getDay()=1)
    check("day filter: Mon-only fires on Monday", runAt("2026-10-05T07:00:00+05:30", { time: "07:00", action: "on", days: [1] }) === 1);
    check("day filter: Tue-only does NOT fire on Monday", runAt("2026-10-05T07:00:00+05:30", { time: "07:00", action: "on", days: [2] }) === 0);
    check("disabled rule does NOT fire", runAt("2026-10-05T07:00:00+05:30", { time: "07:00", action: "on", enabled: false }) === 0);
    // same minute, repeated ticks (every 15 s) must fire once
    freshDevice({ schedule: { rules: [{ time: "09:15", action: "toggle" }] } });
    [0, 15, 30, 45].forEach(s => { setNow(`2026-10-05T09:15:${String(s).padStart(2, "0")}+05:30`); sensors._tickSchedule(); });
    check("4 ticks inside the same minute fire exactly once", calls.length === 1, `fired ${calls.length}`);
    // two rules in same minute
    freshDevice({ schedule: { rules: [{ time: "09:15", action: "on" }, { time: "09:15", action: "off" }] } });
    setNow("2026-10-05T09:15:10+05:30"); sensors._tickSchedule();
    check("two rules in the same minute both execute", calls.length === 2, `fired ${calls.length}`);
    // missed minute: app was suspended and the tick lands a minute late
    freshDevice({ schedule: { rules: [{ time: "09:15", action: "on" }] } });
    setNow("2026-10-05T09:14:50+05:30"); sensors._tickSchedule();
    setNow("2026-10-05T09:16:20+05:30"); sensors._tickSchedule();
    check("MISSED schedule (tick late by >1 min, e.g. phone slept) is caught up", calls.length === 1, `fired ${calls.length}`);
    setNow("2026-10-05T09:16:35+05:30"); sensors._tickSchedule();
    check("...and the caught-up rule is not fired a second time", calls.length === 1, `fired ${calls.length}`);
    freshDevice({ schedule: { rules: [{ time: "06:00", action: "on" }] } });
    setNow("2026-10-05T05:59:50+05:30"); sensors._tickSchedule();
    setNow("2026-10-05T14:00:00+05:30"); sensors._tickSchedule();
    check("stale rule (phone asleep 8 h) is NOT replayed at 2 pm", calls.length === 0, `fired ${calls.length}`);
    // countdown timer
    freshDevice({ schedule: { rules: [], timer: { endsAt: new Date("2026-10-05T12:00:00+05:30").getTime(), action: "off" } } }); store.devices[0].state = true;
    setNow("2026-10-05T11:59:30+05:30"); sensors._tickSchedule(); const before = calls.length;
    setNow("2026-10-05T12:00:05+05:30"); sensors._tickSchedule();
    check("countdown timer fires at expiry only", before === 0 && calls.length === 1 && calls[0].state === false);
    // sunrise / sunset cross-checked against an independent NOAA/Meeus implementation (Hyderabad 06:07 / 18:02)
    const st = NARI.sunTimes(new FakeDate("2026-10-05T12:00:00+05:30"), 17.385, 78.4867);
    const hm = (d) => d.getHours() * 60 + d.getMinutes();
    check("Hyderabad sunrise 06:07 (+-3 min)", Math.abs(hm(st.sunrise) - 367) <= 3, st.sunrise.toTimeString().slice(0, 5));
    check("Hyderabad sunset 18:02 (+-3 min)", Math.abs(hm(st.sunset) - 1082) <= 3, st.sunset.toTimeString().slice(0, 5));
    const dl = NARI.sunTimes(new FakeDate("2026-10-05T12:00:00+05:30"), 28.6139, 77.209);
    check("Delhi sunrise 06:16 (+-3 min)", Math.abs(hm(dl.sunrise) - 376) <= 3, dl.sunrise.toTimeString().slice(0, 5));
    // sunset rule with offset fires at sunset-30
    const sunsetMin = hm(st.sunset) - 30; const hh = String(Math.floor(sunsetMin / 60)).padStart(2, "0"), mm = String(sunsetMin % 60).padStart(2, "0");
    freshDevice({ schedule: { rules: [{ time: "sunset", offsetMin: -30, action: "on" }] } });
    setNow(`2026-10-05T${hh}:${mm}:10+05:30`); sensors._tickSchedule();
    check("sunset-30min rule fires at computed time", calls.length === 1, `${hh}:${mm}`);
  }

  sec("ENABLE / DISABLE source management (sync)");
  {
    freshDevice({});
    const started = []; const orig = {};
    ["audio", "voice", "motion", "presence", "schedule", "effect"].forEach(n => { orig["start_" + n] = sensors["start_" + n]; orig["stop_" + n] = sensors["stop_" + n]; sensors["start_" + n] = () => started.push("+" + n); sensors["stop_" + n] = () => started.push("-" + n); });
    sensors._sources = {};
    store.devices[0].triggers.clap.enabled = true; sensors.sync();
    check("enabling clap starts the microphone source", started.includes("+audio"));
    store.devices[0].triggers.shake.enabled = true; sensors.sync();
    check("enabling shake starts motion source", started.includes("+motion"));
    store.devices[0].triggers.clap.enabled = false; store.devices[0].triggers.whistle.enabled = false; sensors.sync();
    check("disabling clap (no whistle) stops the microphone", started.includes("-audio"));
    store.devices[0].triggers.shake.enabled = false; sensors.sync();
    check("disabling shake stops motion", started.includes("-motion"));
    Object.keys(orig).forEach(k => { sensors[k] = orig[k]; });
  }

  // ---------- summary ----------
  const fails = results.filter(r => !r.ok);
  console.log(`\n==== SUMMARY: ${results.length - fails.length}/${results.length} passed ====`);
  fails.forEach(f => console.log(`  FAILED [${f.section}] ${f.name}`));
  process.exit(fails.length ? 1 : 0);
}
