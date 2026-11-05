/* NARI Smart Switch - sensor / trigger hub.
 *
 * Every device may have several triggers enabled at once (dev.triggers.<type>.enabled). The hub starts a
 * hardware source only while at least one enabled trigger needs it, and stops it when the last one is
 * disabled. All triggers go through `fire()` which applies a per-trigger refractory period so that
 * a noisy sensor can never spam the relay.
 *
 * Sources: microphone (clap / whistle), SpeechRecognition (voice), devicemotion (shake / flick / flip / tilt),
 * deviceorientation (compass), AmbientLightSensor, Battery API, LAN reachability + Geolocation (presence),
 * Web NFC, IdleDetector (with visibility fallback), wall clock (schedule / timer / sunrise / sunset) and
 * an interval engine for effects (strobe / DIY patterns / vacation simulation).
 */
(function (global) {
  "use strict";
  const NARI = global.NARI;
  const { store, bus, transport, audio } = NARI;
 
  const REFRACTORY = { clap: 900, whistle: 1500, voice: 1200, shake: 1500, flick: 900, flip: 1200, compass: 2500, light: 60000, battery: 30000, geofence: 10000, presence: 20000, nfc: 1500, idle: 60000, schedule: 30000, tilt: 0, effect: 0 };
  const BUILTIN_VOICE_ON = "లైట్ వెయ్యి, లైట్ ఆన్, స్విచ్ ఆన్, ఫ్యాన్ వెయ్యి, light vey, light veyyi, switch vey, fan vey";
  const BUILTIN_VOICE_OFF = "లైట్ ఆపు, లైట్ ఆఫ్, స్విచ్ ఆఫ్, ఫ్యాన్ ఆపు, light aapu, switch aapu, fan aapu";
 
  const hub = {
    lastFire: {},                // `${id}:${type}` -> timestamp
    status: {},                  // source -> "active" | "unsupported" | "denied" | "idle" | "error"
    _timers: {},
    _sources: {},
 
    // ---------------------------------------------------------------------------------------------
    // Action dispatch
    // ---------------------------------------------------------------------------------------------
    async fire(index, type, action, detail) {
      const dev = store.devices[index];
      if (!dev) return false;
      const key = `${store.identifierOf(dev)}:${type}`;
      const now = Date.now();
      const ref = REFRACTORY[type] || 0;
      if (ref && now - (this.lastFire[key] || 0) < ref) return false;
      this.lastFire[key] = now;
 
      const cfg = (dev.triggers && dev.triggers[type]) || {};
      const targetRelay = dev.dual ? (cfg.targetRelay || "both") : "relay1";

      let target;
      if (action === "on") target = true;
      else if (action === "off") target = false;
      else if (targetRelay === "relay2") target = !dev.state2;
      else if (targetRelay === "both") target = !(dev.state || dev.state2);
      else target = !dev.state;

      if (action === "on" || action === "off") {
        const curMatch = targetRelay === "relay2"
          ? dev.state2 === target
          : targetRelay === "both"
            ? (dev.state === target && dev.state2 === target)
            : dev.state === target;
        if (curMatch && detail && detail.skipIfSame) return false;
      }

      let via = null;
      if (targetRelay === "both") {
        const v1 = await transport.setState(index, target, { source: type, relay: 1 });
        const v2 = await transport.setState(index, target, { source: type, relay: 2 });
        via = v1 || v2;
      } else if (targetRelay === "relay2") {
        via = await transport.setState(index, target, { source: type, relay: 2 });
      } else {
        via = await transport.setState(index, target, { source: type, relay: 1 });
      }
      bus.emit("trigger:fired", { index, type, action, target, targetRelay, via, detail: detail || {} });
      if (NARI.settings.hapticFeedback && navigator.vibrate) { try { navigator.vibrate(via ? 40 : [30, 60, 30]); } catch (e) {} }
      return !!via;
    },
 
    devicesWith(type) {
      const out = [];
      store.devices.forEach((d, i) => { if (d.triggers && d.triggers[type] && d.triggers[type].enabled) out.push(i); });
      return out;
    },
 
    /** Re-evaluate which sources need to run. Call after any trigger change. */
    sync() {
      const need = (types) => types.some(t => this.devicesWith(t).length > 0);
      this._toggleSource("audio", need(["clap", "whistle"]));
      this._toggleSource("voice", need(["voice"]));
      this._toggleSource("motion", need(["shake", "flick", "flip", "tilt"]));
      this._toggleSource("compass", need(["compass"]));
      this._toggleSource("light", need(["light"]));
      this._toggleSource("battery", need(["battery"]));
      this._toggleSource("geofence", need(["geofence", "presence"]));
      this._toggleSource("presence", need(["presence"]));
      this._toggleSource("nfc", need(["nfc"]));
      this._toggleSource("idle", need(["idle"]));
      this._toggleSource("schedule", need(["schedule"]));
      this._toggleSource("effect", need(["effect"]));
      if (this._sources.audio) {
        // engine sensitivity = most sensitive device
        let s = 0.3;
        this.devicesWith("clap").forEach(i => { s = Math.max(s, store.devices[i].triggers.clap.sensitivity || 0.6); });
        audio.setSensitivity(s);
      }
      this.effectSync();
      bus.emit("sensors:status", this.status);
    },
 
    _toggleSource(name, on) {
      const running = !!this._sources[name];
      if (on && !running) { this._sources[name] = true; this[`start_${name}`](); }
      else if (!on && running) { this._sources[name] = false; this[`stop_${name}`](); }
    },
 
    _setStatus(name, st, info) { this.status[name] = st; this.status[name + "Info"] = info || ""; bus.emit("sensors:status", this.status); },
 
    // ---------------------------------------------------------------------------------------------
    // Microphone: clap + whistle
    // ---------------------------------------------------------------------------------------------
    _clapTrack: {},   // device key -> {times:[]}
    async start_audio() {
      this._setStatus("audio", "starting");
      const ok = await audio.start("hub");
      if (!ok) { this._setStatus("audio", "denied"); return; }
      this._setStatus("audio", "active");
      this._offCand = bus.on("audio:candidate", (cand) => this._onClapCandidate(cand));
      this._offWhistle = bus.on("audio:whistle", (w) => {
        this.devicesWith("whistle").forEach(i => this.fire(i, "whistle", store.devices[i].triggers.whistle.action || "toggle", { freq: Math.round(w.freq) }));
      });
    },
    stop_audio() {
      this._offCand && this._offCand(); this._offWhistle && this._offWhistle();
      audio.stop("hub");
      this._setStatus("audio", "idle");
    },
 
    _onClapCandidate(cand) {
      const idxs = this.devicesWith("clap");
      if (!idxs.length) return;
      const results = [];
      idxs.forEach(i => {
        const dev = store.devices[i];
        const cfg = dev.triggers.clap;
        const res = audio.classify(cand.features, { profile: cfg.profile, sensitivity: cfg.sensitivity, strict: cfg.strict !== false });
        results.push({ index: i, res });
        if (!res.pass) return;
        const key = store.identifierOf(dev);
        const tr = this._clapTrack[key] || (this._clapTrack[key] = { times: [] });
        const now = cand.wall;
        tr.times = tr.times.filter(t => now - t < 1400);
        if (tr.times.length && now - tr.times[tr.times.length - 1] < 120) return; // echo of the same clap
        tr.times.push(now);
        const need = cfg.cadence === "double" ? 2 : cfg.cadence === "triple" ? 3 : 1;
        if (need === 1) { tr.times = []; this.fire(i, "clap", cfg.action || "toggle", { distance: res.distance }); return; }
        // multi-clap: all hits within 200..700 ms of each other
        if (tr.times.length >= need) {
          const seq = tr.times.slice(-need);
          let good = true;
          for (let k = 1; k < seq.length; k++) { const gap = seq[k] - seq[k - 1]; if (gap < 150 || gap > 750) good = false; }
          if (good) { tr.times = []; this.fire(i, "clap", cfg.action || "toggle", { cadence: need, distance: res.distance }); }
        }
        clearTimeout(tr.timer);
        tr.timer = setTimeout(() => { tr.times = []; }, 900);
      });
      bus.emit("clap:evaluated", { cand, results });
    },
 
    // ---------------------------------------------------------------------------------------------
    // Voice (Web Speech API)
    // ---------------------------------------------------------------------------------------------
    _rec: null, _recWanted: false, _recRestartTimer: null,
    start_voice() {
      const SR = global.SpeechRecognition || global.webkitSpeechRecognition;
      if (!SR) { this._setStatus("voice", "unsupported", "Speech recognition needs Chrome on Android / desktop."); return; }
      this._recWanted = true;
      const rec = new SR();
      rec.continuous = true; rec.interimResults = false; rec.maxAlternatives = 3;
      rec.lang = NARI.settings.voiceLang || "en-IN";
      rec.onstart = () => this._setStatus("voice", "active");
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (!e.results[i].isFinal) continue;
          const alts = Array.from(e.results[i]).map(a => a.transcript);
          this._onSpeech(alts);
        }
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") { this._setStatus("voice", "denied", "Microphone blocked for speech."); this._recWanted = false; }
        else if (e.error !== "no-speech" && e.error !== "aborted") this._setStatus("voice", "error", e.error);
      };
      rec.onend = () => {
        if (!this._recWanted) return;
        clearTimeout(this._recRestartTimer);
        this._recRestartTimer = setTimeout(() => { try { rec.start(); } catch (err) {} }, 350);
      };
      this._rec = rec;
      try { rec.start(); } catch (e) { this._setStatus("voice", "error", e.message); }
    },
    stop_voice() {
      this._recWanted = false;
      clearTimeout(this._recRestartTimer);
      if (this._rec) { try { this._rec.onend = null; this._rec.stop(); } catch (e) {} this._rec = null; }
      this._setStatus("voice", "idle");
    },
    _onSpeech(alts) {
      const heard = alts.map(normalizeText);
      bus.emit("voice:heard", { text: alts[0] });
      this.devicesWith("voice").forEach(i => {
        const cfg = store.devices[i].triggers.voice;
        const onPhrases = [cfg.on, BUILTIN_VOICE_ON].filter(Boolean).join(", ");
        const offPhrases = [cfg.off, BUILTIN_VOICE_OFF].filter(Boolean).join(", ");
        const onScore = bestPhraseMatch(heard, onPhrases);
        const offScore = bestPhraseMatch(heard, offPhrases);
        const toggleScore = bestPhraseMatch(heard, cfg.toggle || "");
        const best = Math.max(onScore, offScore, toggleScore);
        if (best < 0.78) return;
        const action = best === onScore ? "on" : best === offScore ? "off" : "toggle";
        this.fire(i, "voice", action, { text: alts[0], score: best });
      });
    },
 
    // ---------------------------------------------------------------------------------------------
    // Motion: shake / flick / flip / tilt
    // ---------------------------------------------------------------------------------------------
    _motion: { shakePeaks: [], lastFlick: 0, gyroSeen: false, face: null, faceSince: 0, calib: null, tiltActive: {}, lastTiltFire: {} },
    async start_motion() {
      if (!global.DeviceMotionEvent) { this._setStatus("motion", "unsupported"); return; }
      if (typeof DeviceMotionEvent.requestPermission === "function") {
        try { const r = await DeviceMotionEvent.requestPermission(); if (r !== "granted") { this._setStatus("motion", "denied", "Tap 'Allow motion' in Settings."); return; } } catch (e) { this._setStatus("motion", "denied", "iOS needs a tap: open Settings > Allow motion sensors."); return; }
      }
      this._motionHandler = (e) => this._onMotion(e);
      global.addEventListener("devicemotion", this._motionHandler, { passive: true });
      this._setStatus("motion", "active");
      this._motionSeen = false;
      setTimeout(() => { if (this._sources.motion && !this._motionSeen) this._setStatus("motion", "unsupported", "No motion events (laptop or sensor blocked)."); }, 3000);
    },
    stop_motion() {
      if (this._motionHandler) global.removeEventListener("devicemotion", this._motionHandler);
      this._motionHandler = null;
      this._setStatus("motion", "idle");
    },
    calibrateTilt() {
      const g = this._motion.lastGravity;
      this._motion.calib = g ? { x: g.x, y: g.y, z: g.z } : null;
      bus.emit("toast", { text: "Tilt zero point set - hold the phone flat and start tilting", level: "ok" });
    },
    _onMotion(e) {
      this._motionSeen = true;
      const m = this._motion;
      const now = Date.now();
      const acc = e.acceleration && e.acceleration.x !== null ? e.acceleration : null;
      const accG = e.accelerationIncludingGravity && e.accelerationIncludingGravity.x !== null ? e.accelerationIncludingGravity : null;
      const rot = e.rotationRate && e.rotationRate.alpha !== null ? e.rotationRate : null;
      if (accG) m.lastGravity = { x: accG.x, y: accG.y, z: accG.z };
 
      // ---- shake: >= 3 strong alternating peaks inside 700 ms ----
      let lin = 0;
      if (acc) lin = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
      else if (accG) lin = Math.abs(Math.sqrt(accG.x * accG.x + accG.y * accG.y + accG.z * accG.z) - 9.81);
      const shakeIdx = this.devicesWith("shake");
      if (shakeIdx.length) {
        const strength = store.devices[shakeIdx[0]].triggers.shake.strength || "normal";
        const th = strength === "gentle" ? 9 : strength === "hard" ? 20 : 13;
        if (lin > th && (!m.shakePeaks.length || now - m.shakePeaks[m.shakePeaks.length - 1] > 90)) {
          m.shakePeaks.push(now);
          m.shakePeaks = m.shakePeaks.filter(t => now - t < 700);
          if (m.shakePeaks.length >= 3) {
            m.shakePeaks = [];
            shakeIdx.forEach(i => this.fire(i, "shake", store.devices[i].triggers.shake.action || "toggle", { g: lin.toFixed(1) }));
          }
        }
      }
 
      // ---- wrist flick: fast rotation burst (gyro) or sharp single lateral jerk (fallback) ----
      const flickIdx = this.devicesWith("flick");
      if (flickIdx.length) {
        let flick = false;
        if (rot) {
          m.gyroSeen = true;
          const speed = Math.sqrt(rot.alpha * rot.alpha + rot.beta * rot.beta + rot.gamma * rot.gamma);
          flick = speed > 320 && lin < 25;   // rotating, not shaking
        } else if (acc) {
          flick = Math.abs(acc.x) > 14 && Math.abs(acc.z) < 8;
        }
        if (flick && now - m.lastFlick > 900) {
          m.lastFlick = now;
          flickIdx.forEach(i => this.fire(i, "flick", store.devices[i].triggers.flick.action || "toggle"));
        }
      }
 
      // ---- flip: face-up / face-down with dwell ----
      const flipIdx = this.devicesWith("flip");
      if (flipIdx.length && accG) {
        const face = accG.z > 6 ? "up" : accG.z < -6 ? "down" : null;
        if (face && face !== m.face) {
          if (!m.pendingFace || m.pendingFace !== face) { m.pendingFace = face; m.faceSince = now; }
          else if (now - m.faceSince > 350) {
            const prev = m.face; m.face = face; m.pendingFace = null;
            if (prev !== null) {
              flipIdx.forEach(i => {
                const cfg = store.devices[i].triggers.flip;
                const action = face === "down" ? cfg.faceDown : cfg.faceUp;
                if (action && action !== "none") this.fire(i, "flip", action, { face, skipIfSame: true });
              });
            }
          }
        } else if (!face) { m.pendingFace = null; }
      }
 
      // ---- tilt room map ----
      if (this.devicesWith("tilt").length && accG) this._onTilt(accG, now);
    },
 
    _onTilt(g, now) {
      const m = this._motion;
      const rm = store.roomMap;
      if (!m.calib) { m.calib = { x: g.x, y: g.y, z: g.z }; }
      // relative tilt angles (deg) vs calibration
      const toDeg = (v) => Math.atan2(v, 9.81) * 180 / Math.PI;
      const dx = toDeg(g.x) - toDeg(m.calib.x);
      const dy = toDeg(g.y) - toDeg(m.calib.y);
      const mag = Math.sqrt(dx * dx + dy * dy);
      const th = rm.threshold || 16;
      let dir = null;
      if (mag > th) {
        const ang = (Math.atan2(-dx, dy) * 180 / Math.PI + 360) % 360;   // 0 = tilt forward (N)
        const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
        dir = dirs[Math.round(ang / 45) % 8];
      }
      const speedFactor = Math.min(3, Math.max(1, mag / th));
      const period = Math.round(900 / speedFactor);
      Object.keys(rm.mappings).forEach(d => {
        const target = rm.mappings[d];
        if (target === null || target === undefined || target === "") return;
        const idx = store.findIndex(target);
        if (idx === -1) return;
        const active = dir === d;
        const was = !!m.tiltActive[d];
        if (active && !was) {
          m.tiltActive[d] = true;
          this._tiltAct(idx, rm.actionType, true);
          m.lastTiltFire[d] = now;
        } else if (active && was && rm.actionType === "toggleOnOff" && now - (m.lastTiltFire[d] || 0) > period) {
          this._tiltAct(idx, rm.actionType, true);
          m.lastTiltFire[d] = now;
        } else if (!active && was) {
          m.tiltActive[d] = false;
          if (rm.actionType === "toggleOnOff") this._tiltAct(idx, rm.actionType, false);
        }
      });
      bus.emit("tilt:update", { dir, mag: Math.round(mag), dx: Math.round(dx), dy: Math.round(dy) });
    },
    _tiltAct(idx, actionType, entering) {
      if (actionType === "toggleOnOff") transport.setState(idx, entering ? !store.devices[idx].state : false, { source: "tilt" });
      else if (actionType === "toggleOn" && entering) transport.setState(idx, true, { source: "tilt" });
      else if (actionType === "toggleOff" && entering) transport.setState(idx, false, { source: "tilt" });
    },
 
    // ---------------------------------------------------------------------------------------------
    // Compass heading (point the phone at the appliance)
    // ---------------------------------------------------------------------------------------------
    _compass: { inside: {}, since: {} },
    async start_compass() {
      if (!global.DeviceOrientationEvent) { this._setStatus("compass", "unsupported"); return; }
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        try { const r = await DeviceOrientationEvent.requestPermission(); if (r !== "granted") { this._setStatus("compass", "denied"); return; } } catch (e) { this._setStatus("compass", "denied", "iOS needs a tap: Settings > Allow motion sensors."); return; }
      }
      this._orientHandler = (e) => {
        let heading = null;
        if (typeof e.webkitCompassHeading === "number") heading = e.webkitCompassHeading;
        else if (e.absolute && typeof e.alpha === "number") heading = (360 - e.alpha) % 360;
        else if (typeof e.alpha === "number") heading = (360 - e.alpha) % 360;
        if (heading === null) return;
        this.heading = heading;
        bus.emit("compass:update", heading);
        const now = Date.now();
        this.devicesWith("compass").forEach(i => {
          const cfg = store.devices[i].triggers.compass;
          if (cfg.heading === null || cfg.heading === undefined) return;
          let diff = Math.abs(heading - cfg.heading); if (diff > 180) diff = 360 - diff;
          const key = store.identifierOf(store.devices[i]);
          const tol = cfg.tolerance || 25;
          const inside = diff < tol;
          if (inside && !this._compass.inside[key]) {
            if (!this._compass.since[key]) this._compass.since[key] = now;
            else if (now - this._compass.since[key] > 700) { this._compass.inside[key] = true; this.fire(i, "compass", cfg.action || "toggle", { heading: Math.round(heading) }); }
          } else if (!inside && diff > tol + 15) { this._compass.inside[key] = false; this._compass.since[key] = 0; }
        });
      };
      const evName = "ondeviceorientationabsolute" in global ? "deviceorientationabsolute" : "deviceorientation";
      global.addEventListener(evName, this._orientHandler, { passive: true });
      this._orientEv = evName;
      this._setStatus("compass", "active");
    },
    stop_compass() {
      if (this._orientHandler) global.removeEventListener(this._orientEv, this._orientHandler);
      this._orientHandler = null; this._setStatus("compass", "idle");
    },
 
    // ---------------------------------------------------------------------------------------------
    // Ambient light (Generic Sensor API - Chrome needs chrome://flags/#enable-generic-sensor-extra-classes)
    // ---------------------------------------------------------------------------------------------
    _light: { dark: {}, sensor: null },
    start_light() {
      if (!("AmbientLightSensor" in global)) {
        this._setStatus("light", "unsupported", "Ambient light needs Chrome with 'Generic Sensor Extra Classes' enabled (chrome://flags). Use Schedule > sunset instead.");
        return;
      }
      try {
        const s = new global.AmbientLightSensor({ frequency: 1 });
        s.onreading = () => {
          const lux = s.illuminance;
          bus.emit("light:update", lux);
          this.devicesWith("light").forEach(i => {
            const cfg = store.devices[i].triggers.light;
            const key = store.identifierOf(store.devices[i]);
            const th = cfg.threshold || 15;
            const dark = lux < th, bright = lux > th * 2.5;   // hysteresis
            if (dark && this._light.dark[key] !== true) { this._light.dark[key] = true; if (cfg.mode === "darkOn") this.fire(i, "light", "on", { lux, skipIfSame: true }); else if (cfg.mode === "darkOff") this.fire(i, "light", "off", { lux, skipIfSame: true }); }
            else if (bright && this._light.dark[key] !== false) { this._light.dark[key] = false; if (cfg.mode === "darkOn") this.fire(i, "light", "off", { lux, skipIfSame: true }); else if (cfg.mode === "darkOff") this.fire(i, "light", "on", { lux, skipIfSame: true }); }
          });
        };
        s.onerror = (e) => this._setStatus("light", "denied", e.error && e.error.message);
        s.start();
        this._light.sensor = s;
        this._setStatus("light", "active");
      } catch (e) { this._setStatus("light", "error", e.message); }
    },
    stop_light() { try { this._light.sensor && this._light.sensor.stop(); } catch (e) {} this._light.sensor = null; this._setStatus("light", "idle"); },
 
    // ---------------------------------------------------------------------------------------------
    // Battery (smart-charger cut-off / charger guard / low battery)
    // ---------------------------------------------------------------------------------------------
    _battery: null,
    async start_battery() {
      if (!navigator.getBattery) { this._setStatus("battery", "unsupported"); return; }
      try {
        const b = await navigator.getBattery();
        this._battery = b;
        const evalB = () => {
          const level = Math.round(b.level * 100);
          bus.emit("battery:update", { level, charging: b.charging });
          this.devicesWith("battery").forEach(i => {
            const cfg = store.devices[i].triggers.battery;
            if (cfg.mode === "chargerGuard") {
              // plug-in -> ON, unplug -> OFF (relay powers the charger; phone signals when it is on the cable)
              this.fire(i, "battery", b.charging ? "on" : "off", { level, skipIfSame: true });
            } else if (cfg.mode === "smartCharge") {
              // relay feeds the charger: ON below `low`, OFF once `high` is reached (protects battery health)
              if (level <= (cfg.low || 20)) this.fire(i, "battery", "on", { level, skipIfSame: true });
              else if (level >= (cfg.high || 80) && b.charging) this.fire(i, "battery", "off", { level, skipIfSame: true });
            } else if (cfg.mode === "lowOff") {
              if (level <= (cfg.low || 20) && !b.charging) this.fire(i, "battery", "off", { level, skipIfSame: true });
            }
          });
        };
        b.addEventListener("levelchange", evalB); b.addEventListener("chargingchange", evalB);
        this._batteryEval = evalB;
        evalB();
        this._setStatus("battery", "active");
      } catch (e) { this._setStatus("battery", "error", e.message); }
    },
    stop_battery() {
      if (this._battery && this._batteryEval) { this._battery.removeEventListener("levelchange", this._batteryEval); this._battery.removeEventListener("chargingchange", this._batteryEval); }
      this._battery = null; this._setStatus("battery", "idle");
    },
 
    // ---------------------------------------------------------------------------------------------
    // Geo-Fence Mode: Distance calculation between smart device & phone; triggers ON near, OFF away
    // ---------------------------------------------------------------------------------------------
    _geofence: { inside: {}, streak: {}, watchId: null, lastPos: null, distances: {} },
    get _presence() {
      return { home: this._geofence.inside, streak: this._geofence.streak, watchId: this._geofence.watchId, lastPos: this._geofence.lastPos };
    },
    start_geofence() {
      if (!navigator.geolocation) {
        this._setStatus("geofence", "unsupported", "No geolocation API available");
        return;
      }
      this._setStatus("geofence", "active");
      if (this._geofence.watchId === null) {
        this._geofence.watchId = navigator.geolocation.watchPosition(
          (pos) => this._onGeoPosition(pos),
          (err) => this._setStatus("geofence", "denied", err.message || "Location denied"),
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
        );
      }
    },
    stop_geofence() {
      if (this._geofence.watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(this._geofence.watchId);
      }
      this._geofence.watchId = null;
      this._setStatus("geofence", "idle");
    },
    start_presence() {
      this.start_geofence();
    },
    stop_presence() {
      this.stop_geofence();
    },
    _onGeoPosition(pos) {
      const pLat = pos.coords.latitude;
      const pLon = pos.coords.longitude;
      const acc = pos.coords.accuracy || 0;
      this._geofence.lastPos = { lat: pLat, lon: pLon, acc };

      const activeDevs = Array.from(new Set(this.devicesWith("geofence").concat(this.devicesWith("presence"))));
      activeDevs.forEach(i => {
        const dev = store.devices[i];
        if (!dev) return;
        const cfg = dev.triggers.geofence || dev.triggers.presence || {};
        const targetLat = (cfg.lat !== null && cfg.lat !== undefined) ? cfg.lat : (dev.lat !== null && dev.lat !== undefined ? dev.lat : NARI.settings.homeLat);
        const targetLon = (cfg.lon !== null && cfg.lon !== undefined) ? cfg.lon : (dev.lon !== null && dev.lon !== undefined ? dev.lon : NARI.settings.homeLon);

        if (targetLat === null || targetLon === null || targetLat === undefined || targetLon === undefined) {
          return;
        }

        const dist = haversine(pLat, pLon, targetLat, targetLon);
        const key = store.identifierOf(dev);
        this._geofence.distances[key] = dist;

        const radius = typeof cfg.radiusM === "number" ? cfg.radiusM : (parseFloat(cfg.radiusM) || 2.5);
        // Room-level micro-proximity hysteresis (0.2m - 0.5m) to avoid edge flickering
        const hysteresis = Math.min(0.5, Math.max(0.2, radius * 0.1));

        const cur = this._geofence.inside[key];
        if (dist <= radius) {
          this._geofenceUpdate(i, true, dist, radius);
        } else if (dist > radius + hysteresis) {
          this._geofenceUpdate(i, false, dist, radius);
        } else if (cur !== undefined) {
          this._geofenceUpdate(i, cur, dist, radius);
        }

        bus.emit("geofence:distance", { index: i, id: dev.id, distance: dist, radius, isInside: this._geofence.inside[key] });
      });

      bus.emit("geo:update", this._geofence.lastPos);
    },
    _geofenceUpdate(i, isInside, dist, radius) {
      const dev = store.devices[i];
      if (!dev) return;
      const cfg = dev.triggers.geofence || dev.triggers.presence || {};
      const key = store.identifierOf(dev);
      const g = this._geofence;

      g.streak[key] = (g.streak[key] && g.streak[key].val === isInside) ? { val: isInside, n: g.streak[key].n + 1 } : { val: isInside, n: 1 };
      if (g.streak[key].n < 2) return;
      if (g.inside[key] === isInside) return;

      const first = g.inside[key] === undefined;
      g.inside[key] = isInside;

      if (first) return;

      const action = isInside ? (cfg.onEnter || cfg.onArrive || "on") : (cfg.onExit || cfg.onLeave || "off");
      if (action && action !== "none") {
        this.fire(i, "geofence", action, { isInside, isHome: isInside, dist, radius, skipIfSame: true });
      }
    },
    _presenceUpdate(i, isHome) {
      return this._geofenceUpdate(i, isHome, 0, 50);
    },
 
    // ---------------------------------------------------------------------------------------------
    // NFC (Web NFC, Android Chrome)
    // ---------------------------------------------------------------------------------------------
    _nfc: null,
    async start_nfc() {
      if (!("NDEFReader" in global)) { this._setStatus("nfc", "unsupported", "Web NFC needs Chrome on Android."); return; }
      try {
        const reader = new global.NDEFReader();
        this._nfcAbort = new AbortController();
        await reader.scan({ signal: this._nfcAbort.signal });
        reader.onreading = (ev) => {
          const serial = ev.serialNumber || "";
          let text = "";
          try { for (const rec of ev.message.records) if (rec.recordType === "text") text = new TextDecoder(rec.encoding || "utf-8").decode(rec.data); } catch (e) {}
          bus.emit("nfc:read", { serial, text });
          if (this._nfcLearn) { this._nfcLearn(serial); return; }
          this.devicesWith("nfc").forEach(i => {
            const cfg = store.devices[i].triggers.nfc;
            if (cfg.serial && cfg.serial !== serial) return;
            this.fire(i, "nfc", cfg.action || "toggle", { serial });
          });
        };
        this._nfc = reader;
        this._setStatus("nfc", "active");
      } catch (e) { this._setStatus("nfc", "denied", e.message); }
    },
    stop_nfc() { try { this._nfcAbort && this._nfcAbort.abort(); } catch (e) {} this._nfc = null; this._nfcLearn = null; this._setStatus("nfc", "idle"); },
    /** Next tag read is stored on the device instead of firing. */
    learnNfc(index) {
      return new Promise((resolve) => {
        this._nfcLearn = (serial) => { this._nfcLearn = null; store.devices[index].triggers.nfc.serial = serial; store.save(); resolve(serial); };
        if (!this._sources.nfc) { this._sources.nfc = true; this.start_nfc(); }
      });
    },
 
    // ---------------------------------------------------------------------------------------------
    // Idle (IdleDetector w/ permission, fallback to "app hidden for N minutes")
    // ---------------------------------------------------------------------------------------------
    _idle: { detector: null, hiddenSince: 0, timer: null, fired: {} },
    async start_idle() {
      const minutes = Math.max(1, ...this.devicesWith("idle").map(i => store.devices[i].triggers.idle.minutes || 10));
      const onIdle = () => this.devicesWith("idle").forEach(i => this.fire(i, "idle", store.devices[i].triggers.idle.action || "off", { skipIfSame: true }));
      if ("IdleDetector" in global) {
        try {
          const perm = await global.IdleDetector.requestPermission();
          if (perm === "granted") {
            const det = new global.IdleDetector();
            this._idleAbort = new AbortController();
            det.addEventListener("change", () => {
              if (det.userState === "idle" || det.screenState === "locked") onIdle();
            });
            await det.start({ threshold: Math.max(60000, minutes * 60000), signal: this._idleAbort.signal });
            this._idle.detector = det;
            this._setStatus("idle", "active");
            return;
          }
        } catch (e) { console.warn("IdleDetector failed", e); }
      }
      // fallback: page hidden continuously for N minutes
      this._idle.visHandler = () => { this._idle.hiddenSince = document.hidden ? Date.now() : 0; };
      document.addEventListener("visibilitychange", this._idle.visHandler);
      this._idle.timer = setInterval(() => { if (this._idle.hiddenSince && Date.now() - this._idle.hiddenSince > minutes * 60000) { this._idle.hiddenSince = Date.now(); onIdle(); } }, 30000);
      this._setStatus("idle", "active", "Using screen-hidden fallback");
    },
    stop_idle() {
      try { this._idleAbort && this._idleAbort.abort(); } catch (e) {}
      clearInterval(this._idle.timer);
      if (this._idle.visHandler) document.removeEventListener("visibilitychange", this._idle.visHandler);
      this._idle.detector = null; this._setStatus("idle", "idle");
    },
 
    // ---------------------------------------------------------------------------------------------
    // Schedule / countdown timer / sunrise-sunset
    // ---------------------------------------------------------------------------------------------
    _sched: { lastMinute: {}, done: {}, lastTick: 0, timer: null },
    start_schedule() {
      this._sched.timer = setInterval(() => this._tickSchedule(), 15000);
      this._tickSchedule();
      this._setStatus("schedule", "active");
    },
    stop_schedule() { clearInterval(this._sched.timer); this._setStatus("schedule", "idle"); },
    _tickSchedule() {
      const nowMs = Date.now();
      const S = this._sched;
      // Browsers throttle or freeze timers in background tabs, so a tick can arrive minutes late. Evaluate every
      // minute since the previous tick (up to a 15 min grace window) so a rule is never silently skipped, but a
      // rule that is hours old is never replayed (e.g. don't switch the geyser on at 2 pm for a 6 am rule).
      const GRACE = 15 * 60000;
      const from = S.lastTick && nowMs - S.lastTick <= GRACE ? S.lastTick : nowMs;
      S.lastTick = nowMs;
      const mk = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
      // prune the dedupe set
      Object.keys(S.done).forEach(k => { if (nowMs - S.done[k] > 2 * GRACE) delete S.done[k]; });

      this.devicesWith("schedule").forEach(i => {
        const dev = store.devices[i];
        const cfg = dev.triggers.schedule;
        // countdown timer
        if (cfg.timer && cfg.timer.endsAt && nowMs >= cfg.timer.endsAt) {
          const act = cfg.timer.action;
          cfg.timer = null;
          if (!cfg.rules || !cfg.rules.length) cfg.enabled = false;
          store.save();
          const rn = cfg.targetRelay === "relay2" ? 2 : 1;
          if (!(act === "off" && transport && typeof transport.isPending === "function" && transport.isPending(dev, rn))) {
            this.fire(i, "schedule", act, { timer: true });
          }
          bus.emit("device:updated", i);
        }
        const dk = store.identifierOf(dev);
        for (let t = Math.floor(from / 60000) * 60000; t <= nowMs; t += 60000) {
          const when = new Date(t);
          const minuteKey = mk(when);
          (cfg.rules || []).forEach((rule, ri) => {
            if (!rule.enabled && rule.enabled !== undefined) return;
            if (Array.isArray(rule.days) && rule.days.length && !rule.days.includes(when.getDay())) return;
            const hm = resolveRuleTime(rule, when);
            if (!hm || hm.h !== when.getHours() || hm.m !== when.getMinutes()) return;
            const key = `${dk}|${ri}|${rule.time}|${minuteKey}`;
            if (S.done[key]) return;
            S.done[key] = nowMs;
            this.lastFire[`${dk}:schedule`] = 0;   // rules are exact-minute, never block each other
            this.fire(i, "schedule", rule.action || "toggle", { rule: rule.time });
          });
        }
      });
    },
 
    // ---------------------------------------------------------------------------------------------
    // Effects: strobe / DIY pattern / vacation (presence simulation)
    // ---------------------------------------------------------------------------------------------
    _effects: {},   // key -> { timer, kind }
    start_effect() { this.effectSync(); this._setStatus("effect", "active"); },
    stop_effect() { Object.keys(this._effects).forEach(k => this._stopEffect(k)); this._setStatus("effect", "idle"); },
    effectSync() {
      const active = new Set();
      this.devicesWith("effect").forEach(i => {
        const dev = store.devices[i];
        const key = store.identifierOf(dev);
        active.add(key);
        const cfg = dev.triggers.effect;
        const sig = `${cfg.sub}|${cfg.speed}|${cfg.patternIdx}|${cfg.vacFrom}|${cfg.vacTo}`;
        if (this._effects[key] && this._effects[key].sig === sig) return;
        this._stopEffect(key);
        this._startEffect(i, key, cfg, sig);
      });
      Object.keys(this._effects).forEach(k => { if (!active.has(k)) this._stopEffect(k); });
    },
    _startEffect(i, key, cfg, sig) {
      const send = (st) => { const idx = store.findIndex(key); if (idx !== -1) transport.setState(idx, st, { quiet: true, source: "effect" }); };
      const eff = { sig, timer: null, stopped: false };
      this._effects[key] = eff;
      if (cfg.sub === "strobe") {
        let st = false;
        const period = Math.max(150, Number(cfg.speed) || 500);
        eff.timer = setInterval(() => { st = !st; send(st); }, period);
      } else if (cfg.sub === "diy") {
        const steps = patternSteps(store.diyPatterns[cfg.patternIdx || 0]);
        if (!steps.length) { bus.emit("toast", { text: "Record a DIY pattern first", level: "warn" }); return; }
        let step = 0;
        const run = () => {
          if (eff.stopped) return;
          const s = steps[step];
          send(!!s.on);
          step = (step + 1) % steps.length;
          eff.timer = setTimeout(run, Math.max(120, s.ms || 300));
        };
        run();
      } else if (cfg.sub === "vacation") {
        // random ON/OFF between vacFrom..vacTo hours, every 8-40 minutes
        const tick = () => {
          if (eff.stopped) return;
          const h = new Date().getHours();
          const from = cfg.vacFrom === undefined ? 18 : Number(cfg.vacFrom), to = cfg.vacTo === undefined ? 23 : Number(cfg.vacTo);
          const inWindow = from <= to ? (h >= from && h < to) : (h >= from || h < to);
          const idx = store.findIndex(key);
          if (idx !== -1) {
            if (inWindow) send(Math.random() < 0.6);
            else if (store.devices[idx].state) send(false);
          }
          eff.timer = setTimeout(tick, (8 + Math.random() * 32) * 60000);
        };
        tick();
      }
    },
    _stopEffect(key) {
      const eff = this._effects[key];
      if (!eff) return;
      eff.stopped = true; clearInterval(eff.timer); clearTimeout(eff.timer);
      delete this._effects[key];
    },
 
    // ---------------------------------------------------------------------------------------------
    // DIY pattern recorder
    // ---------------------------------------------------------------------------------------------
    diyRecorder() {
      const steps = []; let last = 0, cur = null, endTimer = null, startAt = 0;
      const api = {
        start() { startAt = last = Date.now(); steps.length = 0; cur = null; },
        press(on) {
          const now = Date.now();
          if (cur !== null) steps.push({ on: cur, ms: now - last });
          cur = on; last = now;
          clearTimeout(endTimer);
          endTimer = setTimeout(() => api.finish(), 4000);      // idle 4 s => auto save
          if (now - startAt > 20000) api.finish();               // 20 s max
        },
        finish() {
          clearTimeout(endTimer);
          if (cur !== null) { steps.push({ on: cur, ms: Math.min(2000, Date.now() - last) }); cur = null; }
          if (steps.length >= 2) { bus.emit("diy:recorded", { steps: steps.slice() }); }
          steps.length = 0;
        },
        get steps() { return steps; }
      };
      return api;
    }
  };
 
  // ---------------------------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------------------------
  function normalizeText(t) { return String(t || "").toLowerCase().replace(/[^a-z0-9\u0900-\u0DFF ]+/g, " ").replace(/\s+/g, " ").trim(); }
 
  function similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.92;
    // token-set + Levenshtein blend
    const ta = a.split(" "), tb = b.split(" ");
    // natural phrasing: every word of the configured phrase is present in what was heard, in any order
    // ("please turn off the light" contains light + off). Needs >= 2 words so a single common word can't trigger.
    if (tb.length >= 2 && tb.every(t => ta.includes(t))) return 0.9;
    const common = ta.filter(x => tb.includes(x)).length;
    const tokenScore = (2 * common) / (ta.length + tb.length);
    const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
    return Math.max(tokenScore, lev);
  }
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = new Array(n + 1).fill(0).map((_, i) => i), cur = new Array(n + 1);
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }
  function bestPhraseMatch(heardList, phrases) {
    const list = String(phrases || "").split(/[,\n]/).map(normalizeText).filter(Boolean);
    let best = 0;
    heardList.forEach(h => list.forEach(p => { best = Math.max(best, similarity(h, p)); }));
    return best;
  }
 
  /** Accepts new {steps:[{on,ms}]} and legacy {events:[{state,duration}]} patterns. */
  function patternSteps(pat) {
    if (!pat) return [];
    if (Array.isArray(pat.steps)) return pat.steps;
    if (Array.isArray(pat.events)) return pat.events.map(e => ({ on: e.state === 1, ms: e.duration }));
    return [];
  }
 
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
 
  /** Sunrise / sunset (NOAA approximation). Returns {sunrise: Date, sunset: Date} local, or null. */
  function sunTimes(date, lat, lon) {
    if (lat === null || lon === null || lat === undefined || lon === undefined) return null;
    const rad = Math.PI / 180;
    const start = new Date(date.getFullYear(), 0, 0);
    const doy = Math.floor((date - start) / 86400000);
    const lngHour = lon / 15;
    const calc = (rising) => {
      const t = doy + ((rising ? 6 : 18) - lngHour) / 24;
      const M = 0.9856 * t - 3.289;
      let L = M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634;
      L = (L + 360) % 360;
      let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
      RA = (RA + 360) % 360;
      RA += (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90);
      RA /= 15;
      const sinDec = 0.39782 * Math.sin(L * rad), cosDec = Math.cos(Math.asin(sinDec));
      const cosH = (Math.cos(90.833 * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
      if (cosH > 1 || cosH < -1) return null;
      let H = rising ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad;
      H /= 15;
      const T = H + RA - 0.06571 * t - 6.622;
      let UT = (T - lngHour) % 24; if (UT < 0) UT += 24;
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0));
      d.setUTCMinutes(Math.round(UT * 60));
      return d;
    };
    return { sunrise: calc(true), sunset: calc(false) };
  }
 
  function resolveRuleTime(rule, now) {
    if (rule.time === "sunrise" || rule.time === "sunset") {
      const st = sunTimes(now, NARI.settings.homeLat, NARI.settings.homeLon);
      if (!st || !st[rule.time]) return null;
      const d = new Date(st[rule.time].getTime() + (Number(rule.offsetMin) || 0) * 60000);
      return { h: d.getHours(), m: d.getMinutes() };
    }
    const m = /^(\d{1,2}):(\d{2})$/.exec(rule.time || "");
    if (!m) return null;
    return { h: Number(m[1]), m: Number(m[2]) };
  }
 
  NARI.sensors = hub;
  NARI.sunTimes = sunTimes;
  NARI.haversine = haversine;
  NARI.textSimilarity = similarity;
})(window);

