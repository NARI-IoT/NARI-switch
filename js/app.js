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
      const lanCount = store.devices.filter(d => transport.lanFresh(d)).length;
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

    const scenesHtml = `
      <div class="scenes-bar">
        <div class="scenes-label"><i class="fa-solid fa-wand-magic-sparkles"></i> Master Controls</div>
        <div class="scenes-btns">
          <button class="scene-btn off" onclick="NARI.app.allOff()" title="Turn OFF all switches">
            <i class="fa-solid fa-moon"></i> All OFF
          </button>
          <button class="scene-btn on" onclick="NARI.app.allOn()" title="Turn ON all switches">
            <i class="fa-solid fa-bolt"></i> All ON
          </button>
        </div>
      </div>
    `;

    dom.deviceList.innerHTML = scenesHtml + store.devices.map((dev, i) => {
      const isOnline = dev.isOnline !== false;
      const isVerifying = !!dev._isVerifying;
      const hasBg = !!dev.bgPhoto;
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
              <h3>${dev.name}</h3>
              <p>
                <span class="link-tag ${transport.lanFresh(dev) ? 'lan' : (transport.cloudConnected ? 'cloud' : 'none')}">
                  ${transport.lanFresh(dev) ? 'LAN' : (transport.cloudConnected ? 'Cloud' : 'Offline')}
                </span>
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

  // --- Exposed App Methods ---
  NARI.app = {
    closeSheet,

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
          <button class="btn danger" onclick="NARI.app.deleteDevice(${index})">Delete</button>
        </div>
      `);
    },

    checkFirmwareUpdate: async (index) => {
      const dev = store.devices[index];
      const container = document.getElementById("otaContent");
      if (!container) return;
      container.innerHTML = `<div style="text-align:center;padding:8px 0;font-size:0.75rem;color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Checking for updates...</div>`;
      
      try {
        const res = await fetch("./firmware/version.json?_t=" + Date.now());
        if (!res.ok) throw new Error("Could not check update manifest");
        const info = await res.json();
        const currentVer = dev.fw || "1.0.0";
        const hasUpdate = info.version && info.version !== currentVer;

        if (!hasUpdate) {
          container.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;">
              <span style="font-size:0.75rem;color:var(--success);font-weight:700;"><i class="fa-solid fa-circle-check"></i> Firmware is up to date</span>
              <button class="btn secondary sm" style="padding:4px 10px;font-size:0.7rem;" onclick="NARI.app.checkFirmwareUpdate(${index})">Recheck</button>
            </div>
          `;
          return;
        }

        container.innerHTML = `
          <div class="ota-badge"><span class="dot"></span> Update Available: v${info.version}</div>
          <div class="ota-notes"><b>${info.title || 'What\'s New'}:</b><br>${info.notes || 'Bug fixes and performance improvements.'}</div>
          <button class="btn primary sm" style="width:100%;" id="btnStartOta" onclick="NARI.app.startFirmwareUpdate(${index}, '${info.binUrl}', '${info.version}')">
            <i class="fa-solid fa-cloud-arrow-down"></i> Download &amp; Update Now
          </button>
        `;
      } catch (e) {
        container.innerHTML = `
          <div class="small" style="color:var(--warn);margin-bottom:6px;"><i class="fa-solid fa-triangle-exclamation"></i> Could not reach update server.</div>
          <button class="btn secondary sm" style="width:100%;" onclick="NARI.app.checkFirmwareUpdate(${index})">Try Again</button>
        `;
      }
    },

    startFirmwareUpdate: async (index, binUrl, targetVersion) => {
      const dev = store.devices[index];
      const container = document.getElementById("otaContent");
      if (!container) return;

      container.innerHTML = `
        <div class="ota-progress-wrap">
          <div class="ota-progress-bar">
            <div class="ota-progress-fill" id="otaFill"></div>
          </div>
          <div class="ota-progress-meta">
            <span id="otaStatusText">Downloading firmware...</span>
            <span id="otaPctText">0%</span>
          </div>
        </div>
        <div class="small muted" style="text-align:center;margin-top:6px;font-size:0.7rem;">
          Keep switch powered ON. Device will reboot automatically.
        </div>
      `;

      const fill = document.getElementById("otaFill");
      const pctText = document.getElementById("otaPctText");
      const statusText = document.getElementById("otaStatusText");

      transport.triggerOta(dev, binUrl);

      let pct = 0;
      const interval = setInterval(() => {
        pct += Math.floor(Math.random() * 8) + 5;
        if (pct >= 95) {
          pct = 95;
          statusText.innerText = "Flashing chip & restarting...";
        } else if (pct > 45) {
          statusText.innerText = "Writing firmware to ESP...";
        }
        if (fill) fill.style.width = pct + "%";
        if (pctText) pctText.innerText = pct + "%";

        if (pct >= 95) {
          clearInterval(interval);
          setTimeout(() => {
            if (fill) fill.style.width = "100%";
            if (pctText) pctText.innerText = "100%";
            if (statusText) statusText.innerText = "Update complete! Reconnected.";
            dev.fw = targetVersion;
            store.save();
            renderDeviceCards();
            const cur = document.getElementById("otaCurrentVer");
            if (cur) cur.innerText = "v" + targetVersion;
            showToast(`✅ ${dev.name} updated to v${targetVersion}!`, "ok");
          }, 3200);
        }
      }, 350);
    },

    saveDeviceSettings(index) {
      const dev = store.devices[index];
      dev.name = document.getElementById("devName").value.trim() || dev.name;
      dev.bootState = document.getElementById("bootState").value;
      dev.bgPhoto = document.getElementById("bgPhotoUrl").value.trim() || null;
      transport.setBootState(dev, dev.bootState);
      store.save();
      renderDeviceCards();
      closeSheet();
    },

    deleteDevice(index) {
      if (confirm(`Remove "${store.devices[index].name}"?`)) {
        store.remove(index);
        closeSheet();
      }
    },

    openTriggerModal(index) {
      const dev = store.devices[index];
      const t = dev.triggers;
      openSheet(`
        <div class="sheet-header">
          <div>Triggers & Automations<span class="sub">${dev.name}</span></div>
          <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
        </div>
        <div class="trigger-grid">
          <div class="tchip ${t.clap.enabled ? 'on' : ''}" onclick="NARI.app.toggleTrigger(${index}, 'clap')">
            <i class="fa-solid fa-hands-clapping"></i>Clap
            <span class="st"></span>
          </div>
          <div class="tchip ${t.whistle.enabled ? 'on' : ''}" onclick="NARI.app.toggleTrigger(${index}, 'whistle')">
            <i class="fa-solid fa-bullhorn"></i>Whistle
            <span class="st"></span>
          </div>
          <div class="tchip ${t.voice.enabled ? 'on' : ''}" onclick="NARI.app.toggleTrigger(${index}, 'voice')">
            <i class="fa-solid fa-microphone"></i>Voice
            <span class="st"></span>
          </div>
          <div class="tchip ${t.shake.enabled ? 'on' : ''}" onclick="NARI.app.toggleTrigger(${index}, 'shake')">
            <i class="fa-solid fa-mobile-screen"></i>Shake
            <span class="st"></span>
          </div>
          <div class="tchip ${t.presence.enabled ? 'on' : ''}" onclick="NARI.app.toggleTrigger(${index}, 'presence')">
            <i class="fa-solid fa-street-view"></i>Presence
            <span class="st"></span>
          </div>
          <div class="tchip ${t.schedule.enabled ? 'on' : ''}" onclick="NARI.app.toggleTrigger(${index}, 'schedule')">
            <i class="fa-solid fa-clock"></i>Schedule
            <span class="st"></span>
          </div>
        </div>
        ${t.clap.enabled ? `
          <div class="tconf">
            <h4>Clap Configuration</h4>
            <div class="form-group">
              <label>Cadence</label>
              <select onchange="NARI.app.setClapCadence(${index}, this.value)">
                <option value="single" ${t.clap.cadence === 'single' ? 'selected' : ''}>Single Clap</option>
                <option value="double" ${t.clap.cadence === 'double' ? 'selected' : ''}>Double Clap</option>
                <option value="triple" ${t.clap.cadence === 'triple' ? 'selected' : ''}>Triple Clap</option>
              </select>
            </div>
            <button class="btn secondary sm" id="btnTrainClap" onclick="NARI.app.trainClapProfile(${index})">
              <i class="fa-solid fa-microphone-lines"></i> ${t.clap.profile ? 'Retrain Personal Profile' : 'Train Custom Clap'}
            </button>
            <div id="trainProgress" class="small muted" style="margin-top:6px;"></div>
          </div>
        ` : ''}
      `);
    },

    toggleTrigger(index, type) {
      const dev = store.devices[index];
      dev.triggers[type].enabled = !dev.triggers[type].enabled;
      store.save();
      sensors.sync();
      this.openTriggerModal(index);
      renderDeviceCards();
    },

    setClapCadence(index, cadence) {
      store.devices[index].triggers.clap.cadence = cadence;
      store.save();
    },

    trainClapProfile(index) {
      const prog = document.getElementById("trainProgress");
      const btn = document.getElementById("btnTrainClap");
      btn.disabled = true;

      audioTrainingCtrl = audio.train(5, (collected, total, info) => {
        if (info && info.rejected) {
          prog.innerText = `Transient rejected (${info.reasons ? info.reasons[0] : 'not a clap'}). Clap again.`;
        } else {
          prog.innerText = `Recorded ${collected} of ${total} claps...`;
        }
      });

      audioTrainingCtrl.promise.then(profile => {
        btn.disabled = false;
        if (profile) {
          store.devices[index].triggers.clap.profile = profile;
          store.save();
          prog.innerText = "✓ Training successful! Fingerprint saved.";
        } else {
          prog.innerText = "Training cancelled.";
        }
      });
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

  NARI.app.signIn = () => store.auth && store.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(e => showToast(e.message, "error"));
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

  // --- Initialization ---
  applyTheme(NARI.settings.theme);
  transport.connectCloud();
  sensors.sync();
  renderDeviceCards();
  renderStatus();

  setInterval(() => transport.pollAll(), 7500);
})(window);
