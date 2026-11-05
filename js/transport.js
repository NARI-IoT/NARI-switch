/* NARI Smart Switch - hybrid transport: LAN HTTP (ESP-01S web server) + Oracle Cloud Mosquitto over WebSockets.
 *
 * Firmware contract (see firmware/nari_switch_esp01s.ino):
 *   GET http://<ip>/ping?k=KEY                 -> {"id":"<MAC>","rssi":-55,"fw":"1.1.0","state":1}
 *   GET http://<ip>/toggle?state=1&k=KEY       -> "1"
 *   GET http://<ip>/setBootState?mode=LAST&k=KEY
 *   MQTT  nari/<MAC>/set          "1" | "0"
 *   MQTT  nari/<MAC>/state        {"state":1,"fw":"1.1.0"}   (retained)
 *   MQTT  nari/<MAC>/status       "online" | "offline"       (retained, LWT)
 *   MQTT  nari/<MAC>/config/boot  "LAST" | "ON" | "OFF"      (retained)
 *   MQTT  nari/<MAC>/ota          "<http url to .bin>"
 */
(function (global) {
  "use strict";
  const NARI = global.NARI;
  const { store, bus } = NARI;
 
  const CLOUD_STALE_MS = 120 * 1000; // universal 120s connectivity threshold (AGENTS.md rule 1 & 8)
  const CONFIRMATION_TIMEOUT_MS = 8000; // 8s hardware confirmation rule (AGENTS.md rule 2)
  const LAN_FRESH_MS   = 20 * 1000;   // ping was within 20 s → "fresh"
  const LAN_GRACE_MS   = 120 * 1000;  // universal 120s threshold (prevents false-offline UI lockouts)
  const LAN_BAD_LIMIT  = 3;           // consecutive failures before declaring LAN down
 
  const transport = {
    client: null,
    cloudState: "init",      // init | connecting | connected | reconnecting | offline | error | blocked | unconfigured
    cloudError: "",
    lanBlocked: false,       // true when the browser will refuse http:// LAN calls (mixed content)
    pendingEcho: {},         // identifier -> timeout id (waiting for the device to echo its new state)
    _lanBadCount: {},        // identifier -> consecutive failed polls
 
    // ---------------- MQTT ----------------
    connectCloud() {
      const s = NARI.settings;
      if (this.client) { try { this.client.end(true); } catch (e) {} this.client = null; }

      if (!s.brokerUrl || /YOUR-BROKER-HOST/.test(s.brokerUrl)) {
        this._setCloud("unconfigured", "Set your wss:// broker URL in Settings");
        return;
      }
      if (NARI.IS_SECURE_PAGE && /^ws:\/\//i.test(s.brokerUrl)) {
        this._setCloud("blocked", "Browser blocks ws:// from an https:// page. Use wss:// (TLS) - see README.");
        return;
      }
      if (typeof mqtt === "undefined") {
        this._setCloud("error", "MQTT library failed to load");
        return;
      }

      this._setCloud("connecting", "");
      this._mqttAttempts = (this._mqttAttempts || 0) + 1;
      // Exponential back-off: 3 s → 6 s → 12 s … capped at 60 s
      const reconnectPeriod = Math.min(3000 * Math.pow(2, Math.min(this._mqttAttempts - 1, 4)), 60000);
      try {
        const client = mqtt.connect(s.brokerUrl, {
          clientId: "nari_web_" + Math.random().toString(16).slice(2, 10),
          username: s.mqttUser || undefined,
          password: s.mqttPass || undefined,
          protocolVersion: 4,   // MQTT v3.1.1 — compatible with all Mosquitto versions
          protocolId: "MQTT",
          clean: true,
          keepalive: 60,
          reconnectPeriod,
          connectTimeout: 15000
        });
        this.client = client;

        client.on("connect", () => {
          this._mqttAttempts = 0; // reset back-off on success
          this._setCloud("connected", "");
          this.resubscribeDevices();
        });
        client.on("message", (topic, msg, packet) => this._onMessage(topic, msg.toString().trim(), packet));
        client.on("reconnect", () => this._setCloud("reconnecting", ""));
        client.on("offline", () => this._setCloud("offline", ""));
        client.on("close", () => { if (this.cloudState === "connected") this._setCloud("offline", ""); });
        client.on("error", (err) => {
          console.warn("MQTT error:", err && err.message || err);
          this._setCloud("error", (err && err.message) || "connection error");
        });
      } catch (e) {
        this._setCloud("error", e.message || String(e));
      }
    },

    // Reconnect when tab becomes visible again (catches sleep/resume cycles)
    _bindVisibility() {
      if (this._visibilityBound) return;
      this._visibilityBound = true;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && this.cloudState !== "connected" && this.cloudState !== "unconfigured" && this.cloudState !== "blocked") {
          console.log("[NARI] tab visible — reconnecting MQTT");
          this.connectCloud();
        }
      });
    },

 
    resubscribeDevices() {
      if (!this.client || !this.cloudConnected) return;
      const s = NARI.settings;
      if (!s || !s.topicPrefix) return;

      // Wildcard subscriptions allow automatic discovery of newly paired switches
      this.client.subscribe(`${s.topicPrefix}/+/status`, { qos: 0 });
      this.client.subscribe(`${s.topicPrefix}/+/state`, { qos: 0 });
      this.client.subscribe("device/+/status", { qos: 0 });
      this.client.subscribe("device/+/state", { qos: 0 });
      this.client.subscribe("device/+/hb", { qos: 0 });
      this.client.subscribe("device/+/presence", { qos: 0 });
      this.client.subscribe("device/+/signal", { qos: 0 });
      this.client.subscribe("device/+/ip", { qos: 0 });
      this.client.subscribe("device/+/ota/progress", { qos: 0 });
      this.client.subscribe("device/+/ota/error", { qos: 0 });
      this.client.subscribe("device/+/ir/learned", { qos: 0 });

      if (store.devices && store.devices.length > 0) {
        store.devices.forEach(dev => {
          const id = store.identifierOf(dev);
          if (id) {
            this.client.subscribe(`${s.topicPrefix}/${id}/state`, { qos: 0 });
            this.client.subscribe(`${s.topicPrefix}/${id}/status`, { qos: 0 });
            this.client.subscribe(`${s.topicPrefix}/${id}/ota/error`, { qos: 0 });
            this.client.subscribe(`${s.topicPrefix}/${id}/ota/progress`, { qos: 0 });
            this.client.subscribe(`device/${id}/state`, { qos: 0 });
            this.client.subscribe(`device/${id}/status`, { qos: 0 });
            this.client.subscribe(`device/${id}/ota/error`, { qos: 0 });
            this.publish(`device/${id}/cmd`, "STATUS", { qos: 1 });
            this.publish(`device/${id}/cmd`, "QUERY", { qos: 1 });
          }
          this._recomputeOnline(dev);
        });
        this.publish("device/all/cmd", "STATUS", { qos: 1 });
        this.publish("device/all/cmd", "QUERY", { qos: 1 });
      }
    },

    subscribeId(id) {
      if (!this.client || !this.cloudConnected || !id) return;
      const s = NARI.settings;
      const cleanId = String(id).toLowerCase();
      this.client.subscribe(`${s.topicPrefix}/${cleanId}/state`, { qos: 0 });
      this.client.subscribe(`${s.topicPrefix}/${cleanId}/status`, { qos: 0 });
      this.client.subscribe(`device/${cleanId}/state`, { qos: 0 });
      this.client.subscribe(`device/${cleanId}/status`, { qos: 0 });
      this.client.subscribe(`device/${cleanId}/ota/progress`, { qos: 0 });
    },

    disconnectCloud() {
      if (this.client) { try { this.client.end(true); } catch (e) {} this.client = null; }
      this._setCloud("offline", "");
    },
 
    get cloudConnected() { return this.cloudState === "connected"; },
 
    _setCloud(state, err) {
      this.cloudState = state;
      this.cloudError = err || "";
      bus.emit("cloud:state", { state, error: this.cloudError });
    },
 
    _onMessage(topic, payload, packet) {
      const parts = topic.split("/");
      if (parts.length < 3) return;
      const identifier = parts[1];
      const kind = parts.slice(2).join("/");
      const idx = store.findIndex(identifier);
      if (idx === -1) {
        // Unknown switch announcing itself on our broker -> offer it for adoption.
        if (kind === "state" || kind === "status") bus.emit("cloud:unknown-device", { id: identifier, kind, payload });
        return;
      }
      const dev = store.devices[idx];
      const now = Date.now();
      const isRetained = !!(packet && packet.retain);
 
      if (kind === "state") {
        const parsed = parseState(payload);
        const r1 = parsed.relay1 !== null ? parsed.relay1 : parsed.state;
        let a1 = true;
        let a2 = true;
        if (r1 !== null) a1 = this._applyReported(dev, 1, r1);
        if (parsed.relay2 !== null) a2 = this._applyReported(dev, 2, parsed.relay2);

        // Anti-flicker & resync guard: if reported state contradicts recent manual command or is stale retained, ignore
        const uProt1 = dev.lastUserCmdAt && dev.lastUserCmdAt[1] && (now - dev.lastUserCmdAt[1] < 10000);
        const uProt2 = dev.lastUserCmdAt && dev.lastUserCmdAt[2] && (now - dev.lastUserCmdAt[2] < 10000);

        if (!uProt1 && !uProt2 && !isRetained) {
          if (typeof parsed.autoOffSec === "number") dev.autoOffSec = parsed.autoOffSec;
          if (typeof parsed.autoOffSec2 === "number") dev.autoOffSec2 = parsed.autoOffSec2;
          if (typeof parsed.lock === "boolean") dev.wallSwitchLock = parsed.lock;
          if (typeof parsed.timerRemSec === "number") {
            dev.timerRemSec = parsed.timerRemSec;
            dev.hwTimerEndsAt = parsed.timerRemSec > 0 ? (now + parsed.timerRemSec * 1000) : 0;
          }
          if (typeof parsed.timerRemSec2 === "number" || typeof parsed.timer2 === "number") {
            const t2 = typeof parsed.timerRemSec2 === "number" ? parsed.timerRemSec2 : parsed.timer2;
            dev.timerRemSec2 = t2;
            dev.hwTimerEndsAt2 = t2 > 0 ? (now + t2 * 1000) : 0;
          }
        }

        if (parsed.fw) dev.fw = parsed.fw;
        if (parsed.ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.ip) && parsed.ip !== "0.0.0.0") {
          dev.ip = parsed.ip;
        }
        if (typeof parsed.rssi === "number") dev.lanRssi = parsed.rssi;
        dev.lastCloudSeen = now;
        if (dev.cloudOnline !== false) dev.cloudOnline = true;
        if (!this.isPending(dev, 1) && (!dev.dual || !this.isPending(dev, 2))) {
          this._clearPending(dev);
          dev._isVerifying = false;
        }
        dev.isOnline = true;
        store.save();
        bus.emit("device:updated", idx);
      } else if (kind === "status") {
        dev.cloudOnline = payload.toLowerCase() === "online";
        if (dev.cloudOnline) {
          dev.lastCloudSeen = now;
          this._clearPending(dev);
          dev._isVerifying = false;
        } else {
          dev.isOnline = false;
        }
        this._recomputeOnline(dev);
        bus.emit("device:updated", idx);
      } else if (kind === "hb" || kind === "presence" || kind === "signal" || kind === "ip") {
        dev.lastCloudSeen = now;
        dev.cloudOnline = true;
        this._clearPending(dev);
        dev._isVerifying = false;
        dev.isOnline = true;
        dev.link = "cloud";
        if (kind === "signal" && typeof payload === "string" && !isNaN(parseInt(payload, 10))) {
          dev.lanRssi = parseInt(payload, 10);
        }
        if (kind === "ip" && typeof payload === "string" && payload.includes(".")) {
          dev.ip = payload.trim();
        }
        store.save();
        bus.emit("device:updated", idx);
      } else if (kind === "ir/learned") {
        // Firmware payload: "<PROTOCOL>:0x<HEX>:<bits>"
        bus.emit("ir:learned", { index: idx, payload });
      } else if (kind === "ota/error") {
        bus.emit("toast", { text: `${dev.name}: firmware update failed - ${payload}`, level: "error" });
        bus.emit("ota:progress", { index: idx, status: "error", message: payload });
      } else if (kind === "ota/progress") {
        // Device reports: start | progress:<pct> | done | error:<msg>
        if (payload === "start") bus.emit("ota:progress", { index: idx, status: "start", pct: 0 });
        else if (payload === "done") bus.emit("ota:progress", { index: idx, status: "done", pct: 100 });
        else if (payload.indexOf("progress:") === 0) bus.emit("ota:progress", { index: idx, status: "progress", pct: parseInt(payload.slice(9), 10) || 0 });
        else if (payload.indexOf("error:") === 0) bus.emit("ota:progress", { index: idx, status: "error", message: payload.slice(6) });
      }
    },
 
    publish(topic, payload, opts) {
      if (!this.client || !this.cloudConnected) return false;
      this.client.publish(topic, payload, Object.assign({ qos: 1 }, opts || {}));
      return true;
    },
 
    topic(dev, suffix) { return `${NARI.settings.topicPrefix}/${store.identifierOf(dev)}/${suffix}`; },
 
    // ---------------- LAN ----------------
    lanUrl(dev, path, params) {
      const q = Object.assign({}, params || {}, { k: NARI.settings.lanToken });
      const qs = Object.keys(q).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(q[k])}`).join("&");
      return `http://${dev.ip}/${path}?${qs}`;
    },
 
    lanAllowed(dev) {
      return NARI.settings.lanEnabled && !!dev.ip && !this.lanBlocked;
    },
 
    async lanFetch(url, timeoutMs) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { method: "GET", mode: "cors", cache: "no-store", signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const text = await res.text();
        return text;
      } catch (e) {
        clearTimeout(timer);
        // A TypeError on an https page with an http URL == mixed content block. Remember it so we stop
        // paying the LAN timeout on every command.
        if (NARI.IS_SECURE_PAGE && e && e.name === "TypeError" && !this._lanProbeSucceededOnce) {
          this._mixedContentFailures = (this._mixedContentFailures || 0) + 1;
          if (this._mixedContentFailures >= 6 && !this.lanBlocked && !NARI.settings.forceLan) {
            this.lanBlocked = true;
            bus.emit("lan:blocked");
          }
        }
        throw e;
      }
    },
 
    async lanPing(dev, timeoutMs) {
      const t0 = performance.now();
      const text = await this.lanFetch(this.lanUrl(dev, "ping"), timeoutMs || NARI.settings.lanTimeoutMs);
      const data = safeJson(text) || {};
      const now = Date.now();
      dev.rtt = Math.round(performance.now() - t0);
      dev.lanOk = true;
      dev.lastLanOk = now;
      dev.lanRssi = typeof data.rssi === "number" ? data.rssi : dev.lanRssi;
      if (data.id && !dev.id) dev.id = data.id;
      if (data.fw) dev.fw = data.fw;

      const uProt1 = dev.lastUserCmdAt && dev.lastUserCmdAt[1] && (now - dev.lastUserCmdAt[1] < 10000);
      const uProt2 = dev.lastUserCmdAt && dev.lastUserCmdAt[2] && (now - dev.lastUserCmdAt[2] < 10000);

      if (!uProt1 && !uProt2) {
        if (typeof data.autoOffSec === "number") dev.autoOffSec = data.autoOffSec;
        if (typeof data.autoOffSec2 === "number") dev.autoOffSec2 = data.autoOffSec2;
        if (typeof data.lock === "number" || typeof data.lock === "boolean") dev.wallSwitchLock = data.lock === 1 || data.lock === true;
        if (typeof data.timerRemSec === "number") {
          dev.timerRemSec = data.timerRemSec;
          dev.hwTimerEndsAt = data.timerRemSec > 0 ? (now + data.timerRemSec * 1000) : 0;
        }
        if (typeof data.timerRemSec2 === "number" || typeof data.timer2 === "number") {
          const t2 = typeof data.timerRemSec2 === "number" ? data.timerRemSec2 : data.timer2;
          dev.timerRemSec2 = t2;
          dev.hwTimerEndsAt2 = t2 > 0 ? (now + t2 * 1000) : 0;
        }
      }
      if (typeof data.relay1 === "number" || typeof data.relay1 === "boolean") {
        this._applyReported(dev, 1, data.relay1 === 1 || data.relay1 === true);
      } else if (typeof data.state === "number" || typeof data.state === "boolean") {
        this._applyReported(dev, 1, data.state === 1 || data.state === true);
      }
      if (typeof data.relay2 === "number" || typeof data.relay2 === "boolean") {
        this._applyReported(dev, 2, data.relay2 === 1 || data.relay2 === true);
      }
      this._lanProbeSucceededOnce = true;
      return data;
    },
 
    lanFresh(dev) { return dev.lanOk && Date.now() - dev.lastLanOk < LAN_FRESH_MS; },

    // ---------------- anti-flicker: expected-state guard ----------------
    // After a user/automation command we expect the relay to reach `v`. Until the device confirms it
    // (or the 8s confirmation window ends) any contradicting report (stale retained MQTT message,
    // duplicate topic echo, in-flight LAN poll) is ignored so the UI never bounces.
    _expect(dev, relay, v, cmdTime) {
      dev._expect = dev._expect || {};
      dev._expect[relay] = { v: !!v, until: cmdTime + CONFIRMATION_TIMEOUT_MS, confirmed: false };
    },
    _clearExpect(dev, relay) { if (dev._expect) delete dev._expect[relay]; },
    isPending(dev, relay) {
      const e = dev._expect && dev._expect[relay];
      return !!e && !e.confirmed && Date.now() < e.until;
    },
    _trackEnergyTransition(dev, relay, newVal) {
      if (!dev) return;
      const now = Date.now();
      const todayKey = new Date().toISOString().slice(0, 10);
      if (dev.energyDayKey !== todayKey) {
        dev.energyDayKey = todayKey;
        dev.runtimeMs1 = 0;
        dev.runtimeMs2 = 0;
        dev.lastOnAt1 = dev.state ? now : 0;
        dev.lastOnAt2 = dev.state2 ? now : 0;
      }
      if (relay === 2) {
        const prev = !!dev.state2;
        if (prev && !newVal && dev.lastOnAt2) {
          dev.runtimeMs2 = (dev.runtimeMs2 || 0) + Math.max(0, now - dev.lastOnAt2);
          dev.lastOnAt2 = 0;
        } else if (!prev && newVal) {
          dev.lastOnAt2 = now;
        }
      } else {
        const prev = !!dev.state;
        if (prev && !newVal && dev.lastOnAt1) {
          dev.runtimeMs1 = (dev.runtimeMs1 || 0) + Math.max(0, now - dev.lastOnAt1);
          dev.lastOnAt1 = 0;
        } else if (!prev && newVal) {
          dev.lastOnAt1 = now;
        }
      }
    },
    /** Apply a device-reported relay state. Returns false when ignored as stale. */
    _applyReported(dev, relay, v) {
      const now = Date.now();
      const lastCmd = dev.lastUserCmdAt && dev.lastUserCmdAt[relay];
      const targetState = dev.userTargetState && dev.userTargetState[relay];

      // Anti-bounce / reconnect protection: within 10s of a user command, reject any contradictory state
      if (lastCmd && (now - lastCmd < 10000) && targetState !== undefined) {
        if (v !== targetState) {
          console.warn(`[NARI Anti-Bounce] Ignored contradictory report for ${dev.name || dev.id} relay ${relay}: got ${v}, expected ${targetState}`);
          return false;
        }
      }

      const e = dev._expect && dev._expect[relay];
      if (e && now < e.until) {
        if (v === e.v) {
          e.confirmed = true;
          // Maintain a 10s anti-bounce guard window against stale retained MQTT messages / delayed echoes
          e.until = Math.max(e.until, now + 10000);
        } else {
          return false;
        }
      } else if (e) {
        delete dev._expect[relay];
      }
      this._trackEnergyTransition(dev, relay, !!v);
      if (relay === 2) dev.state2 = v; else dev.state = v;
      return true;
    },
 
    // ---------------- command routing ----------------
    /** Set relay state. Returns "lan" | "cloud" | null (unreachable). */
    async setState(index, targetState, opts) {
      opts = opts || {};
      const dev = store.devices[index];
      if (!dev) return null;
      const relayNum = opts.relay || 1;
      const quiet = !!opts.quiet;
      const timeout = opts.timeoutMs || NARI.settings.lanTimeoutMs;
      const targetStateBool = !!targetState;

      const prevR1 = dev.state;
      const prevR2 = dev.state2;
      const prevOnline = dev.isOnline;
      const cmdTime = Date.now();

      // Track active user command timestamp and target state for 10s anti-bounce / reconnect shield
      dev.lastUserCmdAt = dev.lastUserCmdAt || {};
      dev.userTargetState = dev.userTargetState || {};
      dev.lastUserCmdAt[relayNum] = cmdTime;
      dev.userTargetState[relayNum] = targetStateBool;

      // Optimistic state update (+ guard against stale echoes until the device confirms)
      this._expect(dev, relayNum, targetStateBool, cmdTime);
      this._trackEnergyTransition(dev, relayNum, targetStateBool);
      if (relayNum === 2) {
        dev.state2 = targetStateBool;
      } else {
        dev.state = targetStateBool;
      }

      if (!quiet) { dev._isVerifying = true; bus.emit("device:updated", index); }

      const tryLan = async () => {
        if (!this.lanAllowed(dev)) return false;
        try {
          let text;
          try {
            // ESP32 firmware endpoint: /toggle?relay=1|2&state=1|0
            text = await this.lanFetch(this.lanUrl(dev, "toggle", { relay: relayNum, state: targetStateBool ? 1 : 0 }), timeout);
          } catch (e) {
            if (relayNum === 2) {
              // Fallback for any legacy modules mapping relay 2 to /toggle2
              text = await this.lanFetch(this.lanUrl(dev, "toggle2", { state: targetStateBool ? 1 : 0 }), timeout);
            } else {
              throw e;
            }
          }
          const parsed = parseState(text);
          const lanVal = relayNum === 2
            ? (parsed.relay2 !== null ? parsed.relay2 : targetStateBool)
            : (parsed.relay1 !== null ? parsed.relay1 : (parsed.state !== null ? parsed.state : targetStateBool));
          if (lanVal === targetStateBool) this._applyReported(dev, relayNum, lanVal);
          else { this._clearExpect(dev, relayNum); if (relayNum === 2) dev.state2 = lanVal; else dev.state = lanVal; }
          dev.lanOk = true;
          dev.lastLanOk = Date.now();
          return true;
        } catch (e) {
          dev.lanOk = false;
          return false;
        }
      };
      const tryCloud = () => {
        if (!this.cloudConnected) return false;
        const id = store.identifierOf(dev);
        const cmdPayload = (relayNum === 2)
          ? (targetStateBool ? "r2:1" : "r2:0")
          : (targetStateBool ? "r1:1" : "r1:0");
        const ok = this.publish(`device/${id}/cmd`, cmdPayload, { qos: 1 });
        this.publish(this.topic(dev, "set"), (relayNum === 2 ? cmdPayload : (targetStateBool ? "1" : "0")), { qos: 1 });
        if (!ok) return false;
        dev.lastCloudCmd = Date.now();
        if (!quiet) this._armPending(dev, index, { relayNum, prevR1, prevR2, prevOnline, cmdTime });
        return true;
      };

      let via = null;
      // Prefer whichever path answered most recently; always try the other one as a fallback.
      if (this.lanFresh(dev) || !this.cloudConnected) {
        if (await tryLan()) via = "lan"; else if (tryCloud()) via = "cloud";
      } else {
        if (tryCloud()) via = "cloud"; else if (await tryLan()) via = "lan";
        // keep LAN knowledge warm in the background
        if (via === "cloud" && this.lanAllowed(dev) && !this.lanFresh(dev)) this.lanPing(dev, 600).catch(() => { dev.lanOk = false; });
      }

      dev._isVerifying = !quiet && (this.isPending(dev, 1) || (dev.dual && this.isPending(dev, 2)));
      if (via === "lan") {
        dev.isOnline = true;
      } else if (via === null) {
        this._recomputeOnline(dev);
        dev._isVerifying = false;
      }
      dev.lastCmdVia = via;
      store.save();
      bus.emit("device:updated", index);
      if (via && !quiet) {
        bus.emit("device:commanded", { index, relay: relayNum, state: (relayNum === 2 ? dev.state2 : dev.state), via, source: opts.source || "manual" });
      }
      return via;
    },

    async allOn(roomFilter) {
      for (let i = 0; i < store.devices.length; i++) {
        const dev = store.devices[i];
        if (roomFilter && roomFilter !== "all" && (dev.room || "Living Room") !== roomFilter) continue;
        await this.setState(i, true, { relay: 1, quiet: true });
        if (dev.dual) await this.setState(i, true, { relay: 2, quiet: true });
      }
      store.save();
      bus.emit("devices:changed");
    },

    async allOff(roomFilter) {
      for (let i = 0; i < store.devices.length; i++) {
        const dev = store.devices[i];
        if (roomFilter && roomFilter !== "all" && (dev.room || "Living Room") !== roomFilter) continue;
        await this.setState(i, false, { relay: 1, quiet: true });
        if (dev.dual) await this.setState(i, false, { relay: 2, quiet: true });
      }
      store.save();
      bus.emit("devices:changed");
    },
 
    _armPending(dev, index, ctx = {}) {
      const key = store.identifierOf(dev);
      this._clearPending(dev);
      dev._isVerifying = true;
      this.pendingEcho[key] = setTimeout(() => {
        delete this.pendingEcho[key];
        const current = store.devices[index];
        if (!current) return;

        const cmdTime = ctx.cmdTime || 0;
        const rn = ctx.relayNum === 2 ? 2 : 1;
        const exp = current._expect && current._expect[rn];
        const confirmed = (exp && exp.confirmed) ||
                          (!exp && ((current.lastCloudSeen && current.lastCloudSeen >= cmdTime) ||
                                    (current.lastLanOk && current.lastLanOk >= cmdTime)));
        this._clearExpect(current, rn);

        if (!confirmed) {
          // AGENTS.md Rule 2: The 8s Confirmation Rule
          // Hardware didn't confirm within 8s: Rollback to previous state and mark offline
          if (ctx.relayNum === 2) {
            current.state2 = ctx.prevR2 !== undefined ? ctx.prevR2 : false;
          } else {
            current.state = ctx.prevR1 !== undefined ? ctx.prevR1 : false;
          }
          current.isOnline = false;
          current.cloudOnline = false;
          current.link = "none";
          current._isVerifying = false;
          store.save();
          bus.emit("device:updated", index);
          bus.emit("toast", { text: `${current.name} is Offline (no response)`, level: "warn" });
        } else {
          current._isVerifying = false;
          this._recomputeOnline(current);
          store.save();
          bus.emit("device:updated", index);
        }
      }, CONFIRMATION_TIMEOUT_MS);
    },
    _clearPending(dev) {
      const key = store.identifierOf(dev);
      if (this.pendingEcho[key]) { clearTimeout(this.pendingEcho[key]); delete this.pendingEcho[key]; }
    },
 
    async setBootState(dev, mode, extra) {
      extra = extra || {};
      const autoOffSec = extra.autoOffSec !== undefined ? extra.autoOffSec : (dev.autoOffSec || 0);
      const autoOffSec2 = extra.autoOffSec2 !== undefined ? extra.autoOffSec2 : (dev.autoOffSec2 || 0);
      const boot2 = extra.bootState2 || dev.bootState2 || mode;
      const lock = extra.wallSwitchLock !== undefined ? (extra.wallSwitchLock ? 1 : 0) : (dev.wallSwitchLock ? 1 : 0);
      let ok = false;
      if (this.lanAllowed(dev)) {
        try {
          await this.lanFetch(this.lanUrl(dev, "setBootState", {
            mode,
            mode2: boot2,
            autoOff: autoOffSec,
            autoOff1: autoOffSec,
            autoOff2: autoOffSec2,
            autoOffSec,
            lock
          }), 800);
          ok = true;
        } catch (e) {}
      }
      if (this.publish(this.topic(dev, "config/boot"), mode, { qos: 1, retain: true })) ok = true;
      this.publish(this.topic(dev, "config/boot2"), boot2, { qos: 1, retain: true });
      this.publish(this.topic(dev, "config/inching"), String(autoOffSec), { qos: 1, retain: true });
      this.publish(this.topic(dev, "config/inching1"), String(autoOffSec), { qos: 1, retain: true });
      this.publish(this.topic(dev, "config/inching2"), String(autoOffSec2), { qos: 1, retain: true });
      this.publish(this.topic(dev, "config/lock"), String(lock), { qos: 1, retain: true });
      return ok;
    },

    async setHardwareTimer(dev, seconds, targetStateBool, relayNum) {
      if (!dev) return false;
      const rn = relayNum || 1;
      const sec = Math.max(0, Math.round(Number(seconds) || 0));
      const st = targetStateBool ? 1 : 0;
      if (rn === 2) {
        dev.timerRemSec2 = sec;
        dev.hwTimerEndsAt2 = sec > 0 ? (Date.now() + sec * 1000) : 0;
        if (sec === 0) dev.autoOffSec2 = 0;
      } else {
        dev.timerRemSec = sec;
        dev.hwTimerEndsAt = sec > 0 ? (Date.now() + sec * 1000) : 0;
        if (sec === 0) dev.autoOffSec = 0;
      }
      let ok = false;
      if (this.lanAllowed(dev)) {
        try { await this.lanFetch(this.lanUrl(dev, "timer", { ch: rn, sec, state: st }), 800); ok = true; } catch (e) {}
        if (sec === 0) {
          try { await this.lanFetch(this.lanUrl(dev, "setBootState", { [rn === 2 ? 'autoOff2' : 'autoOff1']: 0 }), 800); } catch (e) {}
        }
      }
      const payload = sec > 0 ? `${sec}:${st}` : "0";
      const id = store.identifierOf(dev);
      const topicSuffix = rn === 2 ? "timer2" : "timer";
      if (this.publish(this.topic(dev, topicSuffix), payload, { qos: 1, retain: sec === 0 })) ok = true;
      if (id) {
        this.publish(`device/${id}/${topicSuffix}`, payload, { qos: 1, retain: sec === 0 });
        if (sec === 0) {
          this.publish(`device/${id}/cmd`, `timer${rn}:0`, { qos: 1 });
          this.publish(`nari/${id}/config/inching${rn}`, "0", { qos: 1, retain: true });
          this.publish(`device/${id}/cmd`, `INCHING${rn}:0`, { qos: 1 });
        }
      }
      return ok;
    },

    async cancelDeviceTimers(dev, relayNum) {
      if (!dev) return false;
      const rn = relayNum || 1;
      const id = store.identifierOf(dev);

      if (rn === 2) {
        dev.timerRemSec2 = 0;
        dev.hwTimerEndsAt2 = 0;
        dev.autoOffSec2 = 0;
      } else {
        dev.timerRemSec = 0;
        dev.hwTimerEndsAt = 0;
        dev.autoOffSec = 0;
      }

      // 1. MQTT disarm across standard and legacy topics
      if (id) {
        const top = rn === 2 ? "timer2" : "timer";
        this.publish(`device/${id}/${top}`, "0", { qos: 1, retain: true });
        this.publish(this.topic(dev, top), "0", { qos: 1, retain: true });
        this.publish(`device/${id}/cmd`, `timer${rn}:0`, { qos: 1 });
        this.publish(`device/${id}/cmd`, `TIMER${rn}:0`, { qos: 1 });
        this.publish(`nari/${id}/config/inching${rn}`, "0", { qos: 1, retain: true });
        this.publish(`device/${id}/cmd`, `INCHING${rn}:0`, { qos: 1 });
        if (rn === 1) {
          this.publish(`device/${id}/timer`, "0", { qos: 1, retain: true });
          this.publish(this.topic(dev, "timer"), "0", { qos: 1, retain: true });
          this.publish(`nari/${id}/config/inching`, "0", { qos: 1, retain: true });
          this.publish(`device/${id}/cmd`, "INCHING:0", { qos: 1 });
        }
      }

      // 2. LAN REST disarm (fire-and-forget sub-800ms)
      if (this.lanAllowed(dev)) {
        try { this.lanFetch(this.lanUrl(dev, "timer", { ch: rn, sec: 0, state: 0 }), 800).catch(() => {}); } catch (e) {}
        try { this.lanFetch(this.lanUrl(dev, "setBootState", { [rn === 2 ? 'autoOff2' : 'autoOff1']: 0 }), 800).catch(() => {}); } catch (e) {}
      }
      return true;
    },
 
    async triggerOta(dev, binUrl) {
      let ok = false;
      if (this.lanAllowed(dev)) {
        try { await this.lanFetch(this.lanUrl(dev, "ota", { url: binUrl }), 1500); ok = true; } catch (e) {}
      }
      if (!ok && this.publish(this.topic(dev, "ota"), binUrl, { qos: 1 })) ok = true;
      return ok;
    },
 
    // ---------------- health polling ----------------
    _recomputeOnline(dev) {
      const now = Date.now();
      const lanFresh = this.lanFresh(dev);
      // Grace period: if we had a LAN response in the last LAN_GRACE_MS, stay online even if the
      // last poll timed out (covers momentary Wi-Fi blips and the ESP-01S being briefly busy).
      const lanGrace = dev.lastLanOk && now - dev.lastLanOk < LAN_GRACE_MS;
      const cloudFresh = dev.lastCloudSeen && now - dev.lastCloudSeen < CLOUD_STALE_MS;

      if (lanFresh) { dev.isOnline = true; dev.link = "lan"; return; }
      if (lanGrace) {
        // LAN was up very recently — stay online but mark as "recovering"
        dev.isOnline = true; dev.link = "lan-grace"; return;
      }
      if (this.cloudConnected) {
        if (dev.cloudOnline === false) { dev.isOnline = false; dev.link = "cloud-offline"; return; }
        if (dev.cloudOnline === true || cloudFresh) {
          dev.isOnline = true;
          dev.link = "cloud";
          return;
        }
      }
      // Neither LAN fresh nor cloud connected. Only declare offline after LAN_GRACE_MS has expired.
      if (lanGrace) { dev.isOnline = true; dev.link = "lan-grace"; return; }
      dev.isOnline = false;
      dev.link = "none";
    },
 
    _polling: false,
    async pollAll() {
      if (this._polling || NARI.isScanning) return;
      this._polling = true;
      try {
        const devs = store.devices;
        await Promise.all(devs.map(async (dev, i) => {
          const hasRecentCmd = dev.lastUserCmdAt && (
            (Date.now() - (dev.lastUserCmdAt[1] || 0) < 10000) ||
            (Date.now() - (dev.lastUserCmdAt[2] || 0) < 10000)
          );
          if (dev._isVerifying || hasRecentCmd) return;
          const key = store.identifierOf(dev);
          const before = `${dev.isOnline}|${dev.link}|${dev.lanRssi}|${dev.state}|${dev.state2}`;
          if (this.lanAllowed(dev)) {
            try {
              await this.lanPing(dev, 1400);
              this._lanBadCount[key] = 0;
            } catch (e) {
              this._lanBadCount[key] = (this._lanBadCount[key] || 0) + 1;
              if (this._lanBadCount[key] >= LAN_BAD_LIMIT) {
                dev.lanOk = false; dev.lanRssi = null; dev.rtt = null;
              }
            }
          } else { dev.lanOk = false; }
          this._recomputeOnline(dev);
          if (before !== `${dev.isOnline}|${dev.link}|${dev.lanRssi}|${dev.state}|${dev.state2}`) bus.emit("device:updated", i);
        }));
        bus.emit("poll:done");
      } finally { this._polling = false; }
    },
 
    // ---------------- discovery ----------------
    async probeIp(ip, timeoutMs) {
      try {
        const text = await this.lanFetch(`http://${ip}/ping?k=${encodeURIComponent(NARI.settings.lanToken)}`, timeoutMs || 1200);
        const data = safeJson(text) || {};
        if (!data.id && typeof data.rssi !== "number") return null;
        return { ip, id: data.id || "", rssi: data.rssi, fw: data.fw, state: data.state };
      } catch (e) { return null; }
    },

    /** Detect browser's local LAN subnet via WebRTC (e.g. "192.168.1").
     *  Returns null if WebRTC unavailable or times out. */
    async _detectLocalSubnet() {
      return new Promise(resolve => {
        try {
          const pc = new RTCPeerConnection({ iceServers: [] });
          pc.createDataChannel("");
          const timer = setTimeout(() => { try { pc.close(); } catch(e){} resolve(null); }, 1500);
          pc.onicecandidate = (ice) => {
            if (!ice || !ice.candidate || !ice.candidate.candidate) return;
            // Match an IPv4 LAN address (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
            const m = ice.candidate.candidate.match(
              /(\b(?:192\.168|10\.\d+|172\.(?:1[6-9]|2\d|3[01]))\.\d+)\.\d+\b/
            );
            if (m) {
              clearTimeout(timer);
              try { pc.close(); } catch(e) {}
              resolve(m[1]); // e.g. "192.168.1"
            }
          };
          pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => resolve(null));
        } catch(e) { resolve(null); }
      });
    },

    /** Scan LAN for NARI switches.
     *  Auto-detects the correct subnet via WebRTC first — customers never need to configure anything.
     *  Falls back to the configured subnet list if auto-detect fails. */
    async scanLan(onProgress) {
      const found = [];
      NARI.isScanning = true;
      try {
        // 1. Auto-detect the browser's own subnet — always the right one
        onProgress && onProgress(0, "Detecting your network...");
        const autoSubnet = await this._detectLocalSubnet();

        // 2. Build the subnet list: auto-detected first, then configured fallbacks (deduped)
        const configured = (NARI.settings.lanScanSubnets || "").split(",").map(s => s.trim()).filter(Boolean);
        const subnets = autoSubnet
          ? [autoSubnet, ...configured.filter(s => s !== autoSubnet)]
          : configured;

        const total = subnets.length * 254;
        let done = 0;

        for (const prefix of subnets) {
          const label = prefix === autoSubnet ? `Your network (${prefix}.x)` : `${prefix}.x`;
          // Scan in batches of 32 in parallel for speed
          for (let start = 1; start <= 254; start += 32) {
            const batch = [];
            for (let h = start; h < start + 32 && h <= 254; h++) batch.push(`${prefix}.${h}`);
            const results = await Promise.all(batch.map(ip => this.probeIp(ip, 1200)));
            done += batch.length;
            onProgress && onProgress(Math.round((done / total) * 100), `Scanning ${label}`);
            results.filter(Boolean).forEach(r => { if (!found.some(f => f.ip === r.ip)) found.push(r); });
          }
          if (found.length) break; // Found on this subnet — stop searching
        }
      } finally { NARI.isScanning = false; }
      return found;
    },
 
    // ---------------- diagnostics ----------------
    diagnostics() {
      const s = NARI.settings;
      const out = [];
      if (NARI.IS_SECURE_PAGE) {
        if (/^ws:\/\//i.test(s.brokerUrl)) out.push({ level: "error", text: "Broker URL is ws:// but this page is https://. Chrome blocks it. Switch the broker to wss:// (TLS)." });
        if (this.lanBlocked) out.push({ level: "warn", text: "LAN control is blocked by the browser (https page -> http switch). Commands are routed via Cloud. For direct LAN use the Android app wrapper or open the app over http://." });
        else if (s.lanEnabled) out.push({ level: "info", text: "LAN calls from an https page are usually blocked as mixed content; if switches never show 'LAN', rely on Cloud." });
      }
      if (this.cloudState === "unconfigured") out.push({ level: "info", text: "Running in LAN-only mode — switches are controlled directly over your home Wi-Fi. For remote/cloud access, set a broker URL in Settings." });
      if (this.cloudState === "error") out.push({ level: "error", text: `Cloud error: ${this.cloudError || "connection failed"}. Check broker TLS certificate, port 9001 in the Oracle security list and Mosquitto websockets listener.` });
      if (!navigator.onLine) out.push({ level: "error", text: "Phone is offline." });
      return out;
    }
  };
 
  function parseState(payload) {
    const out = { state: null, relay1: null, relay2: null, fw: null, ip: null, rssi: null, autoOffSec: null, lock: null, timerRemSec: null };
    if (payload === null || payload === undefined) return out;
    const p = String(payload).trim();
    const j = safeJson(p);
    if (j && typeof j === "object") {
      if (j.state !== undefined) out.state = j.state === 1 || j.state === "1" || j.state === true || String(j.state).toLowerCase() === "on";
      if (j.relay1 !== undefined) out.relay1 = j.relay1 === 1 || j.relay1 === "1" || j.relay1 === true || String(j.relay1).toLowerCase() === "on";
      if (j.relay2 !== undefined) out.relay2 = j.relay2 === 1 || j.relay2 === "1" || j.relay2 === true || String(j.relay2).toLowerCase() === "on";
      if (j.fw) out.fw = String(j.fw);
      if (j.ip) out.ip = String(j.ip);
      if (typeof j.rssi === "number") out.rssi = j.rssi;
      if (typeof j.autoOffSec === "number") out.autoOffSec = j.autoOffSec;
      if (typeof j.lock === "number" || typeof j.lock === "boolean") out.lock = j.lock === 1 || j.lock === true;
      if (typeof j.timerRemSec === "number") out.timerRemSec = j.timerRemSec;
      return out;
    }
    const low = p.toLowerCase();
    const m = low.match(/^r([12])\s*:\s*(1|0|on|off|true|false)$/);
    if (m) {
      const isTrue = ["1", "on", "true"].includes(m[2]);
      if (m[1] === "1") { out.relay1 = isTrue; out.state = isTrue; }
      else if (m[1] === "2") { out.relay2 = isTrue; }
      return out;
    }
    if (["1", "on", "true"].includes(low)) out.state = true;
    else if (["0", "off", "false"].includes(low)) out.state = false;
    return out;
  }
 
  function safeJson(text) { try { return JSON.parse(text); } catch (e) { return null; } }
 
  NARI.transport = transport;
  NARI.parseState = parseState;

  // Bind tab-visibility reconnect as soon as transport is available
  transport._bindVisibility();
  bus.on("devices:changed", () => transport.resubscribeDevices());
})(window);


