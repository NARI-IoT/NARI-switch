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
      clap:     { enabled: false, cadence: "single", profile: null, sensitivity: 0.6, action: "toggle", strict: true, targetRelay: "both" },
      whistle:  { enabled: false, action: "toggle", targetRelay: "both" },
      voice:    { enabled: false, on: "light on, lights on, switch on", off: "light off, lights off, switch off", toggle: "", targetRelay: "both" },
      shake:    { enabled: false, action: "toggle", strength: "normal", targetRelay: "both" },
      flick:    { enabled: false, action: "toggle", targetRelay: "both" },
      flip:     { enabled: false, faceDown: "off", faceUp: "on", targetRelay: "both" },
      tilt:     { enabled: false, targetRelay: "both" },
      compass:  { enabled: false, heading: null, tolerance: 25, targetRelay: "both" },
      light:    { enabled: false, mode: "darkOn", threshold: 15, targetRelay: "both" },
      battery:  { enabled: false, mode: "chargerGuard", low: 20, high: 80, targetRelay: "both" },
      geofence: { enabled: false, radiusM: 2.5, lat: null, lon: null, onEnter: "on", onExit: "off", targetRelay: "both" },
      presence: { enabled: false, source: "lan", onArrive: "on", onLeave: "off", targetRelay: "both" },
      nfc:      { enabled: false, serial: null, action: "toggle", targetRelay: "both" },
      idle:     { enabled: false, minutes: 10, action: "off", targetRelay: "both" },
      schedule: { enabled: false, rules: [], timer: null, targetRelay: "both" },
      effect:   { enabled: false, sub: "strobe", speed: 500, patternIdx: 0 }
    };
  }
 
  function generateGuid() {
    try {
      const arr = new Uint8Array(8);
      crypto.getRandomValues(arr);
      return "sw_" + Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      return "sw_" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    }
  }

  function newDevice(name, ip, id) {
    return {
      id: id || generateGuid(),
      name: name || "Smart Node",
      room: "Living Room",
      ip: ip || "",
      state: false,
      state2: false,
      relay1Name: "Ceiling Light",
      relay2Name: "Ceiling Fan",
      relay1Icon: "bulb",
      relay2Icon: "fan",
      dual: true,
      bootState: "LAST",
      bootState2: "LAST",
      autoOffSec: 0,
      autoOffSec2: 0,
      wallSwitchLock: false,
      relay1Watts: 12,
      relay2Watts: 75,
      runtimeMs1: 0,
      runtimeMs2: 0,
      lastOnAt1: 0,
      lastOnAt2: 0,
      energyDayKey: new Date().toISOString().slice(0, 10),
      bgPhoto: null,
      lat: null,
      lon: null,
      isOnline: false,
      lanOk: false,
      lanRssi: null,
      rtt: null,
      lastLanOk: 0,
      lastCloudSeen: 0,
      cloudOnline: null,
      updatedAt: Date.now(),
      irKeys: [],
      triggers: defaultTriggers()
    };
  }

  function defaultPrimaryDevice() {
    return {
      id: "a40a",
      name: "Living Room Light & Fan",
      room: "Living Room",
      ip: "192.168.1.120",
      state: false,
      state2: false,
      relay1Name: "Ceiling Light",
      relay2Name: "Ceiling Fan",
      relay1Icon: "bulb",
      relay2Icon: "fan",
      dual: true,
      isOnline: false
    };
  }

  function defaultShowcaseDevices() {
    return [defaultPrimaryDevice()];
  }

  // Upgrade devices saved by previous versions or synced from RelayControlApp Android
  function migrateDevice(raw) {
    const dev = Object.assign(newDevice(raw.name, raw.ip, raw.id || generateGuid()), raw);
    if (!dev.id) dev.id = generateGuid();
    if (!dev.updatedAt) dev.updatedAt = Date.now();
    if (raw.state === undefined && raw.isOn !== undefined) dev.state = !!raw.isOn;
    if (raw.state2 === undefined && raw.isOn2 !== undefined) dev.state2 = !!raw.isOn2;
    if (!raw.relay1Icon && raw.iconType) dev.relay1Icon = raw.iconType;
    if (!raw.bootState && raw.powerOnState) dev.bootState = raw.powerOnState;
    dev.room = (!dev.room || dev.room === "All Rooms") ? "Living Room" : dev.room;
    dev.dual = dev.dual !== false;
    dev.state = !!dev.state;
    dev.state2 = !!dev.state2;
    dev.isOn = dev.state;
    dev.isOn2 = dev.state2;
    dev.relay1Name = dev.relay1Name || dev.name || "Switch 1";
    dev.relay2Name = dev.relay2Name || "Switch 2";
    dev.relay1Icon = dev.relay1Icon || "bulb";
    dev.relay2Icon = dev.relay2Icon || "fan";
    dev.iconType = dev.relay1Icon;
    dev.powerOnState = dev.bootState || "LAST";
    dev.bootState2 = dev.bootState2 || dev.bootState || "LAST";
    dev.relay1Watts = typeof dev.relay1Watts === "number" ? dev.relay1Watts : (/fan/i.test(dev.relay1Name || "") ? 75 : /geyser|heater|motor|pump|ac/i.test(dev.relay1Name || "") ? 1500 : 12);
    dev.relay2Watts = typeof dev.relay2Watts === "number" ? dev.relay2Watts : (/fan/i.test(dev.relay2Name || "") ? 75 : /geyser|heater|motor|pump|ac/i.test(dev.relay2Name || "") ? 1500 : 12);
    dev.autoOffSec = typeof dev.autoOffSec === "number" ? dev.autoOffSec : 0;
    dev.autoOffSec2 = typeof dev.autoOffSec2 === "number" ? dev.autoOffSec2 : 0;
    dev.wallSwitchLock = !!dev.wallSwitchLock;
    const todayKey = new Date().toISOString().slice(0, 10);
    if (dev.energyDayKey !== todayKey) {
      dev.energyDayKey = todayKey;
      dev.runtimeMs1 = 0;
      dev.runtimeMs2 = 0;
      dev.lastOnAt1 = dev.state ? Date.now() : 0;
      dev.lastOnAt2 = dev.state2 ? Date.now() : 0;
    }

    const t = Object.assign(defaultTriggers(), raw.triggers || {});
    // deep-merge each trigger so newly added keys get defaults
    const defs = defaultTriggers();
    Object.keys(defs).forEach(k => { t[k] = Object.assign({}, defs[k], t[k] || {}); });
    dev.triggers = t;

    // Clean up expired one-shot countdown timers and phantom schedule states
    if (dev.triggers && dev.triggers.schedule) {
      const sch = dev.triggers.schedule;
      if (sch.timer && sch.timer.endsAt && Date.now() >= sch.timer.endsAt) {
        sch.timer = null;
      }
      if ((!sch.rules || !sch.rules.length) && !sch.timer) {
        sch.enabled = false;
      }
    }

    if (raw.mode && raw.mode !== "none" && !raw.triggers) {
      const map = { flicker: "effect", tilt: "tilt", "auto-proximity": "geofence", geofence: "geofence", presence: "geofence", "voice-custom": "voice", "trained-clap": "clap", shake: "shake", wrist: "flick" };
      const key = map[raw.mode];
      if (key) dev.triggers[key].enabled = true;
    }
    if (dev.triggers.presence && dev.triggers.presence.enabled && !dev.triggers.geofence.enabled) {
      dev.triggers.geofence.enabled = true;
      if (dev.triggers.presence.onArrive) dev.triggers.geofence.onEnter = dev.triggers.presence.onArrive;
      if (dev.triggers.presence.onLeave) dev.triggers.geofence.onExit = dev.triggers.presence.onLeave;
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
    const now = Date.now();
    const isFresh = (dev.lastLanOk && now - dev.lastLanOk < 120000) ||
                    (dev.lastCloudSeen && now - dev.lastCloudSeen < 120000);
    if (!isFresh) {
      dev.isOnline = false;
      dev.link = "none";
    }
    return dev;
  }

  function loadLocal(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
  }

  const loadedRaw = loadLocal("nari_devices", null);
  const initialDeviceList = (Array.isArray(loadedRaw) && loadedRaw.length > 0)
    ? loadedRaw.map(migrateDevice)
    : [migrateDevice(defaultPrimaryDevice())];

  const store = {
    devices: initialDeviceList,
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
    deletedIds: loadLocal("nari_deleted_ids", []),
    currentUser: null,
    db: null,
    auth: null,
    _saveTimer: null,
 
    identifierOf(dev) {
      if (!dev) return "switch";
      const raw = dev.id || (dev.ip || "switch").replace(/[^a-zA-Z0-9_-]/g, "_");
      return String(raw).toLowerCase();
    },
 
    findIndex(identifier) {
      if (!identifier) return -1;
      const target = String(identifier).toLowerCase();
      return this.devices.findIndex(d => 
        (d.id && d.id.toLowerCase() === target) || 
        (d.ip && d.ip === identifier) || 
        (d.ip || "").replace(/\./g, "_") === identifier || 
        this.identifierOf(d) === target
      );
    },
 
    exists(id, ip) {
      const targetId = id ? String(id).toLowerCase() : null;
      return this.devices.some(d => (targetId && d.id && d.id.toLowerCase() === targetId) || (ip && d.ip === ip));
    },
 
    add(partial) {
      const dev = migrateDevice(Object.assign(newDevice(partial.name, partial.ip, partial.id), partial));
      const key = String(dev.id || dev.ip || "").toLowerCase();
      if (key && Array.isArray(this.deletedIds)) {
        this.deletedIds = this.deletedIds.filter(x => x !== key);
      }
      this.devices.push(dev);
      this.save();
      bus.emit("devices:changed");
      return dev;
    },
 
    remove(index) {
      const removed = this.devices[index];
      if (removed) {
        const key = String(removed.id || removed.ip || "").toLowerCase();
        if (key && !this.deletedIds.includes(key)) {
          this.deletedIds.push(key);
          if (this.deletedIds.length > 100) this.deletedIds.shift();
        }
      }
      this.devices.splice(index, 1);
      this.save();
      bus.emit("devices:changed");
    },
 
    // Debounced persistence: localStorage immediately, Firestore after 800ms of quiet.
    save() {
      const now = Date.now();
      const clean = this.devices.map(d => {
        const c = Object.assign({}, d);
        delete c._isVerifying;
        delete c._expect;
        delete c._lastActor;
        delete c._lastLoggedState;
        delete c._lastLoggedState2;
        c.isOn = !!c.state;
        c.isOn2 = !!c.state2;
        c.iconType = c.relay1Icon || "bulb";
        c.powerOnState = c.bootState || "LAST";
        c.updatedAt = now;
        return c;
      });
      localStorage.setItem("nari_devices", JSON.stringify(clean));
      localStorage.setItem("nari_diy_patterns", JSON.stringify(this.diyPatterns));
      localStorage.setItem("nari_tilt_config", JSON.stringify(this.roomMap));
      localStorage.setItem("nari_nfc_tags", JSON.stringify(this.nfcTags));
      localStorage.setItem("nari_deleted_ids", JSON.stringify(this.deletedIds || []));
      NARI.saveSettings();

      if (this.currentUser && this.db) {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
          const payload = {
            email: this.currentUser.email,
            updatedAt: Date.now(),
            devices: clean,
            devices_json: JSON.stringify(clean),
            deviceCount: clean.length,
            source: "webapp",
            deletedIds: this.deletedIds || [],
            roomMap: this.roomMap,
            diyPatterns: this.diyPatterns,
            nfcTags: this.nfcTags,
            familySharing: NARI.sharing && NARI.sharing.data ? NARI.sharing.data : null,
            smartScenes: loadLocal("nari_smart_scenes", null),
            settings: { theme: NARI.settings.theme, voiceLang: NARI.settings.voiceLang, tariffRate: NARI.settings.tariffRate, homeLat: NARI.settings.homeLat, homeLon: NARI.settings.homeLon, homeRadiusM: NARI.settings.homeRadiusM }
          };
          // 1 MB Document Limit Safeguard
          try {
            const sizeBytes = new Blob([JSON.stringify(payload)]).size;
            if (sizeBytes > 800000) {
              console.warn(`[NARI Store] Document approaches 1MB limit (${sizeBytes} bytes). Stripping large image strings.`);
              payload.devices.forEach(d => {
                if (d.bgPhoto && d.bgPhoto.length > 20000) d.bgPhoto = null;
              });
            }
          } catch (e) {}

          this.db.collection("users").doc(this.currentUser.uid).set(payload, { merge: true }).catch(e => console.warn("Cloud save failed", e));
        }, 800);
      }
    },

    isDefaultShowcaseOnly() {
      return this.devices.length === 1 &&
             this.devices[0].id === "a40a" &&
             !localStorage.getItem("nari_devices");
    },

    async loadCloud(force = false) {
      if (!this.currentUser || !this.db) return;
      // ZERO-COST SHIELD: Only read from Firestore if this phone has 0 user-saved devices (new phone/fresh install)
      // or if explicitly requested. This prevents burning the 50,000 free daily reads when scaling to 1 Lakh+ customers.
      const onlyDemo = this.isDefaultShowcaseOnly();
      if (!force && this.devices.length > 0 && !onlyDemo) return;
      try {
        const doc = await this.db.collection("users").doc(this.currentUser.uid).get();
        if (!doc.exists) { if (this.devices.length && !onlyDemo) this.save(); return; }
        const data = doc.data();
        if (Array.isArray(data.deletedIds)) {
          this.deletedIds = Array.from(new Set([...(this.deletedIds || []), ...data.deletedIds]));
        }
        const delSet = new Set((this.deletedIds || []).map(x => String(x).toLowerCase()));
        let cloudList = Array.isArray(data.devices) ? data.devices : null;
        if ((!cloudList || !cloudList.length) && typeof data.devices_json === "string") {
          try { cloudList = JSON.parse(data.devices_json); } catch (e) { cloudList = null; }
        }
        if (Array.isArray(cloudList)) {
          const cloud = cloudList.map(migrateDevice).filter(cd => !delSet.has(String(cd.id || cd.ip || "").toLowerCase()));
          // Conflict-free two-way sync: Merge by switch ID with timestamp resolution
          const mergedMap = new Map();
          cloud.forEach(cd => mergedMap.set(cd.id || cd.ip, cd));
          if (!onlyDemo || cloud.length === 0) {
            this.devices.forEach(local => {
              const key = local.id || local.ip;
              if (delSet.has(String(key || "").toLowerCase())) return;
              const existing = mergedMap.get(key);
              if (!existing) {
                mergedMap.set(key, local); // switch was added locally while offline
              } else {
                const localTime = local.updatedAt || 0;
                const cloudTime = existing.updatedAt || 0;
                if (localTime >= cloudTime) {
                  mergedMap.set(key, Object.assign({}, existing, local));
                }
              }
            });
          }
          this.devices = Array.from(mergedMap.values());
        }
        if (data.roomMap) this.roomMap = Object.assign(this.roomMap, data.roomMap);
        if (Array.isArray(data.diyPatterns)) this.diyPatterns = data.diyPatterns;
        if (data.nfcTags) this.nfcTags = data.nfcTags;
        if (data.familySharing && NARI.sharing) {
          NARI.sharing.data = Object.assign({}, NARI.sharing.data, data.familySharing);
          try { localStorage.setItem("nari_family_sharing", JSON.stringify(NARI.sharing.data)); } catch (e) {}
        }
        if (Array.isArray(data.smartScenes) && NARI.scenes) {
          NARI.scenes.list = data.smartScenes;
          try { localStorage.setItem("nari_smart_scenes", JSON.stringify(data.smartScenes)); } catch (e) {}
        }
        if (data.settings) {
          ["homeLat", "homeLon", "homeRadiusM"].forEach(k => { if (data.settings[k] !== undefined && data.settings[k] !== null) NARI.settings[k] = data.settings[k]; });
        }
        this.save();
        bus.emit("devices:changed");
        if (force) bus.emit("toast", { text: "Cloud sync complete!", level: "ok" });
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
  NARI.migrateDevice = migrateDevice;
  NARI.defaultTriggers = defaultTriggers;
})(window);
