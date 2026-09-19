/* NARI Smart Switch - device model, persistence (localStorage + Firestore) and event bus. */
(function (global) {
  "use strict";
  const NARI = global.NARI;
 
  // ---------- tiny event bus ----------
  const listeners = {};
  const bus = {
    on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); return () => bus.off(evt, fn); },
    off(evt, fn) { listeners[evt] = (listeners[evt] || []).filter(f => f !== fn); },
    emit(evt, payload) { (listeners[evt] || []).slice().forEach(fn => { try { fn(payload); } catch (e) { console.error(`[bus:${evt}]`, e); } }); }
  };
 
  // ---------- device model ----------
  function defaultTriggers() {
    return {
      clap:     { enabled: false, cadence: "single", profile: null, sensitivity: 0.6, action: "toggle", strict: true },
      whistle:  { enabled: false, action: "toggle" },
      voice:    { enabled: false, on: "light on, lights on, switch on", off: "light off, lights off, switch off" },
      shake:    { enabled: false, action: "toggle", strength: "normal" },
      flick:    { enabled: false, action: "toggle" },
      flip:     { enabled: false, faceDown: "off", faceUp: "on" },
      tilt:     { enabled: false },
      compass:  { enabled: false, heading: null, tolerance: 25 },
      light:    { enabled: false, mode: "darkOn", threshold: 15 },
      battery:  { enabled: false, mode: "chargerGuard", low: 20, high: 80 },
      presence: { enabled: false, source: "lan", onArrive: "on", onLeave: "off" },
      nfc:      { enabled: false, serial: null, action: "toggle" },
      idle:     { enabled: false, minutes: 10, action: "off" },
      schedule: { enabled: false, rules: [], timer: null },
      effect:   { enabled: false, sub: "strobe", speed: 500, patternIdx: 0 }
    };
  }
 
  function newDevice(name, ip, id) {
    return {
      id: id || "",
      name: name || "Switch",
      ip: ip || "",
      state: false,
      bootState: "LAST",
      bgPhoto: null,
      isOnline: true,
      lanOk: false,
      lanRssi: null,
      rtt: null,
      lastLanOk: 0,
      lastCloudSeen: 0,
      cloudOnline: null,
      triggers: defaultTriggers()
    };
  }
 
  // Upgrade devices saved by the previous single-"mode" version of the app.
  function migrateDevice(raw) {
    const dev = Object.assign(newDevice(raw.name, raw.ip, raw.id), raw);
    const t = Object.assign(defaultTriggers(), raw.triggers || {});
    // deep-merge each trigger so newly added keys get defaults
    const defs = defaultTriggers();
    Object.keys(defs).forEach(k => { t[k] = Object.assign({}, defs[k], t[k] || {}); });
    dev.triggers = t;
 
    if (raw.mode && raw.mode !== "none" && !raw.triggers) {
      const map = { flicker: "effect", tilt: "tilt", "auto-proximity": "presence", "voice-custom": "voice", "trained-clap": "clap", shake: "shake", wrist: "flick" };
      const key = map[raw.mode];
      if (key) dev.triggers[key].enabled = true;
    }
    if (raw.voiceOn) dev.triggers.voice.on = raw.voiceOn;
    if (raw.voiceOff) dev.triggers.voice.off = raw.voiceOff;
    if (raw.clapCadence) dev.triggers.clap.cadence = raw.clapCadence;
    if (raw.strobeSpeed) dev.triggers.effect.speed = raw.strobeSpeed;
    if (raw.diySubMode && raw.diySubMode !== "diy-record") dev.triggers.effect.sub = raw.diySubMode;
    // Old 16-band clap profiles are not compatible with the new DSP feature set.
    if (Array.isArray(raw.clapProfile)) dev.triggers.clap.profile = null;
 
    ["mode", "voiceOn", "voiceOff", "clapCadence", "clapProfile", "strobeSpeed", "diySubMode", "proximityThreshold", "wifiRssi"].forEach(k => delete dev[k]);
    if (raw.wifiRssi !== undefined && raw.wifiRssi !== null) dev.lanRssi = raw.wifiRssi;
    dev._isVerifying = false;
    return dev;
  }
 
  function loadLocal(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
  }
 
  const store = {
    devices: loadLocal("nari_devices", []).map(migrateDevice),
    diyPatterns: loadLocal("nari_diy_patterns", []),
    roomMap: (function () {
      const t = loadLocal("nari_tilt_config", {});
      return {
        threshold: t.threshold || 16,
        actionType: t.actionType || "toggleOnOff",
        mappings: Object.assign({ N: null, NE: null, E: null, SE: null, S: null, SW: null, W: null, NW: null }, t.mappings || {})
      };
    })(),
    nfcTags: loadLocal("nari_nfc_tags", {}),
    currentUser: null,
    db: null,
    auth: null,
    _saveTimer: null,
 
    identifierOf(dev) { return dev.id || (dev.ip || "switch").replace(/[^a-zA-Z0-9_-]/g, "_"); },
 
    findIndex(identifier) {
      if (!identifier) return -1;
      return this.devices.findIndex(d => d.id === identifier || d.ip === identifier || (d.ip || "").replace(/\./g, "_") === identifier || this.identifierOf(d) === identifier);
    },
 
    exists(id, ip) { return this.devices.some(d => (id && d.id === id) || (ip && d.ip === ip)); },
 
    add(partial) {
      const dev = migrateDevice(Object.assign(newDevice(partial.name, partial.ip, partial.id), partial));
      this.devices.push(dev);
      this.save();
      bus.emit("devices:changed");
      return dev;
    },
 
    remove(index) {
      this.devices.splice(index, 1);
      this.save();
      bus.emit("devices:changed");
    },
 
    // Debounced persistence: localStorage immediately, Firestore after 800ms of quiet.
    save() {
      const clean = this.devices.map(d => { const c = Object.assign({}, d); delete c._isVerifying; return c; });
      localStorage.setItem("nari_devices", JSON.stringify(clean));
      localStorage.setItem("nari_diy_patterns", JSON.stringify(this.diyPatterns));
      localStorage.setItem("nari_tilt_config", JSON.stringify(this.roomMap));
      localStorage.setItem("nari_nfc_tags", JSON.stringify(this.nfcTags));
      NARI.saveSettings();
 
      if (this.currentUser && this.db) {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
          this.db.collection("users").doc(this.currentUser.uid).set({
            email: this.currentUser.email,
            updatedAt: Date.now(),
            devices: clean,
            roomMap: this.roomMap,
            diyPatterns: this.diyPatterns,
            nfcTags: this.nfcTags,
            settings: { theme: NARI.settings.theme, voiceLang: NARI.settings.voiceLang, homeLat: NARI.settings.homeLat, homeLon: NARI.settings.homeLon, homeRadiusM: NARI.settings.homeRadiusM }
          }, { merge: true }).catch(e => console.warn("Cloud save failed", e));
        }, 800);
      }
    },
 
    async loadCloud() {
      if (!this.currentUser || !this.db) return;
      try {
        const doc = await this.db.collection("users").doc(this.currentUser.uid).get();
        if (!doc.exists) { if (this.devices.length) this.save(); return; }
        const data = doc.data();
        if (Array.isArray(data.devices)) {
          const cloud = data.devices.map(migrateDevice);
          this.devices.forEach(local => {
            if (!cloud.some(cd => (cd.id && cd.id === local.id) || cd.ip === local.ip)) cloud.push(local);
          });
          this.devices = cloud;
        }
        if (data.roomMap) this.roomMap = Object.assign(this.roomMap, data.roomMap);
        if (Array.isArray(data.diyPatterns)) this.diyPatterns = data.diyPatterns;
        if (data.nfcTags) this.nfcTags = data.nfcTags;
        if (data.settings) {
          ["homeLat", "homeLon", "homeRadiusM"].forEach(k => { if (data.settings[k] !== undefined && data.settings[k] !== null) NARI.settings[k] = data.settings[k]; });
        }
        this.save();
        bus.emit("devices:changed");
      } catch (e) { console.error("Cloud fetch failed:", e); }
    }
  };
 
  // ---------- Firebase ----------
  try {
    if (typeof firebase !== "undefined") {
      if (!firebase.apps.length) firebase.initializeApp(NARI.FIREBASE_CONFIG);
      store.auth = firebase.auth();
      store.db = firebase.firestore();
    }
  } catch (err) { console.error("Firebase init error:", err); }
 
  NARI.bus = bus;
  NARI.store = store;
  NARI.newDevice = newDevice;
  NARI.defaultTriggers = defaultTriggers;
})(window);
