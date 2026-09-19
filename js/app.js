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
      html += `<div class="pill warn"><span class="led"></span>LAN: Mixed Content Blocked</div>`;
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
          <h3>No switches found</h3>
          <p class="small muted">Tap + above to discover switches on your network.</p>
        </div>`;
      return;
    }

    dom.deviceList.innerHTML = store.devices.map((dev, i) => {
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
        <div class="btn-row" style="margin-top:14px;">
          <button class="btn primary" onclick="NARI.app.saveDeviceSettings(${index})">Save</button>
          <button class="btn danger" onclick="NARI.app.deleteDevice(${index})">Delete</button>
        </div>
      `);
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
        <div>Add Smart Switch<span class="sub">LAN Scanner</span></div>
        <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
      </div>
      <div class="steps">
        <div class="step"><div class="num">1</div><div>Ensure your phone and switch are connected to your Wi-Fi network.</div></div>
        <div class="step"><div class="num">2</div><div>Scan your local subnets to find the device.</div></div>
      </div>
      <button class="btn primary" id="btnStartScan" onclick="NARI.app.runLanScan()">Scan Subnets</button>
      <div class="progress hidden" id="scanProgress"><div id="scanBar"></div></div>
      <div class="found-list" id="scanResults"></div>
    `);
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
      res.innerHTML = `<div class="small muted" style="text-align:center;">No switches responded. Verify your Subnets in Settings.</div>`;
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

  // --- Firebase Web Auth Integration ---
  if (store.auth) {
    store.auth.onAuthStateChanged(user => {
      store.currentUser = user;
      if (user) {
        dom.authContainer.innerHTML = `
          <button class="btn-auth" onclick="NARI.app.signOut()">
            <img class="user-avatar" src="${user.photoURL || 'https://via.placeholder.com/20'}" alt="">
            <span>${(user.displayName || user.email || 'User').split(' ')[0]}</span>
          </button>
        `;
        store.loadCloud();
      } else {
        dom.authContainer.innerHTML = `
          <button class="btn-auth" id="btnLogin" onclick="NARI.app.signIn()">
            <i class="fa-brands fa-google"></i> Login
          </button>
        `;
      }
    });
  }
  NARI.app.signIn = () => store.auth && store.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(e => showToast(e.message, "error"));
  NARI.app.signOut = () => store.auth && store.auth.signOut();

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
