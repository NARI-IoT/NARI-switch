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
 
  const CLOUD_STALE_MS = 3 * 60 * 1000;
  const LAN_FRESH_MS   = 20 * 1000;   // ping was within 20 s → "fresh"
  const LAN_GRACE_MS   = 55 * 1000;   // keep card online up to 55 s after last OK ping (covers missed polls)
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
        client.on("message", (topic, msg) => this._onMessage(topic, msg.toString().trim()));
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
      if (store.devices && store.devices.length > 0) {
        store.devices.forEach(dev => {
          const id = store.identifierOf(dev);
          if (id) {
            this.client.subscribe(`${s.topicPrefix}/${id}/state`, { qos: 0 });
            this.client.subscribe(`${s.topicPrefix}/${id}/status`, { qos: 0 });
            this.client.subscribe(`${s.topicPrefix}/${id}/ota/error`, { qos: 0 });
          }
        });
      }
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
 
    _onMessage(topic, payload) {
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
 
      if (kind === "state") {
        const parsed = parseState(payload);
        if (parsed.state !== null) dev.state = parsed.state;
        if (parsed.fw) dev.fw = parsed.fw;
        dev.lastCloudSeen = now;
        if (dev.cloudOnline !== false) dev.cloudOnline = true;
        this._clearPending(dev);
        dev._isVerifying = false;
        dev.isOnline = true;
        store.save();
        bus.emit("device:updated", idx);
      } else if (kind === "status") {
        dev.cloudOnline = payload.toLowerCase() === "online";
        if (dev.cloudOnline) dev.lastCloudSeen = now;
        this._recomputeOnline(dev);
        bus.emit("device:updated", idx);
      } else if (kind === "ota/error") {
        bus.emit("toast", { text: `${dev.name}: firmware update failed - ${payload}`, level: "error" });
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
      dev.rtt = Math.round(performance.now() - t0);
      dev.lanOk = true;
      dev.lastLanOk = Date.now();
      dev.lanRssi = typeof data.rssi === "number" ? data.rssi : dev.lanRssi;
      if (data.id && !dev.id) dev.id = data.id;
      if (data.fw) dev.fw = data.fw;
      if (typeof data.state === "number") dev.state = data.state === 1;
      this._lanProbeSucceededOnce = true;
      return data;
    },
 
    lanFresh(dev) { return dev.lanOk && Date.now() - dev.lastLanOk < LAN_FRESH_MS; },
 
    // ---------------- command routing ----------------
    /** Set relay state. Returns "lan" | "cloud" | null (unreachable). */
    async setState(index, targetState, opts) {
      opts = opts || {};
      const dev = store.devices[index];
      if (!dev) return null;
      const quiet = !!opts.quiet;
      const timeout = opts.timeoutMs || NARI.settings.lanTimeoutMs;
 
      if (!quiet) { dev._isVerifying = true; bus.emit("device:updated", index); }
 
      const tryLan = async () => {
        if (!this.lanAllowed(dev)) return false;
        try {
          const text = await this.lanFetch(this.lanUrl(dev, "toggle", { state: targetState ? 1 : 0 }), timeout);
          const parsed = parseState(text);
          dev.state = parsed.state === null ? targetState : parsed.state;
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
        const ok = this.publish(this.topic(dev, "set"), targetState ? "1" : "0", { qos: 1 });
        if (!ok) return false;
        dev.state = targetState;  // optimistic; corrected by the retained state echo
        dev.lastCloudCmd = Date.now();
        if (!quiet) this._armPending(dev, index);
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
 
      dev._isVerifying = via === "cloud" && !quiet ? dev._isVerifying : false;
      if (via === null) { dev.isOnline = false; dev._isVerifying = false; }
      else { dev.isOnline = true; }
      dev.lastCmdVia = via;
      store.save();
      bus.emit("device:updated", index);
      if (via && !quiet) {
        bus.emit("device:commanded", { index, state: dev.state, via, source: opts.source || "manual" });
      }
      return via;
    },
 
    _armPending(dev, index) {
      const key = store.identifierOf(dev);
      this._clearPending(dev);
      dev._isVerifying = true;
      this.pendingEcho[key] = setTimeout(() => {
        // Firmware answered nothing within 4s. Command was accepted by the broker (QoS1) so keep the
        // optimistic state, but stop the "verifying" pulse and flag when the device is silent for long.
        dev._isVerifying = false;
        delete this.pendingEcho[key];
        this._recomputeOnline(dev);
        bus.emit("device:updated", index);
      }, 4000);
    },
    _clearPending(dev) {
      const key = store.identifierOf(dev);
      if (this.pendingEcho[key]) { clearTimeout(this.pendingEcho[key]); delete this.pendingEcho[key]; }
    },
 
    async setBootState(dev, mode) {
      let ok = false;
      if (this.lanAllowed(dev)) {
        try { await this.lanFetch(this.lanUrl(dev, "setBootState", { mode }), 800); ok = true; } catch (e) {}
      }
      if (this.publish(this.topic(dev, "config/boot"), mode, { qos: 1, retain: true })) ok = true;
      return ok;
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
        dev.isOnline = true;
        dev.link = cloudFresh || dev.cloudOnline === true ? "cloud" : "cloud-unverified";
        return;
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
        for (let i = 0; i < devs.length; i++) {
          const dev = devs[i];
          if (dev._isVerifying) continue;
          const key = store.identifierOf(dev);
          const before = `${dev.isOnline}|${dev.link}|${dev.lanRssi}|${dev.state}`;
          if (this.lanAllowed(dev)) {
            try {
              await this.lanPing(dev, 1400);
              // Ping succeeded: reset bad-count
              this._lanBadCount[key] = 0;
            } catch (e) {
              this._lanBadCount[key] = (this._lanBadCount[key] || 0) + 1;
              // Only clear lanOk after LAN_BAD_LIMIT consecutive failures (prevents one missed poll → offline)
              if (this._lanBadCount[key] >= LAN_BAD_LIMIT) {
                dev.lanOk = false; dev.lanRssi = null; dev.rtt = null;
              }
            }
          } else { dev.lanOk = false; }
          this._recomputeOnline(dev);
          if (before !== `${dev.isOnline}|${dev.link}|${dev.lanRssi}|${dev.state}`) bus.emit("device:updated", i);
        }
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
    const out = { state: null, fw: null };
    if (payload === null || payload === undefined) return out;
    const p = String(payload).trim();
    const j = safeJson(p);
    if (j && typeof j === "object") {
      if (j.state !== undefined) out.state = j.state === 1 || j.state === "1" || j.state === true || String(j.state).toLowerCase() === "on";
      if (j.fw) out.fw = String(j.fw);
      return out;
    }
    const low = p.toLowerCase();
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


