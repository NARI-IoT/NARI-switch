/* NARI Smart Switch - UI Orchestrator and Modal Renderer */
(function (global) {
  "use strict";
  const NARI = global.NARI;
  const { store, bus, transport, sensors, audio } = NARI;

  const dom = {
    deviceList: document.getElementById("deviceList"),
    statusStrip: document.getElementById("statusStrip"),
    banners: document.getElementById("banners"),
    overlay: document.getElementById("overlay"),
    sheet: document.getElementById("sheet"),
    toasts: document.getElementById("toasts"),
    authContainer: document.getElementById("authContainer"),
    btnLogin: document.getElementById("btnLogin"),
    btnDiag: document.getElementById("btnDiag"),
    diagDot: document.getElementById("diagDot"),
    btnRefresh: document.getElementById("btnRefresh"),
    pullToRefresh: document.getElementById("pullToRefresh"),
    ptrIcon: document.getElementById("ptrIcon"),
    ptrSpinner: document.getElementById("ptrSpinner"),
    ptrText: document.getElementById("ptrText"),
    btnScenes: document.getElementById("btnScenes"),
    btnShare: document.getElementById("btnShare"),
    btnSettings: document.getElementById("btnSettings"),
    btnAdd: document.getElementById("btnAdd"),
    btnInstall: document.getElementById("btnInstall"),
    btnMasterOn: document.getElementById("btnMasterOn"),
    btnMasterOff: document.getElementById("btnMasterOff"),
    btnMasterAdd: document.getElementById("btnMasterAdd"),
    roomFilterBar: document.getElementById("roomFilterBar"),
    cloudEdgeStatus: document.getElementById("cloudEdgeStatus"),
    cloudEdgeText: document.getElementById("cloudEdgeText")
  };

  let deferredInstallPrompt = null;
  let audioTrainingCtrl = null;

  // --- Theme Management ---
  function applyTheme(theme) {
    document.body.className = "";
    if (theme && theme !== "default") {
      document.body.classList.add(`theme-${theme}`);
    }
  }

  // --- Toast Notifications ---
  function showToast(text, level = "info") {
    const t = document.createElement("div");
    t.className = `toast ${level}`;
    t.innerText = text;
    dom.toasts.appendChild(t);
    setTimeout(() => {
      t.style.opacity = "0";
      setTimeout(() => t.remove(), 350);
    }, 3200);
  }
  bus.on("toast", e => showToast(e.text, e.level));
  NARI.showToast = showToast;

  // --- Firmware (OTA) helpers ---
  let pendingOtaInfo = null;   // { binUrl, version } from the last manifest check
  let otaSession = null;       // { index, targetVersion, stallTimer, totalTimer } while an update is running

  function escHtml(v) {
    return String(v === null || v === undefined ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // The ESP-01S can only fetch plain http:// firmware images.
  function isValidOtaUrl(u) {
    return typeof u === "string" && /^http:\/\/[^\s'"<>]+\.bin$/i.test(u) && u.length < 200;
  }

  function compareVersions(a, b) {
    const pa = String(a).replace(/^v/i, "").split(".").map(n => parseInt(n, 10) || 0);
    const pb = String(b).replace(/^v/i, "").split(".").map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  function endOtaSession() {
    if (!otaSession) return;
    clearTimeout(otaSession.stallTimer);
    clearTimeout(otaSession.totalTimer);
    otaSession = null;
  }

  function otaSetProgress(pct, text) {
    const fill = document.getElementById("otaFill");
    const pctText = document.getElementById("otaPctText");
    const statusText = document.getElementById("otaStatusText");
    if (fill && pct !== null) fill.style.width = pct + "%";
    if (pctText && pct !== null) pctText.innerText = pct + "%";
    if (statusText && text) statusText.innerText = text;
  }

  function otaFail(index, msg) {
    endOtaSession();
    const dev = store.devices[index];
    const container = document.getElementById("otaContent");
    if (container) {
      container.innerHTML = `
        <div class="small" style="color:var(--danger,#ef4444);margin-bottom:6px;"><i class="fa-solid fa-circle-xmark"></i> Update failed: ${escHtml(msg)}</div>
        <button class="btn secondary sm" style="width:100%;" onclick="NARI.app.checkFirmwareUpdate(${index})">Try Again</button>
      `;
    }
    showToast(`${dev ? dev.name : "Device"}: firmware update failed`, "error");
  }

  // Real progress reported by the device over MQTT (nari/<id>/ota/progress).
  bus.on("ota:progress", e => {
    if (!otaSession || e.index !== otaSession.index) return;
    if (e.status === "error") { otaFail(e.index, e.message || "unknown error"); return; }
    clearTimeout(otaSession.stallTimer);
    otaSession.stallTimer = setTimeout(() => otaFail(e.index, "Device stopped responding."), 90000);
    if (e.status === "progress") otaSetProgress(Math.min(e.pct, 99), "Writing firmware to device...");
    else if (e.status === "done") otaSetProgress(99, "Restarting device...");
  });

  // Success is declared ONLY when the device itself reports the new version (via LAN ping or MQTT state).
  bus.on("device:updated", index => {
    if (!otaSession || index !== otaSession.index) return;
    const dev = store.devices[index];
    if (dev && dev.fw && compareVersions(dev.fw, otaSession.targetVersion) >= 0) {
      const v = dev.fw;
      endOtaSession();
      otaSetProgress(100, "Update complete!");
      const cur = document.getElementById("otaCurrentVer");
      if (cur) cur.innerText = "v" + v;
      showToast(`✅ ${dev.name} updated to v${v}!`, "ok");
    }
  });


  // --- Room Filtering & Appliance Icons ---
  let currentRoomFilter = "all";

  function getApplianceIcon(type, isOn) {
    type = (type || "").toLowerCase();
    if (type.includes("fan") || type.includes("exhaust")) {
      return `<i class="fa-solid fa-fan ${isOn ? 'fa-spin' : ''}" style="color:${isOn ? '#a78bfa' : '#64748b'};font-size:3.1rem;filter:${isOn ? 'drop-shadow(0 0 18px rgba(167,139,250,0.85))' : 'none'};"></i>`;
    }
    if (type.includes("ac") || type.includes("air") || type.includes("conditioner") || type.includes("cool")) {
      return `<i class="fa-solid fa-snowflake" style="color:${isOn ? '#38bdf8' : '#64748b'};font-size:3.1rem;filter:${isOn ? 'drop-shadow(0 0 18px rgba(56,189,248,0.85))' : 'none'};"></i>`;
    }
    if (type.includes("geyser") || type.includes("heater") || type.includes("boiler")) {
      return `<i class="fa-solid fa-fire-flame-curved" style="color:${isOn ? '#f97316' : '#64748b'};font-size:3.1rem;filter:${isOn ? 'drop-shadow(0 0 18px rgba(249,115,22,0.85))' : 'none'};"></i>`;
    }
    if (type.includes("socket") || type.includes("plug") || type.includes("outlet")) {
      return `<i class="fa-solid fa-plug" style="color:${isOn ? '#34d399' : '#64748b'};font-size:3.1rem;filter:${isOn ? 'drop-shadow(0 0 18px rgba(52,211,153,0.85))' : 'none'};"></i>`;
    }
    if (type.includes("motor") || type.includes("pump") || type.includes("tank")) {
      return `<i class="fa-solid fa-water" style="color:${isOn ? '#06b6d4' : '#64748b'};font-size:3.1rem;filter:${isOn ? 'drop-shadow(0 0 18px rgba(6,182,212,0.85))' : 'none'};"></i>`;
    }
    if (type.includes("lamp") || type.includes("bedside") || type.includes("desk")) {
      return `<i class="fa-solid fa-bolt" style="color:${isOn ? '#f59e0b' : '#64748b'};font-size:3.1rem;filter:${isOn ? 'drop-shadow(0 0 18px rgba(245,158,11,0.85))' : 'none'};"></i>`;
    }
    if (type.includes("tv") || type.includes("screen")) {
      return `<i class="fa-solid fa-tv" style="color:${isOn ? '#c084fc' : '#64748b'};font-size:3.1rem;filter:${isOn ? 'drop-shadow(0 0 18px rgba(192,132,252,0.85))' : 'none'};"></i>`;
    }
    return `<i class="fa-solid fa-lightbulb" style="color:${isOn ? '#fbbf24' : '#64748b'};font-size:3.1rem;filter:${isOn ? 'drop-shadow(0 0 18px rgba(251,191,36,0.85))' : 'none'};"></i>`;
  }

  function getApplianceGlowColor(type) {
    type = (type || "").toLowerCase();
    if (type.includes("fan") || type.includes("exhaust")) return "#a78bfa";
    if (type.includes("ac") || type.includes("air") || type.includes("conditioner") || type.includes("cool")) return "#38bdf8";
    if (type.includes("geyser") || type.includes("heater") || type.includes("boiler")) return "#f97316";
    if (type.includes("socket") || type.includes("plug") || type.includes("outlet")) return "#34d399";
    if (type.includes("motor") || type.includes("pump") || type.includes("tank")) return "#06b6d4";
    if (type.includes("tv") || type.includes("screen")) return "#c084fc";
    return "#fbbf24";
  }

  function renderWifiBars(rssi, rtt) {
    if (typeof rssi !== "number") return "";
    const lvl = rssi >= -62 ? 4 : rssi >= -72 ? 3 : rssi >= -82 ? 2 : 1;
    const lbl = lvl === 4 ? "Strong" : lvl === 3 ? "Good" : lvl === 2 ? "Fair" : "Weak";
    const rttTxt = typeof rtt === "number" ? ` • ${rtt}ms` : "";
    return `<span class="wifi-bars lvl-${lvl}" title="Wi-Fi: ${lbl} (${rssi} dBm${rttTxt})"><i></i><i></i><i></i><i></i></span>`;
  }

  function formatRemainingTimer(dev) {
    const now = Date.now();
    const swTimerEnds = dev && dev.triggers && dev.triggers.schedule && dev.triggers.schedule.timer && dev.triggers.schedule.timer.endsAt;
    const hwTimerEnds = dev && dev.hwTimerEndsAt;
    const endsAt = Math.max(swTimerEnds || 0, hwTimerEnds || 0);
    if (!endsAt || endsAt <= now) return "";
    const remSec = Math.max(1, Math.ceil((endsAt - now) / 1000));
    const m = Math.floor(remSec / 60);
    const s = remSec % 60;
    const mmss = m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s).padStart(2, "0")}`;
    return `<span class="timer-live-pill" title="Active Countdown Timer">⏳ ${mmss}</span>`;
  }

  function renderHomePulseBar() {
    const el = document.getElementById("homePulseBar");
    if (!el) return;
    const nowMs = Date.now();
    const tariff = Number(NARI.settings.tariffRate) || 7.5;
    let totalActiveW = 0;
    let totalKwhToday = 0;
    let activeRelays = 0;
    let totalRelays = 0;

    store.devices.forEach(dev => {
      const isOnline = dev.isOnline !== false;
      const isR1On = !!dev.state && isOnline;
      const isR2On = !!dev.state2 && isOnline;
      const w1 = typeof dev.relay1Watts === "number" ? dev.relay1Watts : 12;
      const w2 = typeof dev.relay2Watts === "number" ? dev.relay2Watts : 75;
      const r1Ms = (dev.runtimeMs1 || 0) + (isR1On && dev.lastOnAt1 ? Math.max(0, nowMs - dev.lastOnAt1) : 0);
      const r2Ms = (dev.runtimeMs2 || 0) + (isR2On && dev.lastOnAt2 ? Math.max(0, nowMs - dev.lastOnAt2) : 0);

      totalRelays += dev.dual ? 2 : 1;
      if (isR1On) { activeRelays++; totalActiveW += w1; }
      if (dev.dual && isR2On) { activeRelays++; totalActiveW += w2; }
      totalKwhToday += ((w1 * (r1Ms / 3600000)) + (dev.dual ? (w2 * (r2Ms / 3600000)) : 0)) / 1000;
    });

    const rsToday = totalKwhToday * tariff;
    const rsMonth = Math.round(rsToday * 30);

    el.innerHTML = `
      <div class="pulse-kpi" onclick="NARI.app.openEnergyModal()" title="View Live Appliance Load">
        <div class="pulse-kpi-icon" style="background:rgba(16,185,129,0.15);color:#10b981;">
          <i class="fa-solid fa-bolt"></i>
        </div>
        <div>
          <div class="pulse-kpi-val" id="pulseLiveWatts">${totalActiveW} W</div>
          <div class="pulse-kpi-lbl">Live Home Load</div>
        </div>
      </div>
      <div class="pulse-kpi" onclick="NARI.app.openEnergyModal()" title="Today's Energy &amp; Cost (@ ₹${tariff}/kWh)">
        <div class="pulse-kpi-icon" style="background:rgba(56,189,248,0.15);color:#38bdf8;">
          <i class="fa-solid fa-indian-rupee-sign"></i>
        </div>
        <div>
          <div class="pulse-kpi-val" id="pulseTodayCost">₹${rsToday.toFixed(2)}</div>
          <div class="pulse-kpi-lbl">${totalKwhToday.toFixed(2)} kWh Today</div>
        </div>
      </div>
      <div class="pulse-kpi" onclick="NARI.app.openEnergyModal()" title="30-Day Projected Electricity Bill">
        <div class="pulse-kpi-icon" style="background:rgba(245,158,11,0.15);color:#f59e0b;">
          <i class="fa-solid fa-chart-line"></i>
        </div>
        <div>
          <div class="pulse-kpi-val" id="pulseMonthBill">~₹${rsMonth}/mo</div>
          <div class="pulse-kpi-lbl">Est. Monthly Bill</div>
        </div>
      </div>
      <div class="pulse-kpi" onclick="NARI.app.allOff()" title="Tap to turn OFF active switches in current view">
        <div class="pulse-kpi-icon" style="background:rgba(167,139,250,0.15);color:#a78bfa;">
          <i class="fa-solid fa-power-off"></i>
        </div>
        <div>
          <div class="pulse-kpi-val" id="pulseActiveCount">${activeRelays} / ${totalRelays} ON</div>
          <div class="pulse-kpi-lbl">${activeRelays > 0 ? 'Tap for All OFF' : 'All Standby'}</div>
        </div>
      </div>
    `;
  }

  function renderScenesRibbon() {
    const el = document.getElementById("dashboardScenesBar");
    if (!el || !NARI.scenes || typeof NARI.scenes.renderDashboardBar !== "function") return;
    el.innerHTML = NARI.scenes.renderDashboardBar();
  }

  function renderRoomFilters() {
    if (!dom.roomFilterBar) return;
    const rooms = ["all"];
    store.devices.forEach(d => {
      const r = d.room || "Living Room";
      if (!rooms.includes(r)) rooms.push(r);
    });

    dom.roomFilterBar.innerHTML = rooms.map(r => {
      const isActive = currentRoomFilter === r;
      const label = r === "all" ? "All Devices" : r;
      return `<button class="room-pill ${isActive ? 'active' : ''}" onclick="NARI.app.setRoomFilter('${escHtml(r)}')">${escHtml(label)}</button>`;
    }).join("");
  }

  // --- Status Strip & Diagnostics ---
  function renderStatus() {
    const diag = transport.diagnostics();
    const hasError = diag.some(d => d.level === "error");
    dom.diagDot.classList.toggle("hidden", !hasError);

    const cState = transport.cloudState;
    const cOk = cState === "connected";

    // Update the Edge Live Connected Pill
    if (dom.cloudEdgeStatus) {
      dom.cloudEdgeStatus.className = `pill-edge ${cOk ? 'ok' : (cState === 'connecting' ? 'busy' : 'bad')}`;
    }
    if (dom.cloudEdgeText) {
      if (cOk) dom.cloudEdgeText.innerText = "Live Connected (Cloudflare Edge)";
      else if (cState === "connecting") dom.cloudEdgeText.innerText = "Connecting to Edge...";
      else dom.cloudEdgeText.innerText = "Cloud Reconnecting...";
    }

    let html = "";
    html += `<div class="pill ${cOk ? 'ok' : (cState === 'connecting' ? 'busy' : 'bad')}">
      <span class="led"></span>Cloud: ${cState}
    </div>`;

    if (transport.lanBlocked) {
      html += `<div class="pill warn" style="cursor:pointer;" onclick="NARI.app.showLanUnlockModal()" title="Click to see how to enable fast LAN"><span class="led"></span>LAN: Mixed Content Blocked <i class="fa-solid fa-circle-question" style="margin-left:4px;font-size:0.7rem;"></i></div>`;
    } else {
      const lanCount = store.devices.filter(d => transport.lanFresh(d) || d.link === 'lan-grace').length;
      html += `<div class="pill ${lanCount > 0 ? 'ok' : ''}"><span class="led"></span>LAN: ${lanCount} Active</div>`;
    }

    dom.statusStrip.innerHTML = html;
  }

  // --- Device Node Card Rendering (Vibrant Cosmic / Neon Cyan Design) ---
  function renderDeviceCards() {
    renderRoomFilters();
    renderHomePulseBar();
    renderScenesRibbon();

    const filtered = currentRoomFilter === "all"
      ? store.devices
      : store.devices.filter(d => (d.room || "Living Room").toLowerCase() === currentRoomFilter.toLowerCase());

    if (!filtered.length) {
      dom.deviceList.innerHTML = `
        <div class="empty">
          <div class="big"><i class="fa-solid fa-house-signal"></i></div>
          <h3>Welcome to NARI Smart Home</h3>
          <p class="small muted" style="margin-bottom:18px;">Get your smart switch up and running in 3 easy steps.</p>
          <div class="btn-row" style="max-width:320px;margin:0 auto 20px;">
            <button class="btn primary sm" onclick="NARI.app.loadShowcaseDemo()"><i class="fa-solid fa-wand-magic-sparkles"></i> Load Showcase Demo</button>
          </div>
          <div class="welcome-guide">
            <div class="wstep">
              <span class="wnum">1</span>
              <div>
                <b>Power ON the NARI Switch</b>
                <p>The device creates a Wi-Fi hotspot called <code>NARI-XXXX</code></p>
              </div>
            </div>
            <div class="wstep">
              <span class="wnum">2</span>
              <div>
                <b>Connect &amp; Setup Opens Automatically</b>
                <p>Open phone <b>Wi-Fi Settings</b> &rarr; tap <code>NARI-XXXX</code> (No password needed).</p>
                <p>The Wi-Fi credentials page opens automatically! Select your home Wi-Fi &rarr; enter password &rarr; tap Save.</p>
              </div>
            </div>
            <div class="wstep">
              <span class="wnum">3</span>
              <div>
                <b>Tap <i class="fa-solid fa-plus"></i> to Scan &amp; Add</b>
                <p>Reconnect your phone to home Wi-Fi, then tap the <b>+</b> button above to find and add your switch.</p>
              </div>
            </div>
          </div>
        </div>`;
      return;
    }

    dom.deviceList.innerHTML = filtered.map(dev => {
      const i = store.devices.indexOf(dev);
      const isOnline = dev.isOnline !== false;
      const isR1On = !!dev.state && isOnline;
      const isR2On = !!dev.state2 && isOnline;
      const safeName = (dev.name && !/^https?:\/\//.test(dev.name))
        ? dev.name.replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))
        : 'Smart Node';
      const activeTriggers = Object.keys(dev.triggers || {}).filter(k => dev.triggers[k].enabled);
      const roomLabel = (dev.room || 'LIVING ROOM').toUpperCase();
      const nowMs = Date.now();
      const tariff = Number(NARI.settings.tariffRate) || 7.5;
      const r1Ms = (dev.runtimeMs1 || 0) + (isR1On && dev.lastOnAt1 ? Math.max(0, nowMs - dev.lastOnAt1) : 0);
      const r2Ms = (dev.runtimeMs2 || 0) + (isR2On && dev.lastOnAt2 ? Math.max(0, nowMs - dev.lastOnAt2) : 0);
      const w1 = typeof dev.relay1Watts === 'number' ? dev.relay1Watts : 12;
      const w2 = typeof dev.relay2Watts === 'number' ? dev.relay2Watts : 75;
      const activeWatts = (isR1On ? w1 : 0) + (dev.dual && isR2On ? w2 : 0);
      const kwhToday = ((w1 * (r1Ms / 3600000)) + (dev.dual ? (w2 * (r2Ms / 3600000)) : 0)) / 1000;
      const rsToday = (kwhToday * tariff).toFixed(2);
      const glow1 = getApplianceGlowColor(dev.relay1Icon || dev.relay1Name);
      const glow2 = getApplianceGlowColor(dev.relay2Icon || dev.relay2Name);
      const timerPillHtml = formatRemainingTimer(dev);
      const safeBg = dev.bgPhoto && /^https?:\/\//i.test(dev.bgPhoto) ? dev.bgPhoto.replace(/["'()\\]/g, "") : "";
      const bgStyle = safeBg ? `style="background-image: linear-gradient(180deg, rgba(7,13,24,0.48) 0%, rgba(7,13,24,0.82) 100%), url('${safeBg}');"` : "";
      const subContext = dev._lastActor
        ? `Last: ${escHtml(dev._lastActor.source || 'app')} • ${escHtml(dev._lastActor.user || 'Owner')}`
        : `ID: <span class="mono">${escHtml(dev.id || 'a40a')}</span>${dev.fw ? ` • v${escHtml(dev.fw)}` : ''}`;

      return `
        <div class="node-card ${!isOnline ? 'offline' : ''} ${safeBg ? 'has-bg' : ''}" id="dev-${i}" ${bgStyle}>
          <div class="node-header">
            <div class="node-title-group">
              <h3 class="node-title">${safeName}</h3>
              <div class="node-sub">${subContext}</div>
            </div>
            <div class="node-meta">
              <span class="room-badge">${escHtml(roomLabel)}</span>
              <button class="node-menu-btn" onclick="event.stopPropagation(); NARI.app.openIrRemoteModal(${i})" title="Universal IR Remote (AC &amp; TV)">
                <i class="fa-solid fa-gamepad" style="color:#38bdf8;"></i>
              </button>
              <button class="node-menu-btn" onclick="event.stopPropagation(); NARI.app.openSettingsModal(${i})" title="Device Settings &amp; Hardware Config">
                <i class="fa-solid fa-gear"></i>
              </button>
            </div>
          </div>

          <div class="relay-grid ${dev.dual ? 'dual' : 'single'}">
            <!-- Relay 1 Control Tile -->
            <div class="relay-tile ${isR1On ? 'active' : ''} ${!isOnline ? 'offline' : ''}"
                 style="--tile-glow:${glow1};"
                 onclick="NARI.app.toggleRelay(${i}, 1)"
                 oncontextmenu="event.preventDefault(); NARI.app.openSettingsModal(${i});">
              <div class="tile-icon-box">
                ${getApplianceIcon(dev.relay1Icon || dev.relay1Name, isR1On)}
              </div>
              <div class="tile-name">${escHtml(dev.relay1Name || 'Relay 1')}</div>
              <div class="tile-status ${isR1On ? 'on' : 'off'}">
                ${!isOnline ? 'Offline' : (isR1On ? `ON • ${w1}W` : 'Off')}
              </div>
            </div>

            <!-- Relay 2 Control Tile -->
            ${dev.dual ? `
            <div class="relay-tile ${isR2On ? 'active' : ''} ${!isOnline ? 'offline' : ''}"
                 style="--tile-glow:${glow2};"
                 onclick="NARI.app.toggleRelay(${i}, 2)"
                 oncontextmenu="event.preventDefault(); NARI.app.openSettingsModal(${i});">
              <div class="tile-icon-box">
                ${getApplianceIcon(dev.relay2Icon || dev.relay2Name, isR2On)}
              </div>
              <div class="tile-name">${escHtml(dev.relay2Name || 'Relay 2')}</div>
              <div class="tile-status ${isR2On ? 'on' : 'off'}">
                ${!isOnline ? 'Offline' : (isR2On ? `ON • ${w2}W` : 'Off')}
              </div>
            </div>` : ''}
          </div>

          <div class="node-footer">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <button class="trigger-pill" onclick="event.stopPropagation(); NARI.app.openTriggerModal(${i})">
                <i class="fa-solid fa-bolt" style="color:#f59e0b;"></i> Automations
                ${activeTriggers.length ? `<span class="count">${activeTriggers.length}</span>` : ''}
              </button>
              <button class="trigger-pill" onclick="event.stopPropagation(); NARI.app.openTriggerModal(${i}, 'schedule')" title="1-Tap Quick Countdown Timer &amp; Schedule">
                <i class="fa-solid fa-clock" style="color:var(--accent);"></i> Timer
              </button>
              <span class="timer-slot" id="timer-slot-${i}">${timerPillHtml}</span>
            </div>
            <span class="energy-pill small muted" style="font-size:0.7rem;display:inline-flex;align-items:center;gap:4px;cursor:pointer;" onclick="event.stopPropagation(); NARI.app.openEnergyModal()" title="Software Energy &amp; Bill Tracker (est. @ ₹${tariff}/kWh)">
              <i class="fa-solid fa-plug-circle-bolt" style="color:${activeWatts > 0 ? 'var(--success)' : 'var(--text-muted)'};"></i>
              <span class="energy-text">${activeWatts}W • ₹${rsToday}</span>
              ${dev.autoOffSec > 0 ? `<span style="color:var(--warn);margin-left:3px;" title="Hardware Inching Auto-Off">⏱${dev.autoOffSec}s</span>` : ''}
              ${dev.wallSwitchLock ? `<i class="fa-solid fa-lock" style="color:var(--warn);margin-left:3px;" title="Wall Switch Child Lock Active"></i>` : ''}
            </span>
            <div class="link-info">
              ${(() => {
                const isOnline = dev.isOnline !== false;
                if (!isOnline) return '<span class="link-tag none">Offline</span>';
                const link = dev.link || (transport.lanFresh(dev) ? 'lan' : (transport.cloudConnected ? 'cloud' : 'none'));
                if (link === 'lan' || link === 'lan-grace') return '<span class="link-tag lan">LAN</span>';
                if (link === 'cloud' || link === 'cloud-unverified') return '<span class="link-tag cloud">Cloud</span>';
                return '<span class="link-tag none">Offline</span>';
              })()}
              ${renderWifiBars(dev.lanRssi, dev.rtt)}
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  // Surgical in-place card updater: updates only the specific tiles without destroying the DOM,
  // preventing all CSS reflows, re-render flashes, and toggle flickering.
  function updateDeviceCardInPlace(i) {
    const dev = store.devices[i];
    if (!dev) return;
    const cardEl = document.getElementById(`dev-${i}`);
    if (!cardEl) {
      renderDeviceCards();
      return;
    }
    const isOnline = dev.isOnline !== false;
    const isR1On = !!dev.state && isOnline;
    const isR2On = !!dev.state2 && isOnline;

    cardEl.classList.toggle("offline", !isOnline);

    const w1 = typeof dev.relay1Watts === 'number' ? dev.relay1Watts : 12;
    const w2 = typeof dev.relay2Watts === 'number' ? dev.relay2Watts : 75;
    const tiles = cardEl.querySelectorAll(".relay-tile");
    if (tiles[0]) {
      tiles[0].className = `relay-tile ${isR1On ? 'active' : ''} ${!isOnline ? 'offline' : ''}`;
      const iconBox = tiles[0].querySelector(".tile-icon-box");
      if (iconBox) iconBox.innerHTML = getApplianceIcon(dev.relay1Icon || dev.relay1Name, isR1On);
      const statusEl = tiles[0].querySelector(".tile-status");
      if (statusEl) {
        statusEl.className = `tile-status ${isR1On ? 'on' : 'off'}`;
        statusEl.textContent = !isOnline ? 'Offline' : (isR1On ? `ON • ${w1}W` : 'Off');
      }
    }

    if (dev.dual && tiles[1]) {
      tiles[1].className = `relay-tile ${isR2On ? 'active' : ''} ${!isOnline ? 'offline' : ''}`;
      const iconBox2 = tiles[1].querySelector(".tile-icon-box");
      if (iconBox2) iconBox2.innerHTML = getApplianceIcon(dev.relay2Icon || dev.relay2Name, isR2On);
      const statusEl2 = tiles[1].querySelector(".tile-status");
      if (statusEl2) {
        statusEl2.className = `tile-status ${isR2On ? 'on' : 'off'}`;
        statusEl2.textContent = !isOnline ? 'Offline' : (isR2On ? `ON • ${w2}W` : 'Off');
      }
    }

    const linkInfo = cardEl.querySelector(".link-info");
    if (linkInfo) {
      let tagHtml = '<span class="link-tag none">Offline</span>';
      if (isOnline) {
        const link = dev.link || (transport.lanFresh(dev) ? 'lan' : (transport.cloudConnected ? 'cloud' : 'none'));
        if (link === 'lan' || link === 'lan-grace') tagHtml = '<span class="link-tag lan">LAN</span>';
        else if (link === 'cloud' || link === 'cloud-unverified') tagHtml = '<span class="link-tag cloud">Cloud</span>';
      }
      linkInfo.innerHTML = tagHtml + renderWifiBars(dev.lanRssi, dev.rtt);
    }

    const timerSlot = cardEl.querySelector(`#timer-slot-${i}`);
    if (timerSlot) timerSlot.innerHTML = formatRemainingTimer(dev);

    const energyEl = cardEl.querySelector(".energy-text");
    if (energyEl) {
      const nowMs = Date.now();
      const tariff = Number(NARI.settings.tariffRate) || 7.5;
      const r1Ms = (dev.runtimeMs1 || 0) + (isR1On && dev.lastOnAt1 ? Math.max(0, nowMs - dev.lastOnAt1) : 0);
      const r2Ms = (dev.runtimeMs2 || 0) + (isR2On && dev.lastOnAt2 ? Math.max(0, nowMs - dev.lastOnAt2) : 0);
      const activeWatts = (isR1On ? w1 : 0) + (dev.dual && isR2On ? w2 : 0);
      const kwhToday = ((w1 * (r1Ms / 3600000)) + (dev.dual ? (w2 * (r2Ms / 3600000)) : 0)) / 1000;
      const rsToday = (kwhToday * tariff).toFixed(2);
      energyEl.textContent = `${activeWatts}W • ₹${rsToday}`;
    }
    renderHomePulseBar();
  }

  // --- Modal Sheets Controller ---
  function openSheet(contentHtml) {
    dom.sheet.innerHTML = `<div class="sheet-handle"></div>` + contentHtml;
    dom.overlay.classList.add("show");
  }

  function closeSheet() {
    if (audioTrainingCtrl) {
      audioTrainingCtrl.cancel();
      audioTrainingCtrl = null;
    }
    dom.overlay.classList.remove("show");
    dom.sheet.innerHTML = "";
  }

  dom.overlay.onclick = e => {
    if (e.target === dom.overlay) closeSheet();
  };

  NARI.openSheet = openSheet;
  NARI.closeSheet = closeSheet;
  let currentTriggerTab = "clap";
  function formatDays(days) {
    if (!days || !days.length || days.length === 7) return "Every day";
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    if (days.length === 5 && !days.includes(0) && !days.includes(6)) return "Weekdays (Mon-Fri)";
    if (days.length === 2 && days.includes(0) && days.includes(6)) return "Weekends (Sat-Sun)";
    return days.map(d => names[d]).join(", ");
  }

  // Real-time voice monitor hook + Floating Dashboard Voice Pill
  let voicePillTimer = null;
  bus.on("voice:heard", e => {
    const el = document.getElementById("voiceHeardText");
    if (el && e && e.text) el.innerText = `"${e.text}"`;
    const pill = document.getElementById("voiceLivePill");
    const pillTxt = document.getElementById("voiceLivePillText");
    if (pill && pillTxt && e && e.text) {
      pill.classList.remove("hidden");
      pillTxt.textContent = `🎙️ "${e.text}"`;
      clearTimeout(voicePillTimer);
      voicePillTimer = setTimeout(() => {
        const anyVoice = store.devices.some(d => d.triggers && d.triggers.voice && d.triggers.voice.enabled);
        if (!anyVoice) pill.classList.add("hidden");
        else pillTxt.textContent = "Listening (EN / తెలుగు)...";
      }, 3200);
    }
  });
  bus.on("sensors:status", st => {
    const pill = document.getElementById("voiceLivePill");
    if (!pill) return;
    if (st && st.voice === "active") pill.classList.remove("hidden");
    else pill.classList.add("hidden");
  });

  // --- Exposed App Methods ---
  NARI.app = {
    closeSheet,
    openSheet,
    renderDeviceCards,
    showToast,

    async toggleRelay(index, relayNum = 1) {
      const dev = store.devices[index];
      if (!dev) return;
      const lockKey = `_lock_r${relayNum}`;
      if (dev[lockKey]) return; // micro-debounce (100ms) to suppress hardware touchscreen bounce
      dev[lockKey] = true;
      setTimeout(() => { delete dev[lockKey]; }, 100);

      const target = relayNum === 2 ? !dev.state2 : !dev.state;
      await transport.setState(index, target, { relay: relayNum });
    },

    setRoomFilter(room) {
      currentRoomFilter = room;
      renderDeviceCards();
    },

    async allOn() {
      await transport.allOn();
      showToast("All appliances turned ON", "ok");
    },

    async allOff() {
      await transport.allOff();
      showToast("All appliances turned OFF", "info");
    },

    loadShowcaseDemo() {
      store.devices = [
        {
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
        }
      ].map(store.migrateDevice ? store.migrateDevice : (d => d));
      store.save();
      currentRoomFilter = "all";
      renderDeviceCards();
      showToast("✨ Smart card restored!", "ok");
    },

    openSettingsModal(index) {
      const dev = store.devices[index];
      const defaultRooms = ["Living Room", "Master Bedroom", "Bedroom", "Kitchen", "Hall", "Dining", "Balcony", "Bathroom", "Pooja Room", "Garden / Outdoor"];
      const allRooms = Array.from(new Set([...defaultRooms, ...store.devices.map(d => d.room).filter(Boolean)]));
      const isPub = NARI.sharing && NARI.sharing.isPublicSwitch && NARI.sharing.isPublicSwitch(dev);
      const members = (NARI.sharing && NARI.sharing.data && NARI.sharing.data.members) || [];
      const admins = (NARI.sharing && NARI.sharing.data && NARI.sharing.data.admins) || [];
      const allPeople = [...admins, ...members];

      openSheet(`
        <div class="sheet-header">
          <div>${escHtml(dev.name)}<span class="sub">${dev.id || dev.ip || 'Device Config'}</span></div>
          <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
        </div>
        <div class="form-group">
          <label>Device / Appliance Node Name</label>
          <input type="text" id="devName" value="${escHtml(dev.name)}">
        </div>
        <div class="form-group">
          <label>Assigned Room</label>
          <input type="text" id="devRoom" value="${escHtml(dev.room || 'Living Room')}" placeholder="e.g. Living Room, Bedroom, Kitchen">
          <div class="room-chip-grid" id="editRoomChips">
            ${allRooms.map(rm => `
              <div class="room-select-chip ${(dev.room || 'Living Room').toLowerCase() === rm.toLowerCase() ? 'active' : ''}"
                   onclick="document.getElementById('devRoom').value='${escHtml(rm)}';document.querySelectorAll('#editRoomChips .room-select-chip').forEach(c=>c.classList.toggle('active',c.textContent.trim().toLowerCase()==='${rm.toLowerCase()}'))">
                ${escHtml(rm)}
              </div>
            `).join("")}
          </div>
        </div>
        <div class="form-group" style="display:grid;grid-template-columns:2fr 1fr;gap:8px;">
          <div>
            <label>Relay 1 Label</label>
            <input type="text" id="devRelay1" value="${escHtml(dev.relay1Name || 'Ceiling Light')}">
          </div>
          <div>
            <label>Wattage (W)</label>
            <input type="number" id="devRelay1Watts" min="0" max="5000" value="${typeof dev.relay1Watts === 'number' ? dev.relay1Watts : 12}">
          </div>
        </div>
        <div class="form-group" style="display:grid;grid-template-columns:2fr 1fr;gap:8px;">
          <div>
            <label>Relay 2 Label (Dual Switch)</label>
            <input type="text" id="devRelay2" value="${escHtml(dev.relay2Name || 'Ceiling Fan')}">
          </div>
          <div>
            <label>Wattage (W)</label>
            <input type="number" id="devRelay2Watts" min="0" max="5000" value="${typeof dev.relay2Watts === 'number' ? dev.relay2Watts : 75}">
          </div>
        </div>

        <div class="form-group" style="margin-bottom:14px;background:rgba(255,255,255,0.02);padding:10px;border-radius:10px;border:1px solid var(--card-border);">
          <label style="font-weight:700;display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <i class="fa-solid fa-shield-halved" style="color:var(--success);"></i> Family Supervision Role
          </label>
          <div style="display:flex;gap:12px;margin-bottom:8px;">
            <label style="display:flex;align-items:center;gap:5px;font-size:0.8rem;cursor:pointer;">
              <input type="radio" name="editDevRole" value="public" ${isPub ? 'checked' : ''} style="accent-color:var(--primary);">
              <span>🌐 Public (Family Shared)</span>
            </label>
            <label style="display:flex;align-items:center;gap:5px;font-size:0.8rem;cursor:pointer;">
              <input type="radio" name="editDevRole" value="private" ${!isPub ? 'checked' : ''} style="accent-color:var(--primary);">
              <span>🔒 Private (Admin Only)</span>
            </label>
          </div>
          <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:3px;">Assigned Member:</label>
          <select id="editDevAssigned" style="width:100%;padding:6px 8px;font-size:0.78rem;background:rgba(255,255,255,0.06);border:1px solid var(--card-border);border-radius:6px;color:var(--text);">
            <option value="">General Household (All Members)</option>
            ${allPeople.map(p => `
              <option value="${escHtml(p.email || p.name)}" ${(dev.assignedTo === (p.email || p.name)) ? 'selected' : ''}>
                ${escHtml(p.name)} (${escHtml(p.role || 'Member')})
              </option>
            `).join("")}
          </select>
        </div>

        <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div>
            <label title="Hardware Inching: Automatically turns OFF after N seconds even if Wi-Fi drops or toggled from the wall switch (ideal for geysers &amp; water motors)">Hardware Auto-Off Inching (sec)</label>
            <input type="number" id="devAutoOffSec" min="0" max="43200" value="${dev.autoOffSec || 0}" placeholder="0 = disabled (e.g. 900 = 15m)">
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px;">
              ${[{l:'Off',v:0},{l:'5m',v:300},{l:'15m',v:900},{l:'30m',v:1800},{l:'1h',v:3600}].map(p => `
                <span class="suggestion-chip" onclick="document.getElementById('devAutoOffSec').value=${p.v}">${p.l}</span>
              `).join('')}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;justify-content:center;padding-top:10px;">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.8rem;">
              <input type="checkbox" id="devWallLock" ${dev.wallSwitchLock ? 'checked' : ''} style="accent-color:var(--primary);width:16px;height:16px;">
              <span>🔒 Lock Physical Wall Switch (Child Lock)</span>
            </label>
          </div>
        </div>

        <details style="margin-bottom:12px;">
          <summary><i class="fa-solid fa-sliders"></i> Advanced Hardware, Network &amp; Firmware</summary>
          <div style="margin-top:10px;">
            <div class="form-group">
              <label>Hardware Node ID (from Wi-Fi Hotspot NARI-XXXX or Sticker)</label>
              <input type="text" id="devNodeId" value="${escHtml(dev.id || 'a40a')}" placeholder="e.g. a40a" style="font-family:var(--mono);">
            </div>
            <div class="form-group">
              <label>Device IP Address (Auto-heals via MQTT)</label>
              <input type="text" id="devIp" value="${escHtml(dev.ip || '')}" placeholder="e.g. 192.168.1.105">
            </div>
            <div class="form-group">
              <label>Boot State (On Power Restore)</label>
              <select id="bootState">
                <option value="LAST" ${dev.bootState === 'LAST' ? 'selected' : ''}>LAST STATE (Resume)</option>
                <option value="OFF" ${dev.bootState === 'OFF' ? 'selected' : ''}>OFF (Always Start Off)</option>
                <option value="ON" ${dev.bootState === 'ON' ? 'selected' : ''}>ON (Always Start On)</option>
              </select>
            </div>
            <div class="form-group">
              <label>Card Background Photo URL</label>
              <input type="url" id="bgPhotoUrl" value="${escHtml(dev.bgPhoto || '')}" placeholder="https://...">
            </div>
            <div class="ota-box" id="otaBox">
              <div class="ota-header">
                <div class="ota-title"><i class="fa-solid fa-microchip"></i> Device Firmware</div>
                <span class="ota-ver-tag" id="otaCurrentVer">v${dev.fw || "1.2.4"}</span>
              </div>
              <div id="otaContent">
                <button class="btn secondary sm" style="width:100%;" id="btnCheckUpdate" onclick="NARI.app.checkFirmwareUpdate(${index})">
                  <i class="fa-solid fa-arrows-rotate"></i> Check for Updates
                </button>
              </div>
            </div>
          </div>
        </details>
        <div class="btn-row" style="margin-top:14px;">
          <button class="btn primary" onclick="NARI.app.saveDeviceSettings(${index})">Save</button>
          ${(NARI.sharing && NARI.sharing.canDeleteSwitch && !NARI.sharing.canDeleteSwitch(dev))
            ? '<span class="small muted" style="padding:6px 12px;background:rgba(255,255,255,0.04);border-radius:8px;display:flex;align-items:center;gap:5px;"><i class="fa-solid fa-lock" style="color:var(--warn);"></i> Admin Delete Only</span>'
            : `<button class="btn danger" onclick="NARI.app.deleteDevice(${index})">Delete</button>`
          }
        </div>
      `);
    },

    checkFirmwareUpdate: async (index) => {
      const dev = store.devices[index];
      const container = document.getElementById("otaContent");
      if (!container) return;
      container.innerHTML = `<div style="text-align:center;padding:8px 0;font-size:0.75rem;color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Checking for updates...</div>`;

      try {
        const res = await fetch("./firmware/version.json?_t=" + Date.now(), { cache: "no-store" });
        if (!res.ok) throw new Error("Could not check update manifest");
        const info = await res.json();
        if (!isValidOtaUrl(info.binUrl)) throw new Error("Update manifest has an invalid firmware URL");
        const currentVer = dev.fw || "1.0.0";
        const hasUpdate = info.version && compareVersions(info.version, currentVer) > 0;

        if (!hasUpdate) {
          container.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;">
              <span style="font-size:0.75rem;color:var(--success);font-weight:700;"><i class="fa-solid fa-circle-check"></i> Firmware is up to date</span>
              <button class="btn secondary sm" style="padding:4px 10px;font-size:0.7rem;" onclick="NARI.app.checkFirmwareUpdate(${index})">Recheck</button>
            </div>
          `;
          return;
        }

        pendingOtaInfo = { binUrl: info.binUrl, version: String(info.version) };
        container.innerHTML = `
          <div class="ota-badge"><span class="dot"></span> Update Available: v${escHtml(info.version)}</div>
          <div class="ota-notes"><b>${escHtml(info.title || "What's New")}:</b><br>${escHtml(info.notes || "Bug fixes and performance improvements.")}</div>
          <button class="btn primary sm" style="width:100%;" id="btnStartOta" onclick="NARI.app.startFirmwareUpdate(${index})">
            <i class="fa-solid fa-cloud-arrow-down"></i> Download &amp; Update Now
          </button>
        `;
      } catch (e) {
        container.innerHTML = `
          <div class="small" style="color:var(--warn);margin-bottom:6px;"><i class="fa-solid fa-triangle-exclamation"></i> ${escHtml(e.message || "Could not reach update server.")}</div>
          <button class="btn secondary sm" style="width:100%;" onclick="NARI.app.checkFirmwareUpdate(${index})">Try Again</button>
        `;
      }
    },

    startFirmwareUpdate: async (index) => {
      const dev = store.devices[index];
      const container = document.getElementById("otaContent");
      if (!container || !dev || !pendingOtaInfo) return;
      const { binUrl, version: targetVersion } = pendingOtaInfo;

      container.innerHTML = `
        <div class="ota-progress-wrap">
          <div class="ota-progress-bar"><div class="ota-progress-fill" id="otaFill"></div></div>
          <div class="ota-progress-meta">
            <span id="otaStatusText">Sending update command...</span>
            <span id="otaPctText">0%</span>
          </div>
        </div>
        <div class="small muted" style="text-align:center;margin-top:6px;font-size:0.7rem;">
          Keep the switch powered ON. Device will reboot automatically.
        </div>
      `;

      endOtaSession();
      const accepted = await transport.triggerOta(dev, binUrl);
      if (!accepted) { otaFail(index, "Device is unreachable (no LAN or cloud connection)."); return; }

      otaSetProgress(0, "Device is downloading firmware...");
      otaSession = {
        index,
        targetVersion,
        stallTimer: setTimeout(() => otaFail(index, "Device stopped responding."), 90000),
        totalTimer: setTimeout(() => otaFail(index, "Timed out waiting for the device to come back on the new version."), 180000)
      };
    },

    saveDeviceSettings(index) {
      const dev = store.devices[index];
      dev.name = document.getElementById("devName").value.trim() || dev.name;
      const roomInput = document.getElementById("devRoom");
      if (roomInput) dev.room = roomInput.value.trim() || "Living Room";
      const r1Input = document.getElementById("devRelay1");
      if (r1Input) dev.relay1Name = r1Input.value.trim() || "Switch 1";
      const r2Input = document.getElementById("devRelay2");
      if (r2Input) dev.relay2Name = r2Input.value.trim() || "Switch 2";
      const r1W = document.getElementById("devRelay1Watts");
      if (r1W) dev.relay1Watts = Math.max(0, Number(r1W.value) || 0);
      const r2W = document.getElementById("devRelay2Watts");
      if (r2W) dev.relay2Watts = Math.max(0, Number(r2W.value) || 0);
      const autoOffEl = document.getElementById("devAutoOffSec");
      if (autoOffEl) dev.autoOffSec = Math.max(0, Math.min(65000, Math.round(Number(autoOffEl.value) || 0)));
      const wallLockEl = document.getElementById("devWallLock");
      if (wallLockEl) dev.wallSwitchLock = !!wallLockEl.checked;
      const ipInput = document.getElementById("devIp");
      if (ipInput) dev.ip = ipInput.value.trim();
      const nodeIdInput = document.getElementById("devNodeId");
      if (nodeIdInput && nodeIdInput.value.trim()) {
        const newId = nodeIdInput.value.trim().toLowerCase();
        if (newId !== dev.id) {
          dev.id = newId;
          if (transport.subscribeId) transport.subscribeId(newId);
        }
      }
      const editRole = document.querySelector('input[name="editDevRole"]:checked');
      if (editRole && NARI.sharing && NARI.sharing.setSwitchPublic) {
        NARI.sharing.setSwitchPublic(dev.id || dev.ip, editRole.value === "public");
        dev.accessRole = editRole.value;
      }
      const editAssigned = document.getElementById("editDevAssigned");
      if (editAssigned) dev.assignedTo = editAssigned.value || null;

      dev.bootState = document.getElementById("bootState").value;
      dev.bgPhoto = document.getElementById("bgPhotoUrl").value.trim() || null;
      transport.setBootState(dev, dev.bootState, { autoOffSec: dev.autoOffSec, wallSwitchLock: dev.wallSwitchLock });
      store.save();
      renderRoomFilters();
      renderDeviceCards();
      transport.pollAll();
      closeSheet();
      showToast("Device settings saved!", "ok");
    },

    deleteDevice(index) {
      const dev = store.devices[index];
      if (NARI.sharing && NARI.sharing.canDeleteSwitch && !NARI.sharing.canDeleteSwitch(dev)) {
        return showToast("Only Home Admin can delete this switch", "warn");
      }
      if (confirm(`Remove "${dev.name}"?`)) {
        store.remove(index);
        closeSheet();
        showToast("Device deleted", "ok");
      }
    },

    openNewDeviceModal(prefill = {}) {
      const defaultRooms = ["Living Room", "Master Bedroom", "Bedroom", "Kitchen", "Hall", "Dining", "Balcony", "Bathroom", "Pooja Room", "Garden / Outdoor"];
      const allRooms = Array.from(new Set([...defaultRooms, ...store.devices.map(d => d.room).filter(Boolean)]));

      const defaultName = prefill.name || (prefill.id ? `Switch ${prefill.id}` : `Switch ${store.devices.length + 1}`);
      const defaultRoom = prefill.room || "Living Room";
      const defaultId = (prefill.id || "").toLowerCase();
      const defaultIp = prefill.ip || "";
      const isDual = prefill.dual !== undefined ? !!prefill.dual : true;
      const r1Name = prefill.relay1Name || "Ceiling Light";
      const r2Name = prefill.relay2Name || "Ceiling Fan";
      const r1Icon = prefill.relay1Icon || "bulb";
      const r2Icon = prefill.relay2Icon || "fan";
      const isPublic = prefill.isPublic !== undefined ? !!prefill.isPublic : true;
      const assignedTo = prefill.assignedTo || "";

      const members = (NARI.sharing && NARI.sharing.data && NARI.sharing.data.members) || [];
      const admins = (NARI.sharing && NARI.sharing.data && NARI.sharing.data.admins) || [];
      const allPeople = [...admins, ...members];

      openSheet(`
        <div class="sheet-header">
          <div style="display:flex;align-items:center;gap:8px;">
            <i class="fa-solid fa-wand-magic-sparkles" style="color:var(--primary);font-size:1.15rem;"></i>
            <div>Add Smart Card<span class="sub">Name, Room &amp; Family Supervision</span></div>
          </div>
          <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
        </div>

        <div class="form-group" style="margin-bottom:14px;">
          <label style="font-weight:700;"><i class="fa-solid fa-tag" style="color:var(--accent);"></i> Smart Card Name</label>
          <input type="text" id="newDevName" value="${escHtml(defaultName)}" placeholder="e.g. Living Room Light &amp; Fan">
          <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;">
            <span class="suggestion-chip" onclick="NARI.app.applyNameSuggestion('Living Room Light &amp; Fan')">Living Room Light &amp; Fan</span>
            <span class="suggestion-chip" onclick="NARI.app.applyNameSuggestion('Master Bedroom Switch')">Master Bedroom Switch</span>
            <span class="suggestion-chip" onclick="NARI.app.applyNameSuggestion('Kitchen Exhaust &amp; Light')">Kitchen Exhaust &amp; Light</span>
            <span class="suggestion-chip" onclick="NARI.app.applyNameSuggestion('Hall Chandelier')">Hall Chandelier</span>
            <span class="suggestion-chip" onclick="NARI.app.applyNameSuggestion('Balcony Light')">Balcony Light</span>
            <span class="suggestion-chip" onclick="NARI.app.applyNameSuggestion('Garden Floodlight')">Garden Floodlight</span>
          </div>
        </div>

        <div class="form-group" style="margin-bottom:14px;">
          <label style="font-weight:700;"><i class="fa-solid fa-door-open" style="color:#a78bfa;"></i> Select or Allocate Room</label>
          <input type="text" id="newDevRoom" value="${escHtml(defaultRoom)}" placeholder="Type custom room name or tap below">
          <div class="room-chip-grid" id="newRoomChips">
            ${allRooms.map(rm => `
              <div class="room-select-chip ${rm.toLowerCase() === defaultRoom.toLowerCase() ? 'active' : ''}"
                   onclick="NARI.app.selectNewDevRoom('${escHtml(rm)}')">
                ${escHtml(rm)}
              </div>
            `).join("")}
          </div>
        </div>

        <div class="form-group" style="margin-bottom:14px;background:rgba(255,255,255,0.02);padding:12px;border-radius:12px;border:1px solid var(--card-border);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <label style="margin:0;font-weight:700;display:flex;align-items:center;gap:6px;">
              <i class="fa-solid fa-toggle-on" style="color:#38bdf8;"></i> Dual-Relay Switch
            </label>
            <input type="checkbox" id="newDevDual" ${isDual ? 'checked' : ''}
                   style="width:18px;height:18px;accent-color:var(--primary);cursor:pointer;"
                   onchange="NARI.app.toggleNewDevDual(this.checked)">
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:4px;">Relay 1 Appliance</label>
              <input type="text" id="newDevRelay1" value="${escHtml(r1Name)}" placeholder="e.g. Ceiling Light" style="font-size:0.8rem;padding:8px 10px;">
              <select id="newDevRelay1Icon" style="margin-top:5px;font-size:0.75rem;padding:6px 8px;width:100%;background:rgba(255,255,255,0.06);border:1px solid var(--card-border);border-radius:8px;color:var(--text);">
                <option value="bulb" ${r1Icon==='bulb'?'selected':''}>💡 Bulb / Light</option>
                <option value="fan" ${r1Icon==='fan'?'selected':''}>🌀 Fan / Exhaust</option>
                <option value="ac" ${r1Icon==='ac'?'selected':''}>❄️ AC / Cooler</option>
                <option value="lamp" ${r1Icon==='lamp'?'selected':''}>⚡ Lamp / Plug</option>
                <option value="tv" ${r1Icon==='tv'?'selected':''}>📺 TV / Screen</option>
                <option value="socket" ${r1Icon==='socket'?'selected':''}>🔌 Socket / Geyser</option>
              </select>
            </div>
            <div id="newDevRelay2Box" style="${isDual ? '' : 'display:none;'}">
              <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:4px;">Relay 2 Appliance</label>
              <input type="text" id="newDevRelay2" value="${escHtml(r2Name)}" placeholder="e.g. Ceiling Fan" style="font-size:0.8rem;padding:8px 10px;">
              <select id="newDevRelay2Icon" style="margin-top:5px;font-size:0.75rem;padding:6px 8px;width:100%;background:rgba(255,255,255,0.06);border:1px solid var(--card-border);border-radius:8px;color:var(--text);">
                <option value="fan" ${r2Icon==='fan'?'selected':''}>🌀 Fan / Exhaust</option>
                <option value="bulb" ${r2Icon==='bulb'?'selected':''}>💡 Bulb / Light</option>
                <option value="ac" ${r2Icon==='ac'?'selected':''}>❄️ AC / Cooler</option>
                <option value="lamp" ${r2Icon==='lamp'?'selected':''}>⚡ Lamp / Plug</option>
                <option value="tv" ${r2Icon==='tv'?'selected':''}>📺 TV / Screen</option>
                <option value="socket" ${r2Icon==='socket'?'selected':''}>🔌 Socket / Geyser</option>
              </select>
            </div>
          </div>
        </div>

        <div class="form-group" style="margin-bottom:14px;">
          <label style="font-weight:700;display:flex;align-items:center;gap:6px;margin-bottom:8px;">
            <i class="fa-solid fa-shield-halved" style="color:var(--success);"></i> Family Supervision &amp; Access Roles
          </label>

          <div class="role-option-card ${isPublic ? 'active' : ''}" id="roleCardPublic" onclick="NARI.app.setNewDevRole('public')">
            <input type="radio" name="newDevRole" id="rolePublic" value="public" ${isPublic ? 'checked' : ''} class="role-radio">
            <div class="role-info">
              <div class="role-title">
                <i class="fa-solid fa-globe" style="color:#38bdf8;"></i> Public / Common Area Switch
              </div>
              <div class="role-desc">Anyone in the family can control, edit, rename, and manage this switch (e.g. Living Room, Veranda, Garden).</div>
            </div>
          </div>

          <div class="role-option-card ${!isPublic ? 'active' : ''}" id="roleCardPrivate" onclick="NARI.app.setNewDevRole('private')">
            <input type="radio" name="newDevRole" id="rolePrivate" value="private" ${!isPublic ? 'checked' : ''} class="role-radio">
            <div class="role-info">
              <div class="role-title">
                <i class="fa-solid fa-lock" style="color:#f59e0b;"></i> Private (Supervisor / Admin Only)
              </div>
              <div class="role-desc">Only Home Admins can configure, rename, or delete this card. Protected against accidental family deletion.</div>
            </div>
          </div>

          <div style="margin-top:8px;">
            <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:4px;">
              <i class="fa-solid fa-user-tag" style="color:#c084fc;"></i> Room Member Assignment (Optional)
            </label>
            <select id="newDevAssigned" style="width:100%;padding:8px 10px;font-size:0.8rem;background:rgba(255,255,255,0.06);border:1px solid var(--card-border);border-radius:8px;color:var(--text);">
              <option value="">General Household (All Members)</option>
              ${allPeople.map(p => `
                <option value="${escHtml(p.email || p.name)}" ${assignedTo === (p.email || p.name) ? 'selected' : ''}>
                  ${escHtml(p.name)} (${escHtml(p.role || 'Member')})
                </option>
              `).join("")}
            </select>
          </div>
        </div>

        <details style="margin-bottom:14px;background:rgba(255,255,255,0.02);padding:10px 12px;border-radius:10px;border:1px solid var(--card-border);">
          <summary style="font-size:0.76rem;color:var(--text-muted);cursor:pointer;font-weight:600;">
            <i class="fa-solid fa-microchip"></i> Hardware ID &amp; Local IP (Advanced)
          </summary>
          <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <label style="font-size:0.72rem;color:var(--text-muted);">Hardware Node ID</label>
              <input type="text" id="newDevId" value="${escHtml(defaultId)}" placeholder="e.g. a40a" style="font-family:var(--mono);font-size:0.78rem;padding:6px 8px;">
            </div>
            <div>
              <label style="font-size:0.72rem;color:var(--text-muted);">Local IP (Optional)</label>
              <input type="text" id="newDevIp" value="${escHtml(defaultIp)}" placeholder="e.g. 192.168.1.120" style="font-size:0.78rem;padding:6px 8px;">
            </div>
          </div>
        </details>

        <div class="btn-row" style="margin-top:14px;display:flex;gap:10px;">
          <button class="btn primary" onclick="NARI.app.saveNewDevice()" style="flex:2;padding:12px;font-size:0.95rem;box-shadow:0 6px 20px rgba(56,189,248,0.3);display:flex;align-items:center;justify-content:center;gap:6px;">
            <i class="fa-solid fa-circle-check"></i> <b>Save &amp; Add to Dashboard</b>
          </button>
          <button class="btn secondary" onclick="NARI.app.closeSheet()" style="flex:1;">Cancel</button>
        </div>
      `);
    },

    applyNameSuggestion(name) {
      const el = document.getElementById("newDevName");
      if (el) el.value = name;
      const lower = name.toLowerCase();
      if (lower.includes("bed")) NARI.app.selectNewDevRoom("Master Bedroom");
      else if (lower.includes("kitchen")) NARI.app.selectNewDevRoom("Kitchen");
      else if (lower.includes("living")) NARI.app.selectNewDevRoom("Living Room");
      else if (lower.includes("balcony")) NARI.app.selectNewDevRoom("Balcony");
      else if (lower.includes("garden")) NARI.app.selectNewDevRoom("Garden / Outdoor");
    },

    selectNewDevRoom(room) {
      const roomInput = document.getElementById("newDevRoom");
      if (roomInput) roomInput.value = room;
      const chips = document.querySelectorAll("#newRoomChips .room-select-chip");
      chips.forEach(c => {
        if (c.textContent.trim().toLowerCase() === room.toLowerCase()) {
          c.classList.add("active");
        } else {
          c.classList.remove("active");
        }
      });
    },

    toggleNewDevDual(isDual) {
      const box = document.getElementById("newDevRelay2Box");
      if (box) box.style.display = isDual ? "block" : "none";
    },

    setNewDevRole(role) {
      const pubRadio = document.getElementById("rolePublic");
      const privRadio = document.getElementById("rolePrivate");
      const pubCard = document.getElementById("roleCardPublic");
      const privCard = document.getElementById("roleCardPrivate");
      if (role === "public") {
        if (pubRadio) pubRadio.checked = true;
        if (pubCard) pubCard.classList.add("active");
        if (privCard) privCard.classList.remove("active");
      } else {
        if (privRadio) privRadio.checked = true;
        if (privCard) privCard.classList.add("active");
        if (pubCard) pubCard.classList.remove("active");
      }
    },

    saveNewDevice() {
      const nameInput = document.getElementById("newDevName");
      const roomInput = document.getElementById("newDevRoom");
      const dualInput = document.getElementById("newDevDual");
      const r1Input = document.getElementById("newDevRelay1");
      const r2Input = document.getElementById("newDevRelay2");
      const r1Icon = document.getElementById("newDevRelay1Icon");
      const r2Icon = document.getElementById("newDevRelay2Icon");
      const idInput = document.getElementById("newDevId");
      const ipInput = document.getElementById("newDevIp");
      const assignedInput = document.getElementById("newDevAssigned");
      const roleRadio = document.querySelector('input[name="newDevRole"]:checked');

      const name = (nameInput && nameInput.value.trim()) || `Switch ${store.devices.length + 1}`;
      const room = (roomInput && roomInput.value.trim()) || "Living Room";
      const isDual = dualInput ? dualInput.checked : true;
      const relay1Name = (r1Input && r1Input.value.trim()) || "Ceiling Light";
      const relay2Name = (r2Input && r2Input.value.trim()) || "Ceiling Fan";
      const relay1Icon = (r1Icon && r1Icon.value) || "bulb";
      const relay2Icon = (r2Icon && r2Icon.value) || "fan";
      let id = (idInput && idInput.value.trim().toLowerCase()) || "";
      const ip = (ipInput && ipInput.value.trim()) || "";
      const assignedTo = (assignedInput && assignedInput.value) || null;
      const isPublic = roleRadio ? roleRadio.value === "public" : true;

      if (!id) {
        id = ip ? ip.replace(/\./g, "_") : ("sw_" + Math.random().toString(36).slice(2, 6));
      }

      // Check if already in store
      const existingIdx = store.findIndex(id);
      let dev;
      if (existingIdx !== -1) {
        dev = store.devices[existingIdx];
        dev.name = name;
        dev.room = room;
        dev.dual = isDual;
        dev.relay1Name = relay1Name;
        dev.relay2Name = relay2Name;
        dev.relay1Icon = relay1Icon;
        dev.relay2Icon = relay2Icon;
        dev.assignedTo = assignedTo;
        dev.accessRole = isPublic ? "public" : "private";
        if (ip) dev.ip = ip;
        store.save();
        showToast(`Updated "${name}" settings!`, "ok");
      } else {
        dev = store.add({
          id,
          name,
          room,
          ip,
          dual: isDual,
          relay1Name,
          relay2Name,
          relay1Icon,
          relay2Icon,
          assignedTo,
          accessRole: isPublic ? "public" : "private",
          isOnline: false
        });
        showToast(`🎉 "${name}" added to ${room}!`, "ok");
      }

      // Manage Public / Private Switch sharing role
      if (NARI.sharing && NARI.sharing.setSwitchPublic) {
        NARI.sharing.setSwitchPublic(id, isPublic);
      }

      if (transport.subscribeId) transport.subscribeId(id);
      currentRoomFilter = room;
      renderRoomFilters();
      renderDeviceCards();
      transport.pollAll();
      closeSheet();

      if (NARI.audio) {
        try { NARI.audio.playFeedback("ok"); } catch (e) {}
      }
      if (navigator.vibrate) navigator.vibrate([60, 40, 100]);
    },

    openTriggerModal(index, selectedTab) {
      const dev = store.devices[index];
      if (!dev) return;
      const t = dev.triggers;

      if (selectedTab) currentTriggerTab = selectedTab === "presence" ? "geofence" : selectedTab;
      else if (!currentTriggerTab || currentTriggerTab === "presence") {
        const firstEn = ["schedule","clap","whistle","voice","shake","flick","flip","compass","tilt","light","battery","nfc","idle","effect","geofence"].find(k => (t[k] && t[k].enabled) || (k === "geofence" && t.presence && t.presence.enabled));
        currentTriggerTab = firstEn || "clap";
      }

      const tabs = [
        { id: "clap", cat: "audio", label: "Clap", icon: "fa-solid fa-hands-clapping", title: "Clap Trigger" },
        { id: "whistle", cat: "audio", label: "Whistle", icon: "fa-solid fa-bullhorn", title: "Whistle Detection" },
        { id: "voice", cat: "audio", label: "Voice", icon: "fa-solid fa-microphone", title: "Voice Recognition (EN / తెలుగు)" },
        { id: "shake", cat: "motion", label: "Shake", icon: "fa-solid fa-mobile-screen", title: "Shake Sensor" },
        { id: "flick", cat: "motion", label: "Flick", icon: "fa-solid fa-hand-sparkles", title: "Wrist Flick" },
        { id: "flip", cat: "motion", label: "Flip", icon: "fa-solid fa-rotate", title: "Phone Flip (DND)" },
        { id: "compass", cat: "motion", label: "Point", icon: "fa-solid fa-compass", title: "Compass Point & Tap" },
        { id: "tilt", cat: "motion", label: "Tilt", icon: "fa-solid fa-compass-drafting", title: "8-Way Room Tilt Gesture" },
        { id: "schedule", cat: "time", label: "Schedule", icon: "fa-solid fa-clock", title: "Countdown Timer & Schedule" },
        { id: "geofence", cat: "time", label: "Geo-Fence", icon: "fa-solid fa-location-crosshairs", title: "Geo-Fence Automation" },
        { id: "idle", cat: "time", label: "Idle", icon: "fa-solid fa-bed", title: "Phone Idle Auto-Off" },
        { id: "battery", cat: "fx", label: "Charger", icon: "fa-solid fa-battery-three-quarters", title: "EV / Charger Overcharge Guard" },
        { id: "nfc", cat: "fx", label: "NFC", icon: "fa-brands fa-nfc-symbol", title: "NFC Tag Trigger" },
        { id: "light", cat: "fx", label: "Lux", icon: "fa-solid fa-sun", title: "Ambient Light Sensor" },
        { id: "effect", cat: "fx", label: "Strobe", icon: "fa-solid fa-wand-magic-sparkles", title: "Strobe / SOS / Party Effect" }
      ];

      const activeTabInfo = tabs.find(x => x.id === currentTriggerTab) || tabs[0];
      const isEnabled = !!((t[activeTabInfo.id] && t[activeTabInfo.id].enabled) || (activeTabInfo.id === "geofence" && t.presence && t.presence.enabled));

      let configHtml = "";
      if (activeTabInfo.id === "clap") {
        configHtml = `
          <div class="form-group">
            <label>Cadence</label>
            <select onchange="NARI.app.setClapCadence(${index}, this.value)">
              <option value="single" ${t.clap.cadence === 'single' ? 'selected' : ''}>Single Clap (Immediate)</option>
              <option value="double" ${t.clap.cadence === 'double' ? 'selected' : ''}>Double Clap (300-750ms apart)</option>
              <option value="triple" ${t.clap.cadence === 'triple' ? 'selected' : ''}>Triple Clap</option>
            </select>
          </div>
          <div class="form-group">
            <label>Action</label>
            <select onchange="NARI.app.setTriggerAction(${index}, 'clap', this.value)">
              <option value="toggle" ${t.clap.action === 'toggle' ? 'selected' : ''}>Toggle (ON ↔ OFF)</option>
              <option value="on" ${t.clap.action === 'on' ? 'selected' : ''}>Turn ON only</option>
              <option value="off" ${t.clap.action === 'off' ? 'selected' : ''}>Turn OFF only</option>
            </select>
          </div>
          <div class="form-group">
            <label>Sensitivity</label>
            <select onchange="NARI.app.setClapSensitivity(${index}, parseFloat(this.value))">
              <option value="0.4" ${t.clap.sensitivity === 0.4 ? 'selected' : ''}>Relaxed (Loud claps only)</option>
              <option value="0.6" ${(!t.clap.sensitivity || t.clap.sensitivity === 0.6) ? 'selected' : ''}>Normal (Balanced - Recommended)</option>
              <option value="0.8" ${t.clap.sensitivity === 0.8 ? 'selected' : ''}>Sensitive (Soft hands)</option>
            </select>
          </div>
          <div style="margin-top:10px;">
            <button class="btn secondary sm" style="width:100%;" id="btnTrainClap" onclick="NARI.app.trainClapProfile(${index})">
              <i class="fa-solid fa-microphone-lines"></i> ${t.clap.profile ? 'Retrain Personal Fingerprint' : 'Train Custom Clap Fingerprint'}
            </button>
            ${t.clap.profile ? `
              <button class="btn danger sm" style="width:100%;margin-top:6px;" onclick="NARI.app.resetClapProfile(${index})">
                <i class="fa-solid fa-trash"></i> Reset to Generic Clap Gate
              </button>
            ` : ''}
            <div id="trainProgress" class="small muted" style="margin-top:6px;">
              ${t.clap.profile ? '<span style="color:var(--success)"><i class="fa-solid fa-circle-check"></i> Personal clap fingerprint trained</span>' : 'Standard acoustic impulse gate active (shouts & knocks rejected)'}
            </div>
          </div>
        `;
      } else if (activeTabInfo.id === "whistle") {
        configHtml = `
          <div class="form-group">
            <label>Action</label>
            <select onchange="NARI.app.setTriggerAction(${index}, 'whistle', this.value)">
              <option value="toggle" ${t.whistle.action === 'toggle' ? 'selected' : ''}>Toggle (ON ↔ OFF)</option>
              <option value="on" ${t.whistle.action === 'on' ? 'selected' : ''}>Turn ON only</option>
              <option value="off" ${t.whistle.action === 'off' ? 'selected' : ''}>Turn OFF only</option>
            </select>
          </div>
          <div class="help" style="margin-top:8px;padding:10px;background:rgba(255,255,255,0.03);border-radius:10px;">
            <b><i class="fa-solid fa-circle-info"></i> How Whistle Detection Works:</b><br>
            Blow a steady whistle tone (900 Hz – 4 kHz) for at least <b>0.3 seconds</b> near the phone.<br>
            Speech, music, and background room noise are automatically filtered out by narrowband FFT spectral analysis.
          </div>
        `;
      } else if (activeTabInfo.id === "voice") {
        configHtml = `
          <div class="form-group">
            <label>Turn ON Voice Command(s)</label>
            <input type="text" id="voiceOnInput" value="${escHtml(t.voice.on || 'light on, lights on, switch on')}"
                   placeholder="e.g. light on, lights on, switch on"
                   onchange="NARI.app.saveVoiceConfig(${index})">
            <span class="help">Comma-separated phrases. Example: <i>light on, turn on switch</i></span>
          </div>
          <div class="form-group">
            <label>Turn OFF Voice Command(s)</label>
            <input type="text" id="voiceOffInput" value="${escHtml(t.voice.off || 'light off, lights off, switch off')}"
                   placeholder="e.g. light off, lights off, switch off"
                   onchange="NARI.app.saveVoiceConfig(${index})">
            <span class="help">Comma-separated phrases. Example: <i>light off, turn off switch</i></span>
          </div>
          <div class="form-group">
            <label>Toggle Voice Command(s) (Optional)</label>
            <input type="text" id="voiceToggleInput" value="${escHtml(t.voice.toggle || '')}"
                   placeholder="e.g. toggle light"
                   onchange="NARI.app.saveVoiceConfig(${index})">
          </div>
          <div class="clap-log" id="voiceHeardBox" style="margin-top:8px;">
            <i class="fa-solid fa-microphone"></i> Last heard: <span id="voiceHeardText" style="color:var(--accent);"><i>(Say any command aloud to test)</i></span>
          </div>
          <span class="help" style="display:block;margin-top:4px;">Language: <b>${NARI.settings.voiceLang || 'en-IN'}</b> (changeable in Settings)</span>
        `;
      } else if (activeTabInfo.id === "shake") {
        configHtml = `
          <div class="form-group">
            <label>Action</label>
            <select onchange="NARI.app.setTriggerAction(${index}, 'shake', this.value)">
              <option value="toggle" ${t.shake.action === 'toggle' ? 'selected' : ''}>Toggle (ON ↔ OFF)</option>
              <option value="on" ${t.shake.action === 'on' ? 'selected' : ''}>Turn ON only</option>
              <option value="off" ${t.shake.action === 'off' ? 'selected' : ''}>Turn OFF only</option>
            </select>
          </div>
          <div class="form-group">
            <label>Shake Intensity</label>
            <select onchange="NARI.app.setShakeStrength(${index}, this.value)">
              <option value="gentle" ${t.shake.strength === 'gentle' ? 'selected' : ''}>Gentle (10 m/s²)</option>
              <option value="normal" ${(!t.shake.strength || t.shake.strength === 'normal') ? 'selected' : ''}>Normal (13 m/s² - Recommended)</option>
              <option value="hard" ${t.shake.strength === 'hard' ? 'selected' : ''}>Hard (20 m/s² - Vigorous shake)</option>
            </select>
          </div>
          <div class="help" style="margin-top:8px;padding:10px;background:rgba(255,255,255,0.03);border-radius:10px;">
            <b><i class="fa-solid fa-shield-halved"></i> False-Trigger Protection:</b><br>
            Requires <b>3 alternating shake cycles</b> within 700ms. Walking, running, or bumping the phone on a table will never accidentally trigger the switch.
          </div>
        `;
      } else if (activeTabInfo.id === "geofence" || activeTabInfo.id === "presence") {
        const geoCfg = t.geofence || t.presence || {};
        const devKey = store.identifierOf(dev);
        const radius = typeof geoCfg.radiusM === "number" ? geoCfg.radiusM : (parseFloat(geoCfg.radiusM) || 2.5);
        const targetLat = (geoCfg.lat !== null && geoCfg.lat !== undefined) ? geoCfg.lat : (dev.lat !== null && dev.lat !== undefined ? dev.lat : NARI.settings.homeLat);
        const targetLon = (geoCfg.lon !== null && geoCfg.lon !== undefined) ? geoCfg.lon : (dev.lon !== null && dev.lon !== undefined ? dev.lon : NARI.settings.homeLon);
        const hasCoords = (targetLat !== null && targetLat !== undefined && targetLon !== null && targetLon !== undefined);

        let curDist = null;
        if (hasCoords && NARI.sensors._geofence && NARI.sensors._geofence.lastPos) {
          curDist = NARI.haversine(NARI.sensors._geofence.lastPos.lat, NARI.sensors._geofence.lastPos.lon, targetLat, targetLon);
        } else if (hasCoords && NARI.sensors._geofence && NARI.sensors._geofence.distances && NARI.sensors._geofence.distances[devKey] !== undefined) {
          curDist = NARI.sensors._geofence.distances[devKey];
        }

        const isInside = curDist !== null ? (curDist <= radius) : (NARI.sensors._geofence && NARI.sensors._geofence.inside && NARI.sensors._geofence.inside[devKey]);
        const distDisplay = curDist !== null ? (curDist < 10 ? curDist.toFixed(1) + ' meters' : Math.round(curDist) + ' meters') : (hasCoords ? 'Acquiring GPS position...' : 'N/A');

        configHtml = `
          <!-- Smart Switch Location -->
          <div style="background:rgba(255,255,255,0.03);border:1px solid var(--card-border);border-radius:12px;padding:12px;margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:0.78rem;font-weight:700;color:var(--text);"><i class="fa-solid fa-map-pin" style="color:var(--accent);"></i> Smart Device Location</span>
              ${hasCoords ? `
                <span style="font-size:0.65rem;padding:2px 8px;border-radius:999px;background:rgba(16,185,129,0.15);color:var(--success);font-weight:700;">
                  <i class="fa-solid fa-check"></i> Configured
                </span>
              ` : `
                <span style="font-size:0.65rem;padding:2px 8px;border-radius:999px;background:rgba(234,179,8,0.15);color:var(--warn);font-weight:700;">
                  <i class="fa-solid fa-triangle-exclamation"></i> Not Set
                </span>
              `}
            </div>
            
            <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:8px;">
              ${hasCoords ? `Coordinates: <b style="color:var(--text);">${Number(targetLat).toFixed(5)}, ${Number(targetLon).toFixed(5)}</b>` : 'Save the GPS coordinates of your smart device in this room.'}
            </div>

            <div style="display:flex;gap:8px;">
              <button class="btn secondary sm" style="flex:1;" onclick="NARI.app.setCurrentLocationAsDevice(${index})">
                <i class="fa-solid fa-crosshairs"></i> Set Device Location to Current GPS
              </button>
              ${hasCoords ? `
                <button class="btn danger sm" style="padding:4px 10px;" onclick="NARI.app.clearDeviceLocation(${index})" title="Clear Location">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </div>

          <!-- Adjustable Room Trigger Range Slider (0.5m to 5.0m) -->
          <div class="form-group" style="margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <label style="font-weight:700;margin:0;">Room Triggering Range (Doorway &harr; Room)</label>
              <span id="geoRadiusLabel" style="font-size:0.85rem;font-weight:700;color:var(--accent);background:rgba(16,185,129,0.18);padding:2px 10px;border-radius:6px;border:1px solid rgba(52,211,153,0.3);">
                ${Number(radius).toFixed(1)} meters
              </span>
            </div>
            <input type="range" id="geoRadiusSlider" min="0.5" max="5.0" step="0.1" value="${radius}"
                   style="width:100%;accent-color:var(--accent);cursor:pointer;"
                   oninput="NARI.app.updateGeofenceRadiusLive(this.value)"
                   onchange="NARI.app.setGeofenceRadius(${index}, this.value)">
            <div style="display:flex;justify-content:space-between;font-size:0.68rem;color:var(--text-muted);margin-top:4px;">
              <span>0.5 m (Doorway)</span>
              <span>1.5 m</span>
              <span>3.0 m (Mid-Room)</span>
              <span>5.0 m (Room Perimeter)</span>
            </div>
          </div>

          <!-- Actions -->
          <div class="form-group">
            <label>Action When Entering Room (&le; Range)</label>
            <select onchange="NARI.app.setGeofenceEnterAction(${index}, this.value)">
              <option value="on" ${(geoCfg.onEnter === 'on' || geoCfg.onArrive === 'on' || (!geoCfg.onEnter && !geoCfg.onArrive)) ? 'selected' : ''}>Turn ON (Auto Light ON)</option>
              <option value="off" ${(geoCfg.onEnter === 'off' || geoCfg.onArrive === 'off') ? 'selected' : ''}>Turn OFF</option>
              <option value="none" ${(geoCfg.onEnter === 'none' || geoCfg.onArrive === 'none') ? 'selected' : ''}>Do Nothing</option>
            </select>
          </div>

          <div class="form-group">
            <label>Action When Getting Out of Room (&gt; Range)</label>
            <select onchange="NARI.app.setGeofenceExitAction(${index}, this.value)">
              <option value="off" ${(geoCfg.onExit === 'off' || geoCfg.onLeave === 'off' || (!geoCfg.onExit && !geoCfg.onLeave)) ? 'selected' : ''}>Turn OFF (Auto Light OFF)</option>
              <option value="on" ${(geoCfg.onExit === 'on' || geoCfg.onLeave === 'on') ? 'selected' : ''}>Turn ON</option>
              <option value="none" ${(geoCfg.onExit === 'none' || geoCfg.onLeave === 'none') ? 'selected' : ''}>Do Nothing</option>
            </select>
          </div>

          <!-- Live Distance & Status Indicator -->
          <div class="help" style="margin-top:12px;padding:12px;background:rgba(255,255,255,0.03);border-radius:12px;border:1px solid var(--card-border);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <b><i class="fa-solid fa-satellite-dish"></i> Live Distance &amp; Status:</b>
              <span id="geoLiveStatusBadge">
                ${!hasCoords ? '<span style="color:var(--warn);font-weight:700;"><i class="fa-solid fa-circle-exclamation"></i> Set device location</span>' :
                  isInside ? '<span style="color:var(--success);font-weight:700;"><i class="fa-solid fa-circle-check"></i> Inside Room (Light ON) 🟢</span>' :
                  '<span style="color:var(--text-muted);font-weight:700;"><i class="fa-solid fa-circle"></i> Out of Room (Light OFF) ⚪</span>'}
              </span>
            </div>
            <div style="font-size:0.8rem;color:var(--text);margin-top:4px;">
              Current Distance: <b id="geoLiveDistanceVal" style="color:var(--accent);">${distDisplay}</b>
            </div>
            <div class="small muted" style="margin-top:6px;line-height:1.4;">
              Calculates real-time distance between your phone and this smart switch. When you enter the room (within <b>${Number(radius).toFixed(1)}m</b>), your light turns ON automatically; when you walk out of the room, the light turns OFF.
            </div>
          </div>
        `;
      } else if (activeTabInfo.id === "schedule") {
        configHtml = `
          <div style="margin-bottom:14px;">
            <label style="font-size:0.76rem;font-weight:700;color:var(--text-muted);display:block;margin-bottom:6px;">Quick Auto-Off Timer</label>
            ${t.schedule.timer && t.schedule.timer.endsAt && t.schedule.timer.endsAt > Date.now() ? `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:10px;background:rgba(16,185,129,0.15);border:1px solid var(--accent);border-radius:10px;">
                <div>
                  <span style="font-weight:700;color:var(--success);"><i class="fa-solid fa-hourglass-half"></i> Active Timer</span>
                  <div class="small muted">Auto-${(t.schedule.timer.action || 'off').toUpperCase()} in ${Math.max(1, Math.round((t.schedule.timer.endsAt - Date.now()) / 60000))} min</div>
                </div>
                <button class="btn danger sm" onclick="NARI.app.cancelQuickTimer(${index})">Cancel</button>
              </div>
            ` : `
              <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:6px;">
                <button class="btn secondary sm" onclick="NARI.app.setQuickTimer(${index}, 15, 'off')">15 min</button>
                <button class="btn secondary sm" onclick="NARI.app.setQuickTimer(${index}, 30, 'off')">30 min</button>
                <button class="btn secondary sm" onclick="NARI.app.setQuickTimer(${index}, 60, 'off')">1 hour</button>
                <button class="btn secondary sm" onclick="NARI.app.setQuickTimer(${index}, 120, 'off')">2 hours</button>
              </div>
            `}
          </div>

          <div>
            <label style="font-size:0.76rem;font-weight:700;color:var(--text-muted);display:block;margin-bottom:6px;">Active Schedules</label>
            ${(t.schedule.rules && t.schedule.rules.length) ? `
              <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
                ${t.schedule.rules.map((r, ri) => `
                  <div class="rule">
                    <div>
                      <b>${r.time === 'sunrise' ? '🌅 Sunrise' : r.time === 'sunset' ? '🌇 Sunset' : r.time}</b>
                      ${r.offsetMin ? (r.offsetMin > 0 ? ` +${r.offsetMin}m` : ` ${r.offsetMin}m`) : ''}
                      &rarr; <span style="color:var(--accent);font-weight:700;">${(r.action || 'toggle').toUpperCase()}</span>
                      <div class="small muted">${formatDays(r.days)}</div>
                    </div>
                    <button class="btn danger sm" style="padding:4px 8px;" onclick="NARI.app.deleteScheduleRule(${index}, ${ri})" title="Delete rule">
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  </div>
                `).join('')}
              </div>
            ` : '<div class="small muted" style="margin-bottom:10px;">No recurring schedules configured yet.</div>'}

            <details style="margin-top:6px;">
              <summary><i class="fa-solid fa-plus"></i> Add New Daily Schedule</summary>
              <div style="margin-top:10px;">
                <div class="form-group">
                  <label>Trigger Time</label>
                  <select id="schedTimeType" onchange="NARI.app.toggleSchedTimeInput()">
                    <option value="time">Specific Time (Clock)</option>
                    <option value="sunrise">At Sunrise</option>
                    <option value="sunset">At Sunset</option>
                  </select>
                  <input type="time" id="schedClockTime" value="06:30" style="margin-top:6px;">
                  <input type="number" id="schedOffset" placeholder="Offset in minutes (+/-)" value="0" style="margin-top:6px;display:none;">
                </div>
                <div class="form-group">
                  <label>Action</label>
                  <select id="schedAction">
                    <option value="on">Turn ON</option>
                    <option value="off">Turn OFF</option>
                    <option value="toggle">Toggle (ON/OFF)</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Repeat Days</label>
                  <div class="days" id="schedDaysPicker">
                    ${['S','M','T','W','T','F','S'].map((d, di) => `
                      <button type="button" class="on" data-day="${di}" onclick="this.classList.toggle('on')">${d}</button>
                    `).join('')}
                  </div>
                </div>
                <button class="btn primary sm" style="width:100%;margin-top:8px;" onclick="NARI.app.addNewScheduleRule(${index})">
                  <i class="fa-solid fa-calendar-plus"></i> Save Schedule
                </button>
              </div>
            </details>
          </div>
        `;
      } else if (activeTabInfo.id === "flick") {
        configHtml = `
          <div class="form-group">
            <label>Wrist Flick Action</label>
            <select onchange="NARI.app.setTriggerAction(${index}, 'flick', this.value)">
              <option value="toggle" ${t.flick.action === 'toggle' ? 'selected' : ''}>Toggle (ON ↔ OFF)</option>
              <option value="on" ${t.flick.action === 'on' ? 'selected' : ''}>Turn ON only</option>
              <option value="off" ${t.flick.action === 'off' ? 'selected' : ''}>Turn OFF only</option>
            </select>
          </div>
          <p class="small muted">Perform a crisp wrist twist (>240°/s gyro rotation) to trigger instantly without shaking your arm.</p>
        `;
      } else if (activeTabInfo.id === "flip") {
        configHtml = `
          <div class="form-group">
            <label>When Placed Face-Down on Table</label>
            <select onchange="NARI.app.setTriggerField(${index}, 'flip', 'faceDown', this.value)">
              <option value="off" ${t.flip.faceDown === 'off' ? 'selected' : ''}>Turn OFF (Sleep / DND Mode)</option>
              <option value="on" ${t.flip.faceDown === 'on' ? 'selected' : ''}>Turn ON</option>
              <option value="none" ${t.flip.faceDown === 'none' ? 'selected' : ''}>Do Nothing</option>
            </select>
          </div>
          <div class="form-group">
            <label>When Flipped Back Face-Up</label>
            <select onchange="NARI.app.setTriggerField(${index}, 'flip', 'faceUp', this.value)">
              <option value="on" ${t.flip.faceUp === 'on' ? 'selected' : ''}>Turn ON</option>
              <option value="off" ${t.flip.faceUp === 'off' ? 'selected' : ''}>Turn OFF</option>
              <option value="none" ${t.flip.faceUp === 'none' ? 'selected' : ''}>Do Nothing</option>
            </select>
          </div>
        `;
      } else if (activeTabInfo.id === "compass") {
        configHtml = `
          <div class="form-group">
            <label>Saved Appliance Direction Heading</label>
            <div style="display:flex;gap:8px;align-items:center;">
              <input type="text" readonly value="${t.compass.heading !== null && t.compass.heading !== undefined ? Math.round(t.compass.heading) + '°' : 'Not calibrated'}" style="flex:1;">
              <button class="btn secondary sm" onclick="NARI.app.calibrateCompass(${index})"><i class="fa-solid fa-compass"></i> Lock Current Heading</button>
            </div>
          </div>
          <p class="small muted">Point your phone toward this appliance (±${t.compass.tolerance || 25}° cone) to target it automatically.</p>
        `;
      } else if (activeTabInfo.id === "battery") {
        configHtml = `
          <div class="form-group">
            <label>Battery Protection Mode</label>
            <select onchange="NARI.app.setTriggerField(${index}, 'battery', 'mode', this.value)">
              <option value="chargerGuard" ${(t.battery.mode === 'chargerGuard' || t.battery.mode === 'smartCharge') ? 'selected' : ''}>Charger Guard (Cut off at High %, Turn ON at Low %)</option>
              <option value="lowOff" ${(t.battery.mode === 'lowOff' || t.battery.mode === 'lowSaver') ? 'selected' : ''}>Low Battery Saver (Turn OFF appliance when phone is low)</option>
            </select>
          </div>
          <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <label>Low Threshold (%)</label>
              <input type="number" min="5" max="90" value="${t.battery.low || 20}" onchange="NARI.app.setTriggerField(${index}, 'battery', 'low', Number(this.value))">
            </div>
            <div>
              <label>High Cut-Off (%)</label>
              <input type="number" min="50" max="100" value="${t.battery.high || 80}" onchange="NARI.app.setTriggerField(${index}, 'battery', 'high', Number(this.value))">
            </div>
          </div>
        `;
      } else if (activeTabInfo.id === "tilt") {
        configHtml = `
          <p class="small muted">Tilt your phone in 8 compass directions (${store.roomMap && store.roomMap.threshold ? store.roomMap.threshold : 16}° tilt angle) to toggle mapped room switches.</p>
        `;
      } else if (activeTabInfo.id === "light") {
        configHtml = `
          <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <label>Ambient Lux Mode</label>
              <select onchange="NARI.app.setTriggerField(${index}, 'light', 'mode', this.value)">
                <option value="darkOn" ${t.light.mode === 'darkOn' ? 'selected' : ''}>Dark &rarr; Turn ON (Auto Night Lamp)</option>
                <option value="brightOff" ${t.light.mode === 'brightOff' ? 'selected' : ''}>Bright &rarr; Turn OFF (Daylight Saver)</option>
              </select>
            </div>
            <div>
              <label>Lux Threshold</label>
              <input type="number" min="1" max="500" value="${t.light.threshold || 15}" onchange="NARI.app.setTriggerField(${index}, 'light', 'threshold', Number(this.value))">
            </div>
          </div>
        `;
      } else if (activeTabInfo.id === "nfc") {
        configHtml = `
          <div class="form-group">
            <label>NFC Tag Action</label>
            <select onchange="NARI.app.setTriggerAction(${index}, 'nfc', this.value)">
              <option value="toggle" ${t.nfc.action === 'toggle' ? 'selected' : ''}>Toggle (ON ↔ OFF)</option>
              <option value="on" ${t.nfc.action === 'on' ? 'selected' : ''}>Turn ON</option>
              <option value="off" ${t.nfc.action === 'off' ? 'selected' : ''}>Turn OFF</option>
            </select>
          </div>
          <p class="small muted">Tap any NDEF NFC sticker on Android Chrome to trigger this appliance (Tag ID: <span class="mono">${escHtml(t.nfc.serial || 'Any paired tag')}</span>).</p>
        `;
      } else if (activeTabInfo.id === "idle") {
        configHtml = `
          <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <label>Idle Timeout (Minutes)</label>
              <input type="number" min="1" max="240" value="${t.idle.minutes || 10}" onchange="NARI.app.setTriggerField(${index}, 'idle', 'minutes', Number(this.value))">
            </div>
            <div>
              <label>Action When Idle</label>
              <select onchange="NARI.app.setTriggerAction(${index}, 'idle', this.value)">
                <option value="off" ${t.idle.action === 'off' ? 'selected' : ''}>Turn OFF</option>
                <option value="on" ${t.idle.action === 'on' ? 'selected' : ''}>Turn ON</option>
              </select>
            </div>
          </div>
        `;
      } else if (activeTabInfo.id === "effect") {
        configHtml = `
          <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <label>Pattern</label>
              <select onchange="NARI.app.setTriggerField(${index}, 'effect', 'sub', this.value)">
                <option value="strobe" ${t.effect.sub === 'strobe' ? 'selected' : ''}>Regular Strobe</option>
                <option value="sos" ${t.effect.sub === 'sos' ? 'selected' : ''}>SOS Morse Signal</option>
                <option value="party" ${t.effect.sub === 'party' ? 'selected' : ''}>Random Party Pulse</option>
              </select>
            </div>
            <div>
              <label>Pulse Speed (ms)</label>
              <input type="number" min="250" max="5000" step="50" value="${t.effect.speed || 500}" onchange="NARI.app.setTriggerField(${index}, 'effect', 'speed', Number(this.value))">
            </div>
          </div>
        `;
      }

      openSheet(`
        <div class="sheet-header">
          <div>Triggers &amp; Automations<span class="sub">${dev.name}</span></div>
          <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
        </div>
        <div class="trigger-grid">
          ${tabs.map(tab => {
            const isEn = !!(t[tab.id] && t[tab.id].enabled);
            const isSel = currentTriggerTab === tab.id;
            return `
              <div class="tchip ${isEn ? 'on' : ''} ${isSel ? 'active-tab' : ''}" 
                   onclick="NARI.app.selectTriggerTab(${index}, '${tab.id}')"
                   title="${tab.label} — ${isEn ? 'Enabled' : 'Disabled'}">
                <i class="${tab.icon}"></i>${tab.label}
                <span class="st"></span>
              </div>
            `;
          }).join('')}
        </div>

        <div class="tconf">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h4 style="margin:0;"><i class="${activeTabInfo.icon}"></i> ${activeTabInfo.title}</h4>
            <button class="btn sm ${isEnabled ? 'danger' : 'primary'}" onclick="NARI.app.toggleTrigger(${index}, '${activeTabInfo.id}')">
              ${isEnabled ? '<i class="fa-solid fa-power-off"></i> Disable' : '<i class="fa-solid fa-bolt"></i> Enable Mode'}
            </button>
          </div>
          ${dev.dual ? `
            <div class="form-group" style="background:rgba(255,255,255,0.03);padding:10px 12px;border-radius:10px;border:1px solid var(--card-border);margin-bottom:12px;">
              <label style="margin:0 0 6px;font-weight:700;"><i class="fa-solid fa-code-fork" style="color:var(--accent);"></i> Target Appliance</label>
              <select onchange="NARI.app.setTriggerTargetRelay(${index}, '${activeTabInfo.id}', this.value)">
                <option value="both" ${(t[activeTabInfo.id] && (t[activeTabInfo.id].targetRelay === 'both' || !t[activeTabInfo.id].targetRelay)) ? 'selected' : ''}>Both (${escHtml(dev.relay1Name || 'Relay 1')} &amp; ${escHtml(dev.relay2Name || 'Relay 2')})</option>
                <option value="relay1" ${(t[activeTabInfo.id] && t[activeTabInfo.id].targetRelay === 'relay1') ? 'selected' : ''}>${escHtml(dev.relay1Name || 'Relay 1')} Only</option>
                <option value="relay2" ${(t[activeTabInfo.id] && t[activeTabInfo.id].targetRelay === 'relay2') ? 'selected' : ''}>${escHtml(dev.relay2Name || 'Relay 2')} Only</option>
              </select>
            </div>
          ` : ''}
          ${configHtml}
        </div>
      `);
    },

    setTriggerTargetRelay(index, type, val) {
      const dev = store.devices[index];
      if (!dev || !dev.triggers[type]) return;
      dev.triggers[type].targetRelay = val;
      store.save();
      sensors.sync();
      const lbl = val === 'both' ? 'Both Appliances' : val === 'relay2' ? (dev.relay2Name || 'Relay 2') : (dev.relay1Name || 'Relay 1');
      showToast(`Automation applied to: ${lbl}`, "ok");
    },

    selectTriggerTab(index, type) {
      currentTriggerTab = type;
      this.openTriggerModal(index, type);
    },

    toggleTrigger(index, type) {
      const dev = store.devices[index];
      if (type === "presence") type = "geofence";
      if (!dev.triggers[type]) dev.triggers[type] = { enabled: false };
      dev.triggers[type].enabled = !dev.triggers[type].enabled;
      if (type === "geofence" && dev.triggers.presence) {
        dev.triggers.presence.enabled = dev.triggers.geofence.enabled;
      }
      store.save();
      sensors.sync();
      currentTriggerTab = type;
      this.openTriggerModal(index, type);
      renderDeviceCards();
      const st = dev.triggers[type].enabled;
      showToast(`${dev.name}: ${type === 'geofence' ? 'Geo-Fence' : type.toUpperCase()} mode ${st ? 'Enabled' : 'Disabled'}`, st ? "ok" : "info");
    },

    setTriggerAction(index, type, action) {
      store.devices[index].triggers[type].action = action;
      store.save();
    },

    setTriggerField(index, type, key, val) {
      const dev = store.devices[index];
      if (!dev || !dev.triggers[type]) return;
      dev.triggers[type][key] = val;
      store.save();
      sensors.sync();
    },

    calibrateCompass(index) {
      const dev = store.devices[index];
      if (!dev) return;
      const rawH = typeof sensors.heading === "number" ? sensors.heading : (sensors.state && typeof sensors.state.heading === "number" ? sensors.state.heading : 0);
      const h = Math.round(rawH);
      dev.triggers.compass.heading = h;
      store.save();
      sensors.sync();
      this.openTriggerModal(index, "compass");
      showToast(`Compass heading locked at ${h}°`, "ok");
    },

    setClapCadence(index, cadence) {
      store.devices[index].triggers.clap.cadence = cadence;
      store.save();
    },

    setClapSensitivity(index, sens) {
      store.devices[index].triggers.clap.sensitivity = sens;
      store.save();
      sensors.sync();
    },

    resetClapProfile(index) {
      store.devices[index].triggers.clap.profile = null;
      store.save();
      this.openTriggerModal(index, 'clap');
      showToast("Reset to generic clap impulse gate", "ok");
    },

    trainClapProfile(index) {
      const prog = document.getElementById("trainProgress");
      const btn = document.getElementById("btnTrainClap");
      if (btn) btn.disabled = true;

      audioTrainingCtrl = audio.train(5, (collected, total, info) => {
        if (!prog) return;
        if (info && info.rejected) {
          prog.innerText = `Transient rejected (${info.reasons ? info.reasons[0] : 'not a clap'}). Clap again.`;
        } else {
          prog.innerText = `Recorded ${collected} of ${total} claps...`;
        }
      });

      audioTrainingCtrl.promise.then(profile => {
        if (btn) btn.disabled = false;
        if (profile) {
          store.devices[index].triggers.clap.profile = profile;
          store.save();
          if (prog) prog.innerHTML = '<span style="color:var(--success)"><i class="fa-solid fa-circle-check"></i> Training successful! Fingerprint saved.</span>';
          showToast("Clap fingerprint saved!", "ok");
        } else {
          if (prog) prog.innerText = "Training cancelled.";
        }
      });
    },

    saveVoiceConfig(index) {
      const onV = document.getElementById("voiceOnInput")?.value || "";
      const offV = document.getElementById("voiceOffInput")?.value || "";
      const togV = document.getElementById("voiceToggleInput")?.value || "";
      store.devices[index].triggers.voice.on = onV;
      store.devices[index].triggers.voice.off = offV;
      store.devices[index].triggers.voice.toggle = togV;
      store.save();
      showToast("Voice commands updated", "ok");
    },

    setShakeStrength(index, strength) {
      store.devices[index].triggers.shake.strength = strength;
      store.save();
    },

    setCurrentLocationAsDevice(index) {
      if (!navigator.geolocation) {
        showToast("Geolocation is not supported by this browser", "warn");
        return;
      }
      showToast("Acquiring GPS coordinates...", "info");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const dev = store.devices[index];
          if (!dev) return;
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          if (!dev.triggers.geofence) dev.triggers.geofence = { enabled: false, radiusM: 50, lat, lon, onEnter: "on", onExit: "off" };
          dev.triggers.geofence.lat = lat;
          dev.triggers.geofence.lon = lon;
          dev.lat = lat;
          dev.lon = lon;
          if (NARI.settings.homeLat === null) {
            NARI.settings.homeLat = lat;
            NARI.settings.homeLon = lon;
            NARI.saveSettings();
          }
          store.save();
          sensors.sync();
          this.openTriggerModal(index, 'geofence');
          showToast(`Saved switch location (${lat.toFixed(4)}, ${lon.toFixed(4)})`, "ok");
        },
        (err) => {
          showToast("Location error: " + (err.message || "Permission denied"), "error");
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    },

    clearDeviceLocation(index) {
      const dev = store.devices[index];
      if (!dev) return;
      if (dev.triggers.geofence) {
        dev.triggers.geofence.lat = null;
        dev.triggers.geofence.lon = null;
      }
      dev.lat = null;
      dev.lon = null;
      store.save();
      sensors.sync();
      this.openTriggerModal(index, 'geofence');
      showToast("Device location cleared", "info");
    },

    setGeofenceRadius(index, radius) {
      const val = Math.max(0.5, Math.min(5.0, parseFloat(radius) || 2.5));
      const dev = store.devices[index];
      if (!dev) return;
      if (!dev.triggers.geofence) dev.triggers.geofence = { enabled: false, radiusM: val, lat: null, lon: null, onEnter: "on", onExit: "off" };
      dev.triggers.geofence.radiusM = val;
      store.save();
      sensors.sync();
      showToast(`Room trigger range set to ${val.toFixed(1)} meters`, "ok");
    },

    updateGeofenceRadiusLive(radius) {
      const lbl = document.getElementById("geoRadiusLabel");
      if (lbl) lbl.textContent = `${parseFloat(radius).toFixed(1)} meters`;
    },

    setGeofenceEnterAction(index, act) {
      const dev = store.devices[index];
      if (!dev) return;
      if (!dev.triggers.geofence) dev.triggers.geofence = { enabled: false, radiusM: 50, lat: null, lon: null, onEnter: "on", onExit: "off" };
      dev.triggers.geofence.onEnter = act;
      if (dev.triggers.presence) dev.triggers.presence.onArrive = act;
      store.save();
    },

    setGeofenceExitAction(index, act) {
      const dev = store.devices[index];
      if (!dev) return;
      if (!dev.triggers.geofence) dev.triggers.geofence = { enabled: false, radiusM: 50, lat: null, lon: null, onEnter: "on", onExit: "off" };
      dev.triggers.geofence.onExit = act;
      if (dev.triggers.presence) dev.triggers.presence.onLeave = act;
      store.save();
    },

    setPresenceSource(index, source) {
      store.devices[index].triggers.presence.source = source;
      store.save();
      sensors.sync();
      this.openTriggerModal(index, 'geofence');
    },

    setPresenceArrive(index, act) {
      this.setGeofenceEnterAction(index, act);
    },

    setPresenceLeave(index, act) {
      this.setGeofenceExitAction(index, act);
    },

    setQuickTimer(index, minutes, action) {
      const endsAt = Date.now() + minutes * 60000;
      const dev = store.devices[index];
      dev.triggers.schedule.timer = { endsAt, action };
      dev.triggers.schedule.enabled = true;
      store.save();
      sensors.sync();
      if (transport && typeof transport.setHardwareTimer === "function") {
        transport.setHardwareTimer(dev, minutes * 60, action === "on");
      }
      this.openTriggerModal(index, 'schedule');
      renderDeviceCards();
      showToast(`⏱️ Auto-${action.toUpperCase()} timer set for ${minutes} min (Hardware + App)`, "ok");
    },

    cancelQuickTimer(index) {
      const dev = store.devices[index];
      dev.triggers.schedule.timer = null;
      store.save();
      sensors.sync();
      if (transport && typeof transport.setHardwareTimer === "function") {
        transport.setHardwareTimer(dev, 0, false);
      }
      this.openTriggerModal(index, 'schedule');
      renderDeviceCards();
      showToast("Timer cancelled", "info");
    },

    deleteScheduleRule(index, ruleIndex) {
      store.devices[index].triggers.schedule.rules.splice(ruleIndex, 1);
      store.save();
      sensors.sync();
      this.openTriggerModal(index, 'schedule');
      renderDeviceCards();
      showToast("Schedule rule deleted", "ok");
    },

    toggleSchedTimeInput() {
      const type = document.getElementById("schedTimeType")?.value;
      const clock = document.getElementById("schedClockTime");
      const offset = document.getElementById("schedOffset");
      if (type === "time") {
        if (clock) clock.style.display = "block";
        if (offset) offset.style.display = "none";
      } else {
        if (clock) clock.style.display = "none";
        if (offset) offset.style.display = "block";
      }
    },

    addNewScheduleRule(index) {
      const type = document.getElementById("schedTimeType")?.value || "time";
      let timeVal = "";
      let offsetVal = 0;
      if (type === "time") {
        timeVal = document.getElementById("schedClockTime")?.value || "06:30";
      } else {
        timeVal = type;
        offsetVal = parseInt(document.getElementById("schedOffset")?.value, 10) || 0;
      }
      const actionVal = document.getElementById("schedAction")?.value || "toggle";
      const dayBtns = document.querySelectorAll("#schedDaysPicker button.on");
      const days = Array.from(dayBtns).map(b => parseInt(b.getAttribute("data-day"), 10));
      const rule = { time: timeVal, action: actionVal, days, enabled: true };
      if (offsetVal) rule.offsetMin = offsetVal;

      if (!store.devices[index].triggers.schedule.rules) {
        store.devices[index].triggers.schedule.rules = [];
      }
      store.devices[index].triggers.schedule.rules.push(rule);
      store.devices[index].triggers.schedule.enabled = true;
      store.save();
      sensors.sync();
      this.openTriggerModal(index, 'schedule');
      renderDeviceCards();
      showToast("✅ Schedule rule added!", "ok");
    },

    openIrRemoteModal(index, tab) {
      const dev = store.devices[index];
      if (!dev) return;
      const keys = Array.isArray(dev.irKeys) ? dev.irKeys : [];
      const activeTab = (tab === "keys" || tab === "ac" || tab === "tv") ? tab : "ac";
      dev._acTemp = dev._acTemp || 24;
      dev._acMode = dev._acMode || "COOL";
      dev._acFan = dev._acFan || "AUTO";

      openSheet(`
        <div class="sheet-header">
          <div>Universal IR Remote<span class="sub">${escHtml(dev.name)} &bull; ${escHtml(dev.id || dev.ip || 'ESP32')}</span></div>
          <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
        </div>

        <div class="seg" style="margin-bottom:14px;">
          <button class="${activeTab === 'ac' ? 'on' : ''}" onclick="NARI.app.openIrRemoteModal(${index}, 'ac')">
            <i class="fa-solid fa-snowflake"></i> AC Remote
          </button>
          <button class="${activeTab === 'tv' ? 'on' : ''}" onclick="NARI.app.openIrRemoteModal(${index}, 'tv')">
            <i class="fa-solid fa-tv"></i> TV Remote
          </button>
          <button class="${activeTab === 'keys' ? 'on' : ''}" onclick="NARI.app.openIrRemoteModal(${index}, 'keys')">
            <i class="fa-solid fa-key"></i> My Keys${keys.length ? ` (${keys.length})` : ''}
          </button>
        </div>

        ${activeTab === 'ac' ? `
          <div class="ir-ac-lcd">
            <div>
              <div style="font-size:0.7rem;font-weight:800;letter-spacing:1px;opacity:0.8;">MODE: <span id="acLcdMode">${escHtml(dev._acMode)}</span> &bull; FAN: <span id="acLcdFan">${escHtml(dev._acFan)}</span></div>
              <div class="ir-ac-temp"><span id="acLcdTemp">${dev._acTemp}</span>°C</div>
              <div style="font-size:0.68rem;color:#94a3b8;margin-top:4px;">BEE 24°C Eco Comfort Ready</div>
            </div>
            <i class="fa-solid fa-snowflake fa-spin" style="font-size:2.2rem;opacity:0.75;--fa-animation-duration:8s;"></i>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
            <button class="btn primary" onclick="NARI.app.sendIrCommand(${index}, 'LG', '0x8800909', 28, 'AC Power ON (${dev._acTemp}°C)')"><i class="fa-solid fa-power-off"></i> AC ON</button>
            <button class="btn danger" onclick="NARI.app.sendIrCommand(${index}, 'LG', '0x88C0051', 28, 'AC Power OFF')"><i class="fa-solid fa-power-off"></i> AC OFF</button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
            <button class="btn secondary sm" onclick="NARI.app.stepAcTemp(${index}, -1)"><i class="fa-solid fa-minus"></i> Temp -</button>
            <button class="btn secondary sm" onclick="NARI.app.stepAcTemp(${index}, 0)"><i class="fa-solid fa-leaf" style="color:var(--success);"></i> 24°C Eco</button>
            <button class="btn secondary sm" onclick="NARI.app.stepAcTemp(${index}, 1)"><i class="fa-solid fa-plus"></i> Temp +</button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
            <button class="btn secondary sm" onclick="NARI.app.cycleAcMode(${index})"><i class="fa-solid fa-sliders"></i> Mode</button>
            <button class="btn secondary sm" onclick="NARI.app.cycleAcFan(${index})"><i class="fa-solid fa-fan"></i> Fan Speed</button>
            <button class="btn secondary sm" onclick="NARI.app.sendIrCommand(${index}, 'LG', '0x8813149', 28, 'AC Swing Toggle')"><i class="fa-solid fa-arrows-up-down"></i> Swing</button>
          </div>
        ` : activeTab === 'tv' ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
            <button class="btn danger" onclick="NARI.app.sendIrCommand(${index}, 'NEC', '0x20DF10EF', 32, 'TV Power')"><i class="fa-solid fa-power-off"></i> Power</button>
            <button class="btn secondary" onclick="NARI.app.sendIrCommand(${index}, 'NEC', '0x20DF906F', 32, 'Mute')"><i class="fa-solid fa-volume-xmark"></i> Mute</button>
          </div>
          <div class="ir-dpad-ring">
            <div></div>
            <button class="ir-dpad-btn" onclick="NARI.app.sendIrCommand(${index}, 'NEC', '0x20DF02FD', 32, 'Up')"><i class="fa-solid fa-chevron-up"></i></button>
            <div></div>
            <button class="ir-dpad-btn" onclick="NARI.app.sendIrCommand(${index}, 'NEC', '0x20DFE01F', 32, 'Left')"><i class="fa-solid fa-chevron-left"></i></button>
            <button class="ir-dpad-ok" onclick="NARI.app.sendIrCommand(${index}, 'NEC', '0x20DF22DD', 32, 'OK')">OK</button>
            <button class="ir-dpad-btn" onclick="NARI.app.sendIrCommand(${index}, 'NEC', '0x20DF609F', 32, 'Right')"><i class="fa-solid fa-chevron-right"></i></button>
            <div></div>
            <button class="ir-dpad-btn" onclick="NARI.app.sendIrCommand(${index}, 'NEC', '0x20DF827D', 32, 'Down')"><i class="fa-solid fa-chevron-down"></i></button>
            <div></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
            <div style="background:rgba(255,255,255,0.03);padding:10px;border-radius:12px;border:1px solid var(--card-border);text-align:center;">
              <div style="font-size:0.72rem;font-weight:700;color:var(--text-muted);margin-bottom:6px;">VOLUME</div>
              <div style="display:flex;gap:6px;">
                <button class="btn secondary sm" style="flex:1;" onclick="NARI.app.sendIrCommand(${index}, 'NEC', '0x20DFC03F', 32, 'Volume Down')"><i class="fa-solid fa-minus"></i></button>
                <button class="btn secondary sm" style="flex:1;" onclick="NARI.app.sendIrCommand(${index}, 'NEC', '0x20DF40BF', 32, 'Volume Up')"><i class="fa-solid fa-plus"></i></button>
              </div>
            </div>
            <div style="background:rgba(255,255,255,0.03);padding:10px;border-radius:12px;border:1px solid var(--card-border);text-align:center;">
              <div style="font-size:0.72rem;font-weight:700;color:var(--text-muted);margin-bottom:6px;">CHANNEL</div>
              <div style="display:flex;gap:6px;">
                <button class="btn secondary sm" style="flex:1;" onclick="NARI.app.sendIrCommand(${index}, 'NEC', '0x20DF807F', 32, 'Channel Down')"><i class="fa-solid fa-chevron-down"></i></button>
                <button class="btn secondary sm" style="flex:1;" onclick="NARI.app.sendIrCommand(${index}, 'NEC', '0x20DF00FF', 32, 'Channel Up')"><i class="fa-solid fa-chevron-up"></i></button>
              </div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <button class="btn secondary sm" onclick="NARI.app.sendIrCommand(${index}, 'NEC', '0x20DFD02F', 32, 'Source / Input')"><i class="fa-solid fa-right-to-bracket"></i> Source</button>
            <button class="btn secondary sm" onclick="NARI.app.sendIrCommand(${index}, 'NEC', '0x20DF14EB', 32, 'Back / Exit')"><i class="fa-solid fa-rotate-left"></i> Back</button>
          </div>
        ` : `
          ${keys.length ? `
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
              ${keys.map((k, ki) => `
                <div style="display:flex;gap:8px;align-items:center;">
                  <button class="btn secondary" style="flex:1;text-align:left;" onclick="NARI.app.sendIrKey(${index}, ${ki})">
                    <i class="fa-solid fa-tower-broadcast" style="color:#38bdf8;"></i> ${escHtml(k.name)}
                    <span class="small muted" style="float:right;">${escHtml(k.proto)}</span>
                  </button>
                  <button class="btn danger sm" style="padding:6px 10px;" onclick="NARI.app.deleteIrKey(${index}, ${ki})" title="Delete key"><i class="fa-solid fa-trash"></i></button>
                </div>
              `).join('')}
            </div>
          ` : `<div class="small muted" style="text-align:center;padding:14px 0;">No keys saved yet. Teach a button from your own remote below.</div>`}
          <div style="border-top:1px solid var(--card-border);padding-top:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:0.8rem;font-weight:700;"><i class="fa-solid fa-satellite-dish" style="color:#a78bfa;"></i> Learn a Remote Key</span>
              <span id="irLearnStatus" style="font-size:0.7rem;color:var(--text-muted);">Point remote at the switch</span>
            </div>
            <button class="btn secondary sm" style="width:100%;" id="btnLearnIr" onclick="NARI.app.learnIrCommand(${index})">
              <i class="fa-solid fa-ear-listen"></i> Start Learning (15s window)
            </button>
          </div>
        `}
      `);
    },

    stepAcTemp(index, delta) {
      const dev = store.devices[index];
      if (!dev) return;
      dev._acTemp = delta === 0 ? 24 : Math.max(16, Math.min(30, (dev._acTemp || 24) + delta));
      const el = document.getElementById("acLcdTemp");
      if (el) el.textContent = dev._acTemp;
      const code = "0x8808" + (dev._acTemp - 15).toString(16).toUpperCase() + "05";
      this.sendIrCommand(index, "LG", code, 28, `AC ${dev._acTemp}°C`);
    },

    cycleAcMode(index) {
      const dev = store.devices[index];
      if (!dev) return;
      const modes = ["COOL", "DRY", "FAN", "AUTO"];
      dev._acMode = modes[(modes.indexOf(dev._acMode || "COOL") + 1) % modes.length];
      const el = document.getElementById("acLcdMode");
      if (el) el.textContent = dev._acMode;
      this.sendIrCommand(index, "LG", "0x8808905", 28, `AC Mode: ${dev._acMode}`);
    },

    cycleAcFan(index) {
      const dev = store.devices[index];
      if (!dev) return;
      const fans = ["AUTO", "LOW", "MED", "HIGH"];
      dev._acFan = fans[(fans.indexOf(dev._acFan || "AUTO") + 1) % fans.length];
      const el = document.getElementById("acLcdFan");
      if (el) el.textContent = dev._acFan;
      this.sendIrCommand(index, "LG", "0x8808A05", 28, `AC Fan: ${dev._acFan}`);
    },

    async sendIrCommand(index, proto, hexCode, bits, label) {
      const dev = store.devices[index];
      if (!dev) return;
      const devKey = store.identifierOf(dev);
      let ok = transport.publish(`device/${devKey}/ir/cmd`, `send:${proto}:${hexCode}:${bits}`, { qos: 1 });
      if (!ok && transport.lanAllowed && transport.lanAllowed(dev)) {
        try {
          await transport.lanFetch(transport.lanUrl(dev, "ir", { proto, code: hexCode, bits }), 900);
          ok = true;
        } catch (e) {}
      }
      if (navigator.vibrate) { try { navigator.vibrate(35); } catch (e) {} }
      showToast(ok ? `📡 Sent: ${label}` : "Device offline - IR command not sent", ok ? "ok" : "warn");
    },

    sendIrKey(index, ki) {
      const dev = store.devices[index];
      const k = dev && dev.irKeys && dev.irKeys[ki];
      if (!k) return;
      this.sendIrCommand(index, k.proto, k.code, k.bits, k.name);
    },

    deleteIrKey(index, ki) {
      const dev = store.devices[index];
      if (!dev || !dev.irKeys || !dev.irKeys[ki]) return;
      if (!confirm(`Delete key "${dev.irKeys[ki].name}"?`)) return;
      dev.irKeys.splice(ki, 1);
      dev.updatedAt = Date.now();
      store.save();
      this.openIrRemoteModal(index, 'keys');
    },

    learnIrCommand(index) {
      const dev = store.devices[index];
      if (!dev) return;
      if (!transport.cloudConnected) { showToast("Cloud not connected - cannot start IR learning", "warn"); return; }
      transport.publish(`device/${store.identifierOf(dev)}/ir/cmd`, "learn", { qos: 1 });
      const statusEl = document.getElementById("irLearnStatus");
      if (statusEl) statusEl.innerHTML = '<span style="color:#38bdf8;"><i class="fa-solid fa-spinner fa-spin"></i> Listening... press a remote button</span>';
      clearTimeout(NARI.app._irLearnTimer);
      NARI.app._irLearnTimer = setTimeout(() => {
        const el = document.getElementById("irLearnStatus");
        if (el && /Listening/.test(el.textContent)) el.textContent = "Timed out - try again";
      }, 16000);
    }
  };

  // --- IR learned-key capture (ESP32 publishes "<PROTO>:0x<HEX>:<bits>") ---
  const IR_SENDABLE = ["NEC", "SONY", "RC5", "RC6", "SAMSUNG", "LG", "PANASONIC"];
  bus.on("ir:learned", (e) => {
    const dev = store.devices[e.index];
    if (!dev) return;
    const m = /^([A-Za-z0-9_]+):(0x[0-9A-Fa-f]+):(\d+)$/.exec(String(e.payload || "").trim());
    const el = document.getElementById("irLearnStatus");
    if (!m) { if (el) el.textContent = "Unreadable signal - try again"; return; }
    const proto = m[1].toUpperCase(), code = m[2], bits = parseInt(m[3], 10);
    if (!IR_SENDABLE.includes(proto) || !bits) {
      showToast(`Remote uses an unsupported IR format (${proto}). Try another button.`, "warn");
      if (el) el.textContent = "Unsupported format - try another key";
      return;
    }
    clearTimeout(NARI.app._irLearnTimer);
    const name = (prompt(`Learned ${proto} ${code}.\nName this key (e.g. Power, Vol +):`, "Key " + ((dev.irKeys || []).length + 1)) || "").trim();
    if (!name) { if (el) el.textContent = "Discarded"; return; }
    dev.irKeys = dev.irKeys || [];
    dev.irKeys.push({ name: name.slice(0, 24), proto, code, bits });
    dev.updatedAt = Date.now();
    store.save();
    showToast(`✅ Saved key "${name}"`, "ok");
    NARI.app.openIrRemoteModal(e.index, "keys");
  });

  // --- Subnet Scanner Sheet ---
  dom.btnAdd.onclick = () => {
    openSheet(`
      <div class="sheet-header">
        <div>Add New Switch<span class="sub">Setup Guide &amp; Card Allocation</span></div>
        <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
      </div>

      <div style="background:linear-gradient(135deg, rgba(56,189,248,0.12), rgba(167,139,250,0.12));border:1px solid rgba(56,189,248,0.3);border-radius:14px;padding:14px;margin-bottom:16px;text-align:center;">
        <div style="font-weight:700;font-size:0.92rem;margin-bottom:4px;color:var(--text);">
          <i class="fa-solid fa-wand-magic-sparkles" style="color:var(--accent);"></i> Configure New Smart Card
        </div>
        <p style="font-size:0.75rem;color:var(--text-muted);margin:0 0 10px;line-height:1.4;">
          Set custom card name, allocate room, and set family member supervision roles.
        </p>
        <button class="btn primary" style="width:100%;padding:11px;font-size:0.88rem;display:flex;align-items:center;justify-content:center;gap:7px;box-shadow:0 4px 14px rgba(56,189,248,0.3);" onclick="NARI.app.openNewDeviceModal()">
          <i class="fa-solid fa-plus-circle"></i> <b>Add Smart Card (Name, Room &amp; Roles)</b>
        </button>
      </div>

      <div class="provision-guide">
        <div class="pstep">
          <div class="pstep-icon"><i class="fa-solid fa-plug"></i></div>
          <div class="pstep-body">
            <b>Step 1 — Power ON the Switch</b>
            <p>The device broadcasts a <code>NARI-XXXX</code> Wi-Fi hotspot and is ready for setup.</p>
          </div>
        </div>
        <div class="pstep">
          <div class="pstep-icon"><i class="fa-solid fa-wifi"></i></div>
          <div class="pstep-body">
            <b>Step 2 — Connect to NARI Hotspot</b>
            <p>Go to your phone's <b>Wi-Fi Settings</b> &rarr; tap <code>NARI-XXXX</code> (No password needed).</p>
            <p style="margin-top:5px;">The Wi-Fi credentials page opens automatically on your phone! Select your home Wi-Fi &rarr; enter password &rarr; Save. The device reboots and connects.</p>
            <div style="display:flex;align-items:center;gap:12px;margin-top:10px;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:10px;border:1px solid var(--card-border);">
              <div id="wifiSetupQr" style="background:#fff;padding:4px;border-radius:6px;width:68px;height:68px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"></div>
              <div style="font-size:0.72rem;color:var(--text-muted);line-height:1.4;">
                <b style="color:var(--text);display:block;margin-bottom:2px;"><i class="fa-solid fa-qrcode" style="color:var(--accent);"></i> 1-Tap Wi-Fi Connect:</b>
                Scan this QR code with your phone camera to join the switch Wi-Fi directly without typing!
              </div>
            </div>
          </div>
        </div>
        <div class="pstep">
          <div class="pstep-icon"><i class="fa-solid fa-house-wifi"></i></div>
          <div class="pstep-body">
            <b>Step 3 — Rejoin Home Wi-Fi &amp; Scan</b>
            <p>Switch your phone back to home Wi-Fi, then tap <b>Scan Network</b> below to find your switch.</p>
          </div>
        </div>
      </div>

      <div class="scan-divider">Already know the device IP? Add &amp; Configure</div>

      <div class="manual-ip-row">
        <input type="text" id="manualIp" placeholder="e.g. 192.168.1.10" inputmode="decimal"
               onkeydown="if(event.key==='Enter') NARI.app.addByIp()">
        <button class="btn primary sm" onclick="NARI.app.addByIp()">
          <i class="fa-solid fa-sliders"></i> Configure
        </button>
      </div>
      <div id="manualIpStatus" class="small muted" style="margin-bottom:6px;min-height:18px;"></div>

      <div class="scan-divider">Or scan automatically</div>

      <button class="btn secondary" id="btnStartScan" onclick="NARI.app.runLanScan()">
        <i class="fa-solid fa-magnifying-glass-location"></i>&nbsp; Scan Network
      </button>
      <div class="progress hidden" id="scanProgress"><div id="scanBar"></div></div>
      <div class="found-list" id="scanResults"></div>

      <div class="scan-divider" style="margin-top:14px;">Family &amp; Guest Sharing</div>
      <button class="btn secondary sm" style="width:100%;" onclick="NARI.app.openImportModal()">
        <i class="fa-solid fa-qrcode"></i>&nbsp; Import Switches from Family QR / Code
      </button>
    `);

    setTimeout(() => {
      const qrEl = document.getElementById("wifiSetupQr");
      if (qrEl && typeof QRCode !== "undefined") {
        qrEl.innerHTML = "";
        try {
          new QRCode(qrEl, {
            text: "WIFI:S:NARI-Switch;T:nopass;;",
            width: 60,
            height: 60,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
          });
        } catch(e) {}
      }
    }, 120);
  };

  NARI.app.addByIp = async () => {
    const input = document.getElementById("manualIp");
    const status = document.getElementById("manualIpStatus");
    const ip = (input.value || "").trim();
    if (!ip) { status.textContent = "Enter an IP address first."; return; }
    status.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Connecting to ${ip}...`;
    const data = await transport.probeIp(ip, 2000);
    if (!data) {
      status.innerHTML = `<span style="color:var(--warn);display:block;margin-bottom:6px;"><i class="fa-solid fa-circle-info"></i> No local ping response (device may be cloud-only or in sleep mode).</span>
        <button class="btn primary sm" style="width:100%;" onclick="NARI.app.openNewDeviceModal({ ip: '${escHtml(ip)}' })">
          <i class="fa-solid fa-sliders"></i> Continue Configuring Smart Card
        </button>`;
      return;
    }
    if (store.exists(data.id, ip)) {
      status.innerHTML = `<span style="color:var(--warn)"><i class="fa-solid fa-triangle-exclamation"></i> Device already added.</span>`;
      return;
    }
    NARI.app.openNewDeviceModal({
      ip,
      id: data.id || "",
      name: `Switch ${store.devices.length + 1}`,
      dual: data.relay2 !== undefined || data.dual === true
    });
  };

  NARI.app.runLanScan = async () => {
    const prog = document.getElementById("scanProgress");
    const bar = document.getElementById("scanBar");
    const res = document.getElementById("scanResults");
    const btn = document.getElementById("btnStartScan");

    btn.disabled = true;
    prog.classList.remove("hidden");

    const found = await transport.scanLan((pct) => {
      bar.style.width = `${pct}%`;
    });

    prog.classList.add("hidden");
    btn.disabled = false;

    if (!found.length) {
      res.innerHTML = `<div class="small muted" style="text-align:center;padding:10px 0;">
        No switches found on scan.<br>Try entering the IP manually above (e.g. <b>192.168.1.10</b>)
        or check Subnets in <b>⚙ Settings</b>.
      </div>`;
      return;
    }

    res.innerHTML = found.map(d => `
      <div class="found">
        <div class="meta"><b>${d.id || 'NARI Switch'}</b><small>${d.ip}</small></div>
        <button class="btn sm primary" onclick="NARI.app.adoptDevice('${d.ip}', '${d.id}')">
          <i class="fa-solid fa-sliders"></i> Configure &amp; Add
        </button>
      </div>
    `).join("");
  };

  NARI.app.adoptDevice = (ip, id) => {
    if (!store.exists(id, ip)) {
      NARI.app.openNewDeviceModal({ ip, id, name: `Switch ${store.devices.length + 1}` });
    } else {
      showToast("Device already in dashboard", "info");
    }
  };

  NARI.app.runAutoPairing = async (targetId, targetName) => {
    targetName = targetName || "NARI Switch";
    openSheet(`
      <div class="sheet-header">
        <div>Pairing Switch<span class="sub">Auto-Discovery &amp; Dashboard Setup</span></div>
        <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
      </div>
      <div style="text-align:center;padding:20px 10px;">
        <div style="font-size:2.8rem;color:var(--primary);margin-bottom:14px;">
          <i class="fa-solid fa-satellite-dish fa-bounce"></i>
        </div>
        <h3 style="margin:0 0 6px;" id="pairTitle">Connecting to "${targetName}"...</h3>
        <p class="small muted" id="pairDesc" style="margin-bottom:16px;">
          Scanning your home Wi-Fi network and listening for switch announcement...
        </p>
        <div class="progress" id="pairProgress"><div id="pairBar" style="width: 15%; transition: width 0.3s;"></div></div>
        <div id="pairStatusText" class="small muted" style="margin-top:12px;">Starting network scan...</div>
      </div>
    `);

    let isAdded = false;
    const pairBar = document.getElementById("pairBar");
    const pairStatusText = document.getElementById("pairStatusText");
    const pairDesc = document.getElementById("pairDesc");
    const pairTitle = document.getElementById("pairTitle");

    function markSuccess(device) {
      if (isAdded) return;
      isAdded = true;

      if (pairTitle) pairTitle.innerHTML = `🎉 ${device.name || targetName} Added!`;
      if (pairDesc) pairDesc.innerHTML = `<span style="color:var(--success);font-weight:700;"><i class="fa-solid fa-circle-check"></i> Found at ${device.ip || 'Cloud MQTT'}</span><br>The switch has been added to your dashboard.`;
      if (pairStatusText) pairStatusText.innerHTML = `Ready to control!`;
      if (pairBar) pairBar.style.width = "100%";

      showToast(`🎉 ${device.name || targetName} added to dashboard!`, "ok");
      if (NARI.audio) {
        try { NARI.audio.playFeedback("ok"); } catch (e) {}
      }
      if (navigator.vibrate) navigator.vibrate([60, 40, 100]);

      try {
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
      } catch (e) {}

      setTimeout(() => {
        closeSheet();
      }, 2200);
    }

    // 1. If targetId provided, subscribe specifically on MQTT
    if (targetId && transport.subscribeId) {
      transport.subscribeId(targetId);
    }

    // 2. Listen for unknown device discovery via MQTT (Instant Cloud Discovery)
    const unsubCloud = bus.on("cloud:unknown-device", (ev) => {
      if (isAdded) return;
      if (!targetId || ev.id === targetId) {
        unsubCloud();
        if (!store.exists(ev.id)) {
          const dev = store.add({ name: targetName || `Switch ${store.devices.length + 1}`, id: ev.id, ip: "" });
          renderDeviceCards();
          markSuccess(dev);
        }
      }
    });

    // If device already exists in store, ensure it's marked success
    if (targetId && store.exists(targetId)) {
      const existingIdx = store.findIndex(targetId);
      if (existingIdx !== -1) {
        markSuccess(store.devices[existingIdx]);
        return;
      }
    }

    // 3. Run LAN Subnet Scan (Probes /ping on all subnets)
    try {
      const found = await transport.scanLan((pct, label) => {
        if (pairBar) pairBar.style.width = `${Math.max(15, pct)}%`;
        if (pairStatusText) pairStatusText.textContent = label || `Scanning network (${pct}%)...`;
      });

      if (isAdded) return;

      if (found && found.length > 0) {
        let match = targetId ? found.find(d => d.id === targetId) : null;
        if (!match) match = found.find(d => !store.exists(d.id, d.ip)) || found[0];

        if (match) {
          let dev;
          if (!store.exists(match.id, match.ip)) {
            dev = store.add({ name: targetName || match.name || `Switch ${store.devices.length + 1}`, ip: match.ip, id: match.id || targetId });
          } else {
            const idx = store.findIndex(match.id || match.ip);
            dev = store.devices[idx];
            if (dev && !dev.ip) { dev.ip = match.ip; store.save(); }
          }
          renderDeviceCards();
          markSuccess(dev || { name: targetName, ip: match.ip });
          return;
        }
      }
    } catch (err) {
      console.warn("[AutoPair] LAN scan error:", err);
    }

    // 4. Pre-add targetId if specified so device appears on dashboard
    if (!isAdded) {
      if (targetId) {
        if (!store.exists(targetId)) {
          const dev = store.add({ name: targetName, id: targetId, ip: "" });
          renderDeviceCards();
          markSuccess(dev);
          return;
        }
      } else {
        if (pairStatusText) {
          pairStatusText.innerHTML = `No switch found yet. Make sure your phone is connected to home Wi-Fi and tap <b>+</b> to scan again.`;
        }
      }
    }
  };

  // --- App Settings Sheet ---
  dom.btnSettings.onclick = () => {
    const s = NARI.settings;
    openSheet(`
      <div class="sheet-header">
        <div>Settings<span class="sub">Theme, Tariff &amp; Voice Preferences</span></div>
        <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
      </div>
      ${(window.NARI_LEGAL_UI && window.NARI_LEGAL_UI.makeInIndiaBadgeHtml) ? window.NARI_LEGAL_UI.makeInIndiaBadgeHtml() : ''}
      <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button class="btn" onclick="NARI.app.showAboutApp()"><i class="fa-solid fa-circle-info"></i> About This App</button>
        <button class="btn" onclick="NARI.app.showTerms()"><i class="fa-solid fa-file-contract"></i> Terms &amp; Conditions</button>
      </div>
      <div class="form-group">
        <label>App Theme</label>
        <select id="cfgTheme" onchange="NARI.app.changeTheme(this.value)">
          <option value="default" ${s.theme === 'default' ? 'selected' : ''}>Default Cosmic</option>
          <option value="emerald" ${s.theme === 'emerald' ? 'selected' : ''}>Emerald Forest</option>
          <option value="ocean" ${s.theme === 'ocean' ? 'selected' : ''}>Ocean Blue</option>
          <option value="amber" ${s.theme === 'amber' ? 'selected' : ''}>Warm Amber</option>
          <option value="violet" ${s.theme === 'violet' ? 'selected' : ''}>Royal Violet</option>
          <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Clean Daylight</option>
        </select>
      </div>
      <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div>
          <label><i class="fa-solid fa-language"></i> Voice Language</label>
          <select id="cfgVoiceLang">
            <option value="en-IN" ${(!s.voiceLang || s.voiceLang === 'en-IN') ? 'selected' : ''}>English (en-IN)</option>
            <option value="te-IN" ${s.voiceLang === 'te-IN' ? 'selected' : ''}>తెలుగు (te-IN)</option>
          </select>
        </div>
        <div>
          <label><i class="fa-solid fa-indian-rupee-sign"></i> Electricity Tariff (₹/kWh)</label>
          <input type="number" id="cfgTariffRate" step="0.25" min="1" max="30" value="${s.tariffRate || 7.5}">
        </div>
      </div>
      <details style="margin-bottom:14px;">
        <summary><i class="fa-solid fa-network-wired"></i> Advanced Cloud Broker &amp; LAN Config</summary>
        <div style="margin-top:10px;">
          <div class="form-group">
            <label>Cloud Broker WebSocket URL (wss://)</label>
            <input type="text" id="cfgBroker" value="${s.brokerUrl}">
          </div>
          <div class="form-group">
            <label>LAN API Auth Token</label>
            <input type="text" id="cfgLanToken" value="${s.lanToken}">
          </div>
          <div class="form-group">
            <label>Subnets to Scan</label>
            <input type="text" id="cfgSubnets" value="${s.lanScanSubnets}">
          </div>
        </div>
      </details>
      <button class="btn primary" onclick="NARI.app.saveAppSettings()">Save Configuration</button>
    `);
  };

  NARI.app.changeTheme = theme => applyTheme(theme);
  NARI.app.saveAppSettings = () => {
    const s = NARI.settings;
    s.theme = document.getElementById("cfgTheme").value;
    const vLang = document.getElementById("cfgVoiceLang");
    if (vLang) {
      const langChanged = s.voiceLang !== vLang.value;
      s.voiceLang = vLang.value;
      if (langChanged && sensors._sources && sensors._sources.voice) sensors._toggleSource("voice", false);
    }
    const tariffEl = document.getElementById("cfgTariffRate");
    if (tariffEl) s.tariffRate = Math.max(0.5, Number(tariffEl.value) || 7.5);
    const brokerEl = document.getElementById("cfgBroker");
    if (brokerEl) s.brokerUrl = brokerEl.value.trim();
    const tokenEl = document.getElementById("cfgLanToken");
    if (tokenEl) s.lanToken = tokenEl.value.trim();
    const subEl = document.getElementById("cfgSubnets");
    if (subEl) s.lanScanSubnets = subEl.value.trim();
    if (NARI.saveSettings) NARI.saveSettings();
    store.save();
    sensors.sync();
    transport.connectCloud();
    renderDeviceCards();
    closeSheet();
    showToast("Settings saved!", "ok");
  };

  NARI.app.renderScenesRibbon = renderScenesRibbon;

  NARI.app.openEnergyModal = () => {
    const nowMs = Date.now();
    const tariff = Number(NARI.settings.tariffRate) || 7.5;
    let totalW = 0;
    let totalKwh = 0;
    const rows = store.devices.map(dev => {
      const isOnline = dev.isOnline !== false;
      const isR1On = !!dev.state && isOnline;
      const isR2On = !!dev.state2 && isOnline;
      const w1 = typeof dev.relay1Watts === "number" ? dev.relay1Watts : 12;
      const w2 = typeof dev.relay2Watts === "number" ? dev.relay2Watts : 75;
      const r1Ms = (dev.runtimeMs1 || 0) + (isR1On && dev.lastOnAt1 ? Math.max(0, nowMs - dev.lastOnAt1) : 0);
      const r2Ms = (dev.runtimeMs2 || 0) + (isR2On && dev.lastOnAt2 ? Math.max(0, nowMs - dev.lastOnAt2) : 0);
      const curW = (isR1On ? w1 : 0) + (dev.dual && isR2On ? w2 : 0);
      const kwh = ((w1 * (r1Ms / 3600000)) + (dev.dual ? (w2 * (r2Ms / 3600000)) : 0)) / 1000;
      const cost = kwh * tariff;
      const mins = Math.round((r1Ms + (dev.dual ? r2Ms : 0)) / 60000);
      totalW += curW;
      totalKwh += kwh;
      return { name: dev.name, room: dev.room || "Living Room", curW, kwh, cost, mins };
    });
    const totalCost = totalKwh * tariff;

    openSheet(`
      <div class="sheet-header">
        <div>Home Energy &amp; Bill Monitor<span class="sub">Tariff: ₹${tariff}/kWh &bull; Today's Estimate</span></div>
        <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;text-align:center;">
        <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);padding:10px;border-radius:12px;">
          <div style="font-size:1.1rem;font-weight:800;color:#10b981;">${totalW} W</div>
          <div class="small muted">Live Load</div>
        </div>
        <div style="background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.3);padding:10px;border-radius:12px;">
          <div style="font-size:1.1rem;font-weight:800;color:#38bdf8;">₹${totalCost.toFixed(2)}</div>
          <div class="small muted">${totalKwh.toFixed(2)} kWh Today</div>
        </div>
        <div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);padding:10px;border-radius:12px;">
          <div style="font-size:1.1rem;font-weight:800;color:#f59e0b;">~₹${Math.round(totalCost * 30)}</div>
          <div class="small muted">30-Day Est.</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
        ${rows.map(r => {
          const pct = totalKwh > 0 ? Math.min(100, Math.round((r.kwh / totalKwh) * 100)) : 0;
          return `
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--card-border);padding:10px 12px;border-radius:12px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <b>${escHtml(r.name)} <span class="small muted">(${escHtml(r.room)})</span></b>
                <span style="font-weight:800;color:var(--accent);">₹${r.cost.toFixed(2)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--text-muted);margin-bottom:5px;">
                <span>Active: ${r.curW}W &bull; Runtime: ${r.mins}m</span>
                <span>${r.kwh.toFixed(3)} kWh (${pct}%)</span>
              </div>
              <div style="height:5px;background:rgba(255,255,255,0.06);border-radius:999px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--primary),var(--accent));"></div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `);
  };

  // --- About App & Terms viewers (text lives in js/legal-content.js) ---
  function openLegalSheet(title, sub, bodyHtml, extraHtml) {
    const ui = window.NARI_LEGAL_UI;
    if (ui && ui.styles) ui.styles();
    openSheet(`
      <div class="sheet-header">
        <div>${title}<span class="sub">${sub}</span></div>
        <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
      </div>
      <div class="lg-body" style="max-height:62vh;overflow-y:auto;padding:0 2px 8px;">${bodyHtml}</div>
      ${extraHtml || ""}
      <div class="btn-row" style="margin-top:10px;">
        <button class="btn" onclick="NARI.app.openAppSettings()"><i class="fa-solid fa-arrow-left"></i> Back to Settings</button>
      </div>
    `);
  }
  NARI.app.openAppSettings = () => { if (dom.btnSettings && dom.btnSettings.onclick) dom.btnSettings.onclick(); };
  NARI.app.showAboutApp = () => {
    const ui = window.NARI_LEGAL_UI;
    if (!ui) return;
    openLegalSheet("About NARI Smart Home", "What this app can do for you", ui.aboutHtml(),
      `<div class="btn-row" style="margin-top:8px;"><button class="btn" onclick="NARI.app.showTerms()"><i class="fa-solid fa-file-contract"></i> Terms &amp; Conditions</button></div>`);
  };
  NARI.app.showTerms = () => {
    const ui = window.NARI_LEGAL_UI;
    if (!ui) return;
    const at = ui.acceptedAt();
    const when = at ? `You accepted these Terms on ${new Date(at).toLocaleString()}.` : "";
    openLegalSheet("Terms & Conditions", `Version ${ui.version}`, ui.termsHtml(),
      `${when ? `<p class="lg-p lg-muted" style="margin:8px 2px 0;">${when}</p>` : ""}
       <p class="lg-p" style="margin:4px 2px 0;">Privacy Policy: <a class="lg-link" target="_blank" rel="noopener" href="${ui.privacyUrl}">${ui.privacyUrl.replace("https://", "")}</a></p>`);
  };

  NARI.app.setBottomTab = (tab) => {
    document.querySelectorAll(".bnav-item").forEach(b => b.classList.remove("active"));
    const map = { home: "bnavHome", scenes: "bnavScenes", energy: "bnavEnergy", family: "bnavFamily", settings: "bnavSettings" };
    const activeBtn = document.getElementById(map[tab] || "bnavHome");
    if (activeBtn) activeBtn.classList.add("active");

    if (tab === "home") {
      closeSheet();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (tab === "scenes") {
      if (NARI.scenes && typeof NARI.scenes.openScenesHub === "function") NARI.scenes.openScenesHub();
    } else if (tab === "energy") {
      NARI.app.openEnergyModal();
    } else if (tab === "family") {
      if (NARI.sharing && typeof NARI.sharing.openSidebar === "function") NARI.sharing.openSidebar();
      else NARI.app.openShareModal();
    } else if (tab === "settings") {
      if (dom.btnSettings && dom.btnSettings.onclick) dom.btnSettings.onclick();
    }
  };

  // 1-Second Live Countdown & Energy Ticker (updates active timers & live wattage/cost without DOM reflow)
  setInterval(() => {
    let anyActive = false;
    store.devices.forEach((dev, i) => {
      const slot = document.getElementById(`timer-slot-${i}`);
      if (slot) {
        const html = formatRemainingTimer(dev);
        if (slot.innerHTML !== html) slot.innerHTML = html;
      }
      if ((dev.state || dev.state2) && dev.isOnline !== false) anyActive = true;
    });
    if (anyActive) renderHomePulseBar();
  }, 1000);

  // --- Diagnostics Sheet ---
  dom.btnDiag.onclick = () => {
    const diag = transport.diagnostics();
    openSheet(`
      <div class="sheet-header">
        <div>Diagnostics<span class="sub">Pipeline Telemetry</span></div>
        <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
      </div>
      <div class="diag">
        ${diag.length ? diag.map(d => `<div class="${d.level}"><span>${d.level.toUpperCase()}</span>${d.text}</div>`).join("") : '<div>All connection pipelines operational.</div>'}
      </div>
    `);
  };

  // --- LAN Mixed-Content Helper ---
  function showLanUnlockBanner() {
    if (!dom.banners || document.getElementById("lanUnlockBanner")) return;
    const b = document.createElement("div");
    b.className = "banner info";
    b.id = "lanUnlockBanner";
    b.innerHTML = `
      <i class="fa-solid fa-bolt-lightning"></i>
      <div>
        <b>Enable Ultra-Fast Local LAN Mode:</b><br>
        Your browser blocks direct local Wi-Fi from HTTPS sites by default.
        <a href="javascript:void(0)" onclick="NARI.app.showLanUnlockModal()" style="display:inline-block;margin-top:4px;">Learn how to unlock in 1 tap &rarr;</a>
      </div>
      <button class="close" onclick="this.parentElement.remove()">✕</button>
    `;
    dom.banners.appendChild(b);
  }
  bus.on("lan:blocked", showLanUnlockBanner);

  NARI.app.showLanUnlockModal = () => {
    openSheet(`
      <div class="sheet-header">
        <div>Enable Fast LAN Mode<span class="sub">1-Tap Browser Setting</span></div>
        <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
      </div>
      <div style="font-size:0.86rem;line-height:1.5;color:var(--text);">
        <p>Because this app runs over secure <b>HTTPS</b> (GitHub Pages), browsers block background calls to local <code>http://192.168.x.x</code> switches by default.</p>
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:14px;margin:14px 0;">
          <b style="color:var(--brand);display:block;margin-bottom:8px;"><i class="fa-brands fa-chrome"></i> For Chrome / Android / Edge:</b>
          <ol style="margin-left:18px;margin-bottom:0;">
            <li>Tap the <b>🔒 lock / tuning</b> icon in your browser's address bar.</li>
            <li>Tap <b>Permissions</b> or <b>Site settings</b>.</li>
            <li>Find <b>Insecure content</b> &rarr; change it to <b>Allow</b>.</li>
            <li>Reload the page &mdash; direct LAN mode is now permanently active!</li>
          </ol>
        </div>
        <div class="small muted" style="margin-top:10px;">
          <i class="fa-solid fa-cloud"></i> <b>Don't want to change settings?</b> No problem! The app communicates seamlessly with all your switches via Oracle Cloud MQTT.
        </div>
      </div>
    `);
  };

  // --- Firebase Web Auth Integration (Zero-Cost Shield) ---
  if (store.auth) {
    store.auth.onAuthStateChanged(user => {
      store.currentUser = user;
      if (user) {
        dom.authContainer.innerHTML = `
          <button class="btn-auth" onclick="NARI.app.openUserMenu()" title="Account & Sync">
            <img class="user-avatar" src="${user.photoURL || 'https://via.placeholder.com/20'}" alt="">
            <span>${(user.displayName || user.email || 'User').split(' ')[0]}</span>
          </button>
        `;
        // ZERO-COST SHIELD: Only read from Firestore if this phone has 0 user-saved devices (brand new phone/login)
        // Existing customers load instantly from phone storage with 0 Firebase read charges.
        if (store.devices.length === 0 || (typeof store.isDefaultShowcaseOnly === "function" && store.isDefaultShowcaseOnly())) {
          store.loadCloud();
        }
      } else {
        dom.authContainer.innerHTML = `
          <button class="btn-auth" id="btnLogin" onclick="NARI.app.signIn()">
            <i class="fa-brands fa-google"></i> Login
          </button>
        `;
      }
    });
  }

  NARI.app.openUserMenu = () => {
    const user = store.currentUser;
    if (!user) return;
    openSheet(`
      <div class="sheet-header">
        <div>Account &amp; Sync<span class="sub">${user.email || 'Google Account'}</span></div>
        <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:12px;background:rgba(255,255,255,0.05);border-radius:12px;">
        <img src="${user.photoURL || 'https://via.placeholder.com/48'}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;">
        <div>
          <b style="display:block;">${user.displayName || 'User'}</b>
          <span class="small muted">${user.email}</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button class="btn secondary" onclick="store.loadCloud(true); NARI.app.closeSheet();">
          <i class="fa-solid fa-arrows-rotate"></i> Sync Switches from Cloud
        </button>
        <button class="btn secondary" onclick="store.save(); showToast('Saved to Cloud', 'ok'); NARI.app.closeSheet();">
          <i class="fa-solid fa-cloud-arrow-up"></i> Backup to Cloud Now
        </button>
        <button class="btn" style="background:rgba(239,68,68,0.18);color:#fca5a5;margin-top:6px;" onclick="NARI.app.signOut(); NARI.app.closeSheet();">
          <i class="fa-solid fa-arrow-right-from-bracket"></i> Sign Out
        </button>
      </div>
    `);
  };

  NARI.app.openAuthModal = () => {
    openSheet(`
      <div class="sheet-header">
        <div>Customer Account<span class="sub">Sign in to backup &amp; sync your switches</span></div>
        <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;padding-top:4px;">
        <button class="btn primary" style="background:#fff;color:#1e293b;font-weight:600;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 2px 8px rgba(0,0,0,0.15);" onclick="NARI.app.signInGoogle()">
          <i class="fa-brands fa-google" style="color:#ea4335;font-size:18px;"></i> Continue with Google
        </button>
        <div style="text-align:center;font-size:11px;color:rgba(255,255,255,0.4);margin:6px 0;letter-spacing:1px;font-weight:600;">
          ─── OR WITH EMAIL ───
        </div>
        <div class="form-group" style="margin-bottom:8px;">
          <label>Email Address</label>
          <input type="email" id="authEmail" placeholder="customer@example.com" autocomplete="email">
        </div>
        <div class="form-group" style="margin-bottom:8px;">
          <label>Password</label>
          <input type="password" id="authPassword" placeholder="••••••••" autocomplete="current-password">
        </div>
        <div style="display:flex;gap:10px;margin-top:6px;">
          <button class="btn secondary" style="flex:1;" onclick="NARI.app.signInEmail(false)">
            <i class="fa-solid fa-arrow-right-to-bracket"></i> Sign In
          </button>
          <button class="btn secondary" style="flex:1;" onclick="NARI.app.signInEmail(true)">
            <i class="fa-solid fa-user-plus"></i> Register
          </button>
        </div>
        <button class="btn" style="background:none;border:none;color:var(--text-muted,#94a3b8);font-size:12px;cursor:pointer;padding:6px;text-align:center;" onclick="NARI.app.forgotPassword()">
          Forgot Password?
        </button>
      </div>
    `);
  };

  NARI.app.signInGoogle = async () => {
    if (!store.auth) return showToast("Firebase Auth not loaded", "error");
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await store.auth.signInWithPopup(provider);
      closeSheet();
      showToast("Signed in with Google", "ok");
    } catch (e) {
      if (e.code === "auth/popup-blocked" || e.code === "auth/cancelled-popup-request") {
        store.auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider());
      } else {
        showToast(e.message || "Google Sign-in failed", "error");
      }
    }
  };

  NARI.app.signInEmail = async (isNew = false) => {
    if (!store.auth) return showToast("Firebase Auth not loaded", "error");
    const email = (document.getElementById("authEmail")?.value || "").trim();
    const pass = (document.getElementById("authPassword")?.value || "").trim();
    if (!email || !pass) return showToast("Please enter email & password", "warn");
    try {
      if (isNew) {
        await store.auth.createUserWithEmailAndPassword(email, pass);
        showToast("Account created successfully!", "ok");
      } else {
        await store.auth.signInWithEmailAndPassword(email, pass);
        showToast("Signed in successfully", "ok");
      }
      closeSheet();
    } catch (e) {
      showToast(e.message || "Authentication failed", "error");
    }
  };

  NARI.app.forgotPassword = async () => {
    if (!store.auth) return;
    const email = (document.getElementById("authEmail")?.value || "").trim();
    if (!email) return showToast("Enter your email above first", "warn");
    try {
      await store.auth.sendPasswordResetEmail(email);
      showToast("Password reset link sent to " + email, "ok");
    } catch (e) {
      showToast(e.message || "Could not send reset link", "error");
    }
  };

  NARI.app.signIn = () => NARI.app.openAuthModal();
  NARI.app.signOut = () => store.auth && store.auth.signOut();

  // --- Master Controls (Option 3: Room-Scoped when a Room Pill is selected) ---
  NARI.app.allOff = async () => {
    if (!store.devices.length) return;
    const scopeLabel = currentRoomFilter && currentRoomFilter !== "all" ? currentRoomFilter : "all switches";
    showToast(`Turning OFF ${scopeLabel}...`, "info");
    await transport.allOff(currentRoomFilter);
    renderDeviceCards();
    showToast(`Turned OFF ${scopeLabel}`, "ok");
  };

  NARI.app.allOn = async () => {
    if (!store.devices.length) return;
    const scopeLabel = currentRoomFilter && currentRoomFilter !== "all" ? currentRoomFilter : "all switches";
    showToast(`Turning ON ${scopeLabel}...`, "info");
    await transport.allOn(currentRoomFilter);
    renderDeviceCards();
    showToast(`Turned ON ${scopeLabel}`, "ok");
  };

  // --- One-Tap QR Share for Family & Guests (Option 2) ---
  NARI.app.openShareModal = () => {
    if (!store.devices.length) {
      showToast("Add at least one switch before sharing", "warn");
      return;
    }
    const cleanList = store.devices.map(d => ({
      name: d.name,
      ip: d.ip,
      id: d.id,
      room: d.room || "Living Room",
      dual: d.dual !== false,
      relay1Name: d.relay1Name || "Ceiling Light",
      relay2Name: d.relay2Name || "Ceiling Fan",
      relay1Icon: d.relay1Icon || "bulb",
      relay2Icon: d.relay2Icon || "fan"
    }));
    const rawStr = JSON.stringify(cleanList);
    const shareCode = btoa(unescape(encodeURIComponent(rawStr)));

    openSheet(`
      <div class="sheet-header">
        <div>Family &amp; Guest Share<span class="sub">1-Tap Instant Sync</span></div>
        <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
      </div>
      <p class="small muted" style="text-align:center;margin-bottom:6px;">
        Family members or guests can scan this QR code with their phone camera to instantly add your home switches.
      </p>
      <div class="qr-container" id="shareQrTarget"></div>
      <div class="small muted" style="text-align:center;margin-bottom:4px;">Or copy share code to send via WhatsApp:</div>
      <div class="share-code-box" id="shareCodeText">${shareCode}</div>
      <div style="display:flex;gap:8px;">
        <button class="btn primary sm" style="flex:1;" onclick="NARI.app.copyShareCode('${shareCode}')">
          <i class="fa-solid fa-copy"></i> Copy Code
        </button>
        <button class="btn secondary sm" style="flex:1;" onclick="NARI.app.openImportModal()">
          <i class="fa-solid fa-file-import"></i> Import Code
        </button>
      </div>
    `);

    setTimeout(() => {
      const target = document.getElementById("shareQrTarget");
      if (target && typeof QRCode !== "undefined") {
        target.innerHTML = "";
        try {
          new QRCode(target, {
            text: "nari:" + shareCode,
            width: 160,
            height: 160,
            colorDark: "#0b1a13",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
          });
        } catch (e) {
          console.warn("QR render failed", e);
        }
      }
    }, 100);
  };

  NARI.app.copyShareCode = (code) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => showToast("Share code copied to clipboard!", "ok"));
    } else {
      showToast("Code copied!", "ok");
    }
  };

  NARI.app.openImportModal = () => {
    openSheet(`
      <div class="sheet-header">
        <div>Import Family Switches<span class="sub">QR or Share Code</span></div>
        <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
      </div>
      <p class="small muted" style="margin-bottom:10px;">
        Paste the share code sent by the home owner to add all switches instantly:
      </p>
      <div class="form-group">
        <textarea id="importCodeInput" rows="3" placeholder="Paste share code here..." style="width:100%;resize:none;font-family:ui-monospace,Menlo,monospace;font-size:0.75rem;padding:8px;border-radius:10px;background:rgba(0,0,0,0.3);border:1px solid var(--card-border);color:var(--text);"></textarea>
      </div>
      <button class="btn primary" style="width:100%;margin-top:4px;" onclick="NARI.app.importShareCode()">
        <i class="fa-solid fa-file-import"></i> Import Switches
      </button>
    `);
  };

  NARI.app.importShareCode = () => {
    const raw = (document.getElementById("importCodeInput")?.value || "").trim();
    if (!raw) { showToast("Please paste a share code first.", "warn"); return; }
    try {
      let cleanStr = raw.startsWith("nari:") ? raw.slice(5) : raw;
      const decoded = decodeURIComponent(escape(atob(cleanStr)));
      const items = JSON.parse(decoded);
      if (!Array.isArray(items) || !items.length) throw new Error("Invalid format");
      let count = 0;
      items.forEach(item => {
        if (!store.exists(item.id, item.ip)) {
          store.add({
            name: item.name || "Switch",
            ip: item.ip || "",
            id: item.id || "",
            room: item.room || "Living Room",
            dual: item.dual !== false,
            relay1Name: item.relay1Name || "Ceiling Light",
            relay2Name: item.relay2Name || "Ceiling Fan",
            relay1Icon: item.relay1Icon || "bulb",
            relay2Icon: item.relay2Icon || "fan"
          });
          count++;
        }
      });
      renderDeviceCards();
      closeSheet();
      showToast(`✅ Successfully imported ${count} switch(es)!`, "ok");
    } catch (e) {
      showToast("Invalid share code. Check and try again.", "error");
    }
  };

  if (dom.btnScenes) {
    dom.btnScenes.onclick = () => {
      if (NARI.scenes && typeof NARI.scenes.openScenesHub === "function") {
        NARI.scenes.openScenesHub();
      }
    };
  }

  if (dom.btnShare) {
    dom.btnShare.onclick = () => NARI.app.openShareModal();
  }

  // --- Pull-To-Refresh & Manual Dashboard Refresh ---
  let isRefreshing = false;
  async function triggerRefresh(showFeedback = true) {
    if (isRefreshing) return;
    isRefreshing = true;

    const btnRefreshIcon = dom.btnRefresh ? dom.btnRefresh.querySelector("i") : null;
    if (btnRefreshIcon) btnRefreshIcon.classList.add("fa-spin");

    if (dom.ptrSpinner) dom.ptrSpinner.classList.remove("hidden");
    if (dom.ptrIcon) dom.ptrIcon.classList.add("hidden");
    if (dom.ptrText) dom.ptrText.textContent = "Checking devices & status...";

    try {
      if (transport && !transport.cloudConnected) {
        transport.connectCloud();
      }
      await transport.pollAll();
      sensors.sync();
      renderDeviceCards();
      renderStatus();

      if (dom.ptrText) dom.ptrText.textContent = "✓ Devices online & updated";
      if (showFeedback) showToast("Refreshed: device status updated", "ok");
    } catch (e) {
      console.warn("Refresh failed:", e);
      if (dom.ptrText) dom.ptrText.textContent = "Refresh completed";
    } finally {
      setTimeout(() => {
        if (dom.pullToRefresh) {
          dom.pullToRefresh.classList.remove("dragging", "ready");
          dom.pullToRefresh.style.height = "0";
        }
        setTimeout(() => {
          if (dom.ptrSpinner) dom.ptrSpinner.classList.add("hidden");
          if (dom.ptrIcon) dom.ptrIcon.classList.remove("hidden");
          if (dom.ptrText) dom.ptrText.textContent = "Pull down to refresh";
          if (btnRefreshIcon) btnRefreshIcon.classList.remove("fa-spin");
          isRefreshing = false;
        }, 300);
      }, 500);
    }
  }

  NARI.app.refresh = () => triggerRefresh(true);
  if (dom.btnRefresh) {
    dom.btnRefresh.onclick = () => triggerRefresh(true);
  }

  (function initPullToRefresh() {
    let startY = 0;
    let currentY = 0;
    let isPulling = false;
    let vibrated = false;
    const THRESHOLD = 65;

    function onStart(y, target) {
      if (window.scrollY > 2 || (dom.overlay && (dom.overlay.classList.contains("show") || dom.overlay.classList.contains("open")))) return false;
      if (target && target.closest && target.closest("button, a, input, select, textarea, .card, .node-card, .relay-tile, .room-pill, .sheet, .icon-box, .toggle")) {
        return false;
      }
      startY = y;
      currentY = y;
      isPulling = true;
      vibrated = false;
      if (dom.pullToRefresh) dom.pullToRefresh.classList.add("dragging");
      return true;
    }

    function onMove(y) {
      if (!isPulling || isRefreshing) return;
      if (window.scrollY > 2) {
        isPulling = false;
        if (dom.pullToRefresh) {
          dom.pullToRefresh.classList.remove("dragging", "ready");
          dom.pullToRefresh.style.height = "0";
        }
        return;
      }
      currentY = y;
      const diff = currentY - startY;
      if (diff > 0) {
        const pullDist = Math.min(85, Math.pow(diff, 0.85) * 1.4);
        if (dom.pullToRefresh) dom.pullToRefresh.style.height = `${pullDist}px`;
        if (pullDist >= THRESHOLD) {
          if (dom.pullToRefresh && !dom.pullToRefresh.classList.contains("ready")) {
            dom.pullToRefresh.classList.add("ready");
            if (dom.ptrText) dom.ptrText.textContent = "Release to refresh";
            if (!vibrated && NARI.settings.hapticFeedback && navigator.vibrate) {
              try { navigator.vibrate(25); } catch (e) {}
              vibrated = true;
            }
          }
        } else {
          if (dom.pullToRefresh && dom.pullToRefresh.classList.contains("ready")) {
            dom.pullToRefresh.classList.remove("ready");
            if (dom.ptrText) dom.ptrText.textContent = "Pull down to refresh";
            vibrated = false;
          }
        }
      } else {
        if (dom.pullToRefresh) dom.pullToRefresh.style.height = "0";
      }
    }

    function onEnd() {
      if (!isPulling) return;
      isPulling = false;
      if (dom.pullToRefresh) dom.pullToRefresh.classList.remove("dragging");
      const currentHeight = parseFloat(dom.pullToRefresh ? dom.pullToRefresh.style.height || "0" : "0");
      if (currentHeight >= THRESHOLD && !isRefreshing) {
        if (dom.pullToRefresh) dom.pullToRefresh.style.height = "48px";
        triggerRefresh(false);
      } else {
        if (dom.pullToRefresh) {
          dom.pullToRefresh.classList.remove("ready");
          dom.pullToRefresh.style.height = "0";
        }
      }
    }

    window.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) onStart(e.touches[0].clientY, e.target);
    }, { passive: true });

    window.addEventListener("touchmove", (e) => {
      if (isPulling && e.touches.length === 1) onMove(e.touches[0].clientY);
    }, { passive: true });

    window.addEventListener("touchend", () => onEnd(), { passive: true });
    window.addEventListener("touchcancel", () => onEnd(), { passive: true });

    window.addEventListener("mousedown", (e) => {
      if (e.button === 0) onStart(e.clientY, e.target);
    });
    window.addEventListener("mousemove", (e) => {
      if (isPulling) onMove(e.clientY);
    });
    window.addEventListener("mouseup", () => onEnd());
  })();

  // --- PWA Installation Event ---
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    dom.btnInstall.classList.add("show");
  });
  dom.btnInstall.onclick = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === "accepted") dom.btnInstall.classList.remove("show");
    deferredInstallPrompt = null;
  };

  // --- Check PWA Home Screen Shortcuts & Auto-Pairing (?action=all-off / ?action=all-on / ?toggle=<id>&relay=1|2 / ?action=pair) ---
  (function checkShortcuts() {
    const params = new URLSearchParams(window.location.search);
    const action = params.get("action");
    const toggleId = params.get("toggle");
    if (toggleId) {
      const relayNum = Number(params.get("relay")) === 2 ? 2 : 1;
      const desired = params.get("state");
      setTimeout(() => {
        const idx = store.findIndex(toggleId);
        if (idx !== -1) {
          if (desired === "on" || desired === "1") transport.setState(idx, true, { relay: relayNum, source: "shortcut" });
          else if (desired === "off" || desired === "0") transport.setState(idx, false, { relay: relayNum, source: "shortcut" });
          else NARI.app.toggleRelay(idx, relayNum);
        }
      }, 650);
    } else if (action === "all-off") {
      setTimeout(() => NARI.app.allOff(), 700);
    } else if (action === "all-on") {
      setTimeout(() => NARI.app.allOn(), 700);
    } else if (action === "pair" || params.get("pair") === "auto" || action === "scan") {
      const targetId = params.get("id");
      const targetName = params.get("name") || "NARI Switch";
      setTimeout(() => NARI.app.runAutoPairing(targetId, targetName), 800);
    }
  })();

  // --- Event Bus Subscriptions ---
  bus.on("devices:changed", () => renderDeviceCards());
  bus.on("device:updated", (index) => {
    if (typeof index === "number") updateDeviceCardInPlace(index);
    else renderDeviceCards();
  });
  bus.on("cloud:state", () => renderStatus());
  bus.on("poll:done", () => renderStatus());
  bus.on("geofence:distance", (ev) => {
    const distEl = document.getElementById("geoLiveDistanceVal");
    const stEl = document.getElementById("geoLiveStatusBadge");
    if (distEl && ev) {
      const d = ev.distance;
      distEl.textContent = d < 10 ? `${d.toFixed(1)} meters` : `${Math.round(d)} meters`;
    }
    if (stEl && ev) {
      if (ev.isInside) {
        stEl.innerHTML = '<span style="color:var(--success);font-weight:700;"><i class="fa-solid fa-circle-check"></i> Inside Room (Light ON) 🟢</span>';
      } else {
        stEl.innerHTML = '<span style="color:var(--text-muted);font-weight:700;"><i class="fa-solid fa-circle"></i> Out of Room (Light OFF) ⚪</span>';
      }
    }
  });

  // --- Master Action Buttons ---
  if (dom.btnMasterOn) dom.btnMasterOn.onclick = () => NARI.app.allOn();
  if (dom.btnMasterOff) dom.btnMasterOff.onclick = () => NARI.app.allOff();
  if (dom.btnMasterAdd) dom.btnMasterAdd.onclick = () => dom.btnAdd.click();

  // --- Initialization ---
  applyTheme(NARI.settings.theme);
  transport.connectCloud();
  sensors.sync();
  renderDeviceCards();
  renderStatus();

  setInterval(() => transport.pollAll(), 7500);
})(window);
