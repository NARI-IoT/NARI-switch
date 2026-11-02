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
    btnScenes: document.getElementById("btnScenes"),
    btnShare: document.getElementById("btnShare"),
    btnSettings: document.getElementById("btnSettings"),
    btnAdd: document.getElementById("btnAdd"),
    btnInstall: document.getElementById("btnInstall")
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


  // --- Status Strip & Diagnostics ---
  function renderStatus() {
    const diag = transport.diagnostics();
    const hasError = diag.some(d => d.level === "error");
    dom.diagDot.classList.toggle("hidden", !hasError);

    let html = "";
    const cState = transport.cloudState;
    const cOk = cState === "connected";
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

  // --- Device Card Rendering ---
  function renderDeviceCards() {
    if (!store.devices.length) {
      dom.deviceList.innerHTML = `
        <div class="empty">
          <div class="big"><i class="fa-solid fa-house-signal"></i></div>
          <h3>Welcome to NARI Home</h3>
          <p class="small muted" style="margin-bottom:18px;">Get your smart switch up and running in 3 easy steps.</p>
          <div class="welcome-guide">
            <div class="wstep">
              <span class="wnum">1</span>
              <div>
                <b>Power ON the NARI Switch</b>
                <p>The device creates a Wi-Fi hotspot called <code>NARI-Switch-XXXX</code></p>
              </div>
            </div>
            <div class="wstep">
              <span class="wnum">2</span>
              <div>
                <b>Connect &amp; Configure via Captive Portal</b>
                <p>Go to <b>Android Wi-Fi Settings</b> &rarr; connect to <code>NARI-Switch-XXXX</code></p>
                <p class="wpill"><i class="fa-solid fa-key"></i>&nbsp; Password: <code>nariSetup2026</code></p>
                <p>A setup page opens automatically &rarr; select your home Wi-Fi &rarr; enter password &rarr; Save. The device reboots and joins your network.</p>
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

    dom.deviceList.innerHTML = store.devices.map((dev, i) => {
      const isOnline = dev.isOnline !== false;
      const isVerifying = !!dev._isVerifying;
      // Guard: if bgPhoto is invalid/broken, clear it so card doesn't show broken image
      const hasBg = !!dev.bgPhoto && /^https?:\/\//.test(dev.bgPhoto);
      // Guard: if name was accidentally stored as a URL or is empty, show safe fallback
      const safeName = (dev.name && !/^https?:\/\//.test(dev.name))
        ? dev.name.replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))
        : 'Switch ' + (i + 1);
      const activeTriggers = Object.keys(dev.triggers || {}).filter(k => dev.triggers[k].enabled);

      return `
        <div class="card-wrapper" id="dev-${i}">
          <div class="card ${dev.state && isOnline ? 'on' : ''} ${!isOnline ? 'offline' : ''} ${hasBg ? 'has-bg' : ''}" 
               style="${hasBg ? `background-image:url('${dev.bgPhoto}')` : ''}"
               onclick="NARI.app.openSettingsModal(${i})">
            
            <div class="card-top">
              <div class="icon-box ${dev.state && isOnline ? 'on' : ''}" 
                   onclick="event.stopPropagation(); NARI.app.toggleRelay(${i})">
                <i class="fa-solid ${!isOnline ? 'fa-plug-circle-xmark' : (dev.state ? 'fa-lightbulb' : 'fa-power-off')}"></i>
              </div>
              
              <label class="toggle ${!isOnline ? 'disabled' : ''} ${isVerifying ? 'verifying' : ''}" 
                     onclick="event.stopPropagation();">
                <input type="checkbox" ${dev.state ? 'checked' : ''} onchange="NARI.app.toggleRelay(${i})">
                <span class="track"></span>
              </label>
            </div>

            <div class="card-info">
              <h3>${safeName}</h3>
              <p>
                ${(() => {
                  const link = dev.link || (transport.lanFresh(dev) ? 'lan' : (transport.cloudConnected ? 'cloud' : 'none'));
                  if (link === 'lan')         return `<span class="link-tag lan">LAN</span>`;
                  if (link === 'lan-grace')   return `<span class="link-tag lan" style="opacity:.7" title="Last seen on LAN — recovering">LAN ⟳</span>`;
                  if (link === 'cloud')       return `<span class="link-tag cloud">Cloud</span>`;
                  if (link === 'cloud-unverified') return `<span class="link-tag cloud" style="opacity:.7">Cloud ·</span>`;
                  return `<span class="link-tag none">Offline</span>`;
                })()} 
                ${dev.lanRssi ? `<span class="small muted">${dev.lanRssi} dBm</span>` : ''}
              </p>
            </div>

            <div class="card-bottom">
              <button class="trigger-btn" onclick="event.stopPropagation(); NARI.app.openTriggerModal(${i})">
                <i class="fa-solid fa-bolt"></i> Triggers
                ${activeTriggers.length ? `<span class="count">${activeTriggers.length}</span>` : ''}
              </button>
              <div class="active-chips">
                ${activeTriggers.slice(0, 3).map(t => `<i class="fa-solid fa-circle-dot" title="${t}"></i>`).join('')}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join("");
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

  // Real-time voice monitor hook
  bus.on("voice:heard", e => {
    const el = document.getElementById("voiceHeardText");
    if (el && e && e.text) el.innerText = `"${e.text}"`;
  });

  // --- Exposed App Methods ---
  NARI.app = {
    closeSheet,
    openSheet,

    async toggleRelay(index) {
      const dev = store.devices[index];
      if (!dev) return;
      await transport.setState(index, !dev.state);
    },

    openSettingsModal(index) {
      const dev = store.devices[index];
      openSheet(`
        <div class="sheet-header">
          <div>${dev.name}<span class="sub">${dev.id || dev.ip || 'Device Config'}</span></div>
          <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
        </div>
        <div class="form-group">
          <label>Appliance Name</label>
          <input type="text" id="devName" value="${dev.name}">
        </div>
        <div class="form-group">
          <label>Device IP Address (from Wi-Fi / Fing)</label>
          <input type="text" id="devIp" value="${dev.ip || ''}" placeholder="e.g. 192.168.1.105">
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
          <input type="url" id="bgPhotoUrl" value="${dev.bgPhoto || ''}" placeholder="https://...">
        </div>
        <div class="ota-box" id="otaBox">
          <div class="ota-header">
            <div class="ota-title"><i class="fa-solid fa-microchip"></i> Device Firmware</div>
            <span class="ota-ver-tag" id="otaCurrentVer">v${dev.fw || "1.0.0"}</span>
          </div>
          <div id="otaContent">
            <button class="btn secondary sm" style="width:100%;" id="btnCheckUpdate" onclick="NARI.app.checkFirmwareUpdate(${index})">
              <i class="fa-solid fa-arrows-rotate"></i> Check for Updates
            </button>
          </div>
        </div>
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
      const ipInput = document.getElementById("devIp");
      if (ipInput) dev.ip = ipInput.value.trim();
      dev.bootState = document.getElementById("bootState").value;
      dev.bgPhoto = document.getElementById("bgPhotoUrl").value.trim() || null;
      transport.setBootState(dev, dev.bootState);
      store.save();
      renderDeviceCards();
      transport.pollAll();
      closeSheet();
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

    openTriggerModal(index, selectedTab) {
      const dev = store.devices[index];
      if (!dev) return;
      const t = dev.triggers;

      if (selectedTab) currentTriggerTab = selectedTab === "presence" ? "geofence" : selectedTab;
      else if (!currentTriggerTab || currentTriggerTab === "presence") {
        const firstEn = ["clap","whistle","voice","shake","geofence","schedule"].find(k => (t[k] && t[k].enabled) || (k === "geofence" && t.presence && t.presence.enabled));
        currentTriggerTab = firstEn || "clap";
      }

      const tabs = [
        { id: "clap", label: "Clap", icon: "fa-solid fa-hands-clapping", title: "Clap Trigger" },
        { id: "whistle", label: "Whistle", icon: "fa-solid fa-bullhorn", title: "Whistle Detection" },
        { id: "voice", label: "Voice", icon: "fa-solid fa-microphone", title: "Voice Recognition" },
        { id: "shake", label: "Shake", icon: "fa-solid fa-mobile-screen", title: "Shake Sensor" },
        { id: "geofence", label: "Geo-Fence", icon: "fa-solid fa-location-crosshairs", title: "Geo-Fence Automation" },
        { id: "schedule", label: "Schedule", icon: "fa-solid fa-clock", title: "Schedule & Timer" }
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
          ${configHtml}
        </div>
      `);
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
      store.devices[index].triggers.schedule.timer = { endsAt, action };
      store.devices[index].triggers.schedule.enabled = true;
      store.save();
      sensors.sync();
      this.openTriggerModal(index, 'schedule');
      renderDeviceCards();
      showToast(`⏱️ Auto-${action.toUpperCase()} timer set for ${minutes} min`, "ok");
    },

    cancelQuickTimer(index) {
      store.devices[index].triggers.schedule.timer = null;
      store.save();
      sensors.sync();
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
    }
  };

  // --- Subnet Scanner Sheet ---
  dom.btnAdd.onclick = () => {
    openSheet(`
      <div class="sheet-header">
        <div>Add New Switch<span class="sub">Setup Guide</span></div>
        <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
      </div>

      <div class="provision-guide">
        <div class="pstep">
          <div class="pstep-icon"><i class="fa-solid fa-plug"></i></div>
          <div class="pstep-body">
            <b>Step 1 — Power ON the Switch</b>
            <p>The device broadcasts a <code>NARI-Switch-XXXX</code> Wi-Fi hotspot and is ready for setup.</p>
          </div>
        </div>
        <div class="pstep">
          <div class="pstep-icon"><i class="fa-solid fa-wifi"></i></div>
          <div class="pstep-body">
            <b>Step 2 — Connect to NARI Hotspot</b>
            <p>Go to <b>Android Wi-Fi Settings</b> &rarr; connect to <code>NARI-Switch-XXXX</code></p>
            <div class="pkey"><i class="fa-solid fa-key"></i> Password: <code>nariSetup2026</code></div>
            <p style="margin-top:5px;">A setup page opens automatically &rarr; select your home Wi-Fi &rarr; enter password &rarr; Save. The device reboots and joins your home network.</p>
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

      <div class="scan-divider">Already know the device IP? Add it instantly</div>

      <div class="manual-ip-row">
        <input type="text" id="manualIp" placeholder="e.g. 192.168.1.10" inputmode="decimal"
               onkeydown="if(event.key==='Enter') NARI.app.addByIp()">
        <button class="btn primary sm" onclick="NARI.app.addByIp()">
          <i class="fa-solid fa-plus"></i> Add
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
  };

  NARI.app.addByIp = async () => {
    const input = document.getElementById("manualIp");
    const status = document.getElementById("manualIpStatus");
    const ip = (input.value || "").trim();
    if (!ip) { status.textContent = "Enter an IP address first."; return; }
    status.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Connecting to ${ip}...`;
    const data = await transport.probeIp(ip, 2000);
    if (!data) {
      status.innerHTML = `<span style="color:var(--danger)"><i class="fa-solid fa-circle-xmark"></i> No response from ${ip}. Check IP and auth token.</span>`;
      return;
    }
    if (store.exists(data.id, ip)) {
      status.innerHTML = `<span style="color:var(--warn)"><i class="fa-solid fa-triangle-exclamation"></i> Device already added.</span>`;
      return;
    }
    store.add({ name: `Switch ${store.devices.length + 1}`, ip, id: data.id });
    renderDeviceCards();
    closeSheet();
    showToast(`✅ ${data.id} added at ${ip}`, "ok");
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
        <button class="btn sm primary" onclick="NARI.app.adoptDevice('${d.ip}', '${d.id}')">Add</button>
      </div>
    `).join("");
  };

  NARI.app.adoptDevice = (ip, id) => {
    if (!store.exists(id, ip)) {
      store.add({ name: `Switch ${store.devices.length + 1}`, ip, id });
      renderDeviceCards();
      closeSheet();
    }
  };

  // --- App Settings Sheet ---
  dom.btnSettings.onclick = () => {
    const s = NARI.settings;
    openSheet(`
      <div class="sheet-header">
        <div>Settings<span class="sub">Preferences & Endpoints</span></div>
        <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
      </div>
      <div class="form-group">
        <label>Theme</label>
        <select id="cfgTheme" onchange="NARI.app.changeTheme(this.value)">
          <option value="default" ${s.theme === 'default' ? 'selected' : ''}>Default Green</option>
          <option value="emerald" ${s.theme === 'emerald' ? 'selected' : ''}>Emerald</option>
          <option value="ocean" ${s.theme === 'ocean' ? 'selected' : ''}>Ocean Blue</option>
          <option value="amber" ${s.theme === 'amber' ? 'selected' : ''}>Amber</option>
          <option value="violet" ${s.theme === 'violet' ? 'selected' : ''}>Violet</option>
          <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Clean Light</option>
        </select>
      </div>
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
      <button class="btn primary" onclick="NARI.app.saveAppSettings()">Save Configuration</button>
    `);
  };

  NARI.app.changeTheme = theme => applyTheme(theme);
  NARI.app.saveAppSettings = () => {
    const s = NARI.settings;
    s.theme = document.getElementById("cfgTheme").value;
    s.brokerUrl = document.getElementById("cfgBroker").value.trim();
    s.lanToken = document.getElementById("cfgLanToken").value.trim();
    s.lanScanSubnets = document.getElementById("cfgSubnets").value.trim();
    store.save();
    transport.connectCloud();
    closeSheet();
  };

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
        // ZERO-COST SHIELD: Only read from Firestore if this phone has 0 devices saved (brand new phone/login)
        // Existing customers load instantly from phone storage with 0 Firebase read charges.
        if (store.devices.length === 0) {
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

  // --- Master Controls (Option 3) ---
  NARI.app.allOff = async () => {
    if (!store.devices.length) return;
    showToast("Turning OFF all switches...", "info");
    for (let i = 0; i < store.devices.length; i++) {
      if (store.devices[i].state) {
        transport.setState(i, false, { quiet: true });
      }
    }
    setTimeout(() => {
      renderDeviceCards();
      showToast("All switches turned OFF", "ok");
    }, 450);
  };

  NARI.app.allOn = async () => {
    if (!store.devices.length) return;
    showToast("Turning ON all switches...", "info");
    for (let i = 0; i < store.devices.length; i++) {
      if (!store.devices[i].state) {
        transport.setState(i, true, { quiet: true });
      }
    }
    setTimeout(() => {
      renderDeviceCards();
      showToast("All switches turned ON", "ok");
    }, 450);
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
      id: d.id
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
          store.add({ name: item.name || "Switch", ip: item.ip || "", id: item.id || "" });
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

  // --- Check PWA Home Screen Shortcuts (?action=all-off / ?action=all-on) (Option 6) ---
  (function checkShortcuts() {
    const params = new URLSearchParams(window.location.search);
    const action = params.get("action");
    if (action === "all-off") {
      setTimeout(() => NARI.app.allOff(), 700);
    } else if (action === "all-on") {
      setTimeout(() => NARI.app.allOn(), 700);
    }
  })();

  // --- Event Bus Subscriptions ---
  bus.on("devices:changed", () => renderDeviceCards());
  bus.on("device:updated", () => renderDeviceCards());
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

  // --- Initialization ---
  applyTheme(NARI.settings.theme);
  transport.connectCloud();
  sensors.sync();
  renderDeviceCards();
  renderStatus();

  setInterval(() => transport.pollAll(), 7500);
})(window);
