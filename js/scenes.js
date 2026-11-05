/*
 * NARI Smart Home — Smart Scenes & Master Automations Hub
 * 
 * Features:
 * - eWeLink-Style Creative Scene Builder (If this triggers -> Then that actions)
 * - Cross-Switch Automations (e.g. If Tank switch turns ON -> Then Motor switch turns OFF)
 * - One-Tap Multi-Device Scene Activation (Parallel sub-100ms response)
 * - "One-to-All" Master Trigger by Mode (Clap, Flip, Shake, Voice, Geofence, Time)
 * - Exclusive Supervision Controls (Only Home Admin can create/edit/delete scenes)
 * - Stored in localStorage + single-document cloud sync ($0 Zero-Cost)
 */

(function (global) {
  "use strict";
  const NARI = global.NARI || {};
  const { store, bus, transport } = NARI;

  function escHtml(v) {
    return String(v === null || v === undefined ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escJs(v) {
    return String(v === null || v === undefined ? "" : v).replace(/['"\\]/g, "\\$&");
  }

  const STORAGE_KEY_SCENES = "nari_smart_scenes";

  // Pre-configured commercial preset scenes + eWeLink example
  const defaultScenes = [
    {
      id: "scene_motor_off_1",
      name: "Motor OFF 1",
      icon: "fa-water",
      color: "#06b6d4",
      home: "Nari home IoT",
      trigger: {
        type: "device",
        deviceId: "dev_tank",
        deviceName: "Tank ON and OFF",
        condition: "on",
        label: "Tank ON and OFF",
        subLabel: "Channel2 Single-pressed"
      },
      actions: [
        {
          deviceId: "dev_motor",
          deviceName: "NARI",
          state: false,
          actionLabel: "Motor OFF ON"
        }
      ],
      notify: true,
      notifyEmail: "galle****ult11@gmail.com",
      subtitle: "If Tank full -> Motor OFF"
    },
    {
      id: "scene_morning",
      name: "Good Morning",
      icon: "fa-sun",
      color: "#f59e0b",
      home: "Nari home IoT",
      trigger: {
        type: "manual",
        label: "Tap to Run",
        subLabel: "1-Tap from Dashboard"
      },
      actions: [],
      defaultAll: "on",
      subtitle: "Turn on day appliances"
    },
    {
      id: "scene_night",
      name: "Good Night",
      icon: "fa-moon",
      color: "#6366f1",
      home: "Nari home IoT",
      trigger: {
        type: "sensor",
        mode: "flip",
        label: "Flip Phone Down 📱",
        subLabel: "Place phone face-down at night"
      },
      actions: [],
      defaultAll: "off",
      subtitle: "Turn off all lights & appliances"
    },
    {
      id: "scene_movie",
      name: "Cinema Time",
      icon: "fa-film",
      color: "#ec4899",
      home: "Nari home IoT",
      trigger: {
        type: "sensor",
        mode: "clap",
        label: "Double Clap 👏",
        subLabel: "Clap twice near phone"
      },
      actions: [],
      subtitle: "Cozy ambient mood lighting"
    },
    {
      id: "scene_away",
      name: "Leaving Home",
      icon: "fa-door-open",
      color: "#ef4444",
      home: "Nari home IoT",
      trigger: {
        type: "manual",
        label: "Tap to Run",
        subLabel: "1-Tap from Dashboard"
      },
      actions: [],
      defaultAll: "off",
      subtitle: "All switches off for safety"
    },
    {
      id: "scene_welcome",
      name: "Welcome Home",
      icon: "fa-house-chimney",
      color: "#10b981",
      home: "Nari home IoT",
      trigger: {
        type: "sensor",
        mode: "presence",
        label: "Arriving Home 📍",
        subLabel: "Auto triggers on home Wi-Fi"
      },
      actions: [],
      defaultAll: "on",
      subtitle: "Hallway & essential lights ON"
    },
    {
      id: "scene_party",
      name: "Party Mode",
      icon: "fa-champagne-glasses",
      color: "#a855f7",
      home: "Nari home IoT",
      trigger: {
        type: "sensor",
        mode: "shake",
        label: "Shake Phone 📳",
        subLabel: "Firm shake to trigger"
      },
      actions: [],
      subtitle: "All lights active with strobe"
    }
  ];

  function loadLocalScenes() {
    try {
      const v = JSON.parse(localStorage.getItem(STORAGE_KEY_SCENES));
      if (Array.isArray(v) && v.length > 0) {
        // Upgrade older format scenes if needed
        return v.map(s => {
          if (!s.trigger) {
            if (s.triggerMode && s.triggerMode !== "none") {
              s.trigger = {
                type: "sensor",
                mode: s.triggerMode,
                label: s.triggerMode === "clap" ? "Double Clap 👏" :
                       s.triggerMode === "flip" ? "Flip Phone Down 📱" :
                       s.triggerMode === "shake" ? "Shake Phone 📳" :
                       s.triggerMode === "presence" ? "Arriving Home 📍" : s.triggerMode,
                subLabel: "Sensor mode trigger"
              };
            } else {
              s.trigger = {
                type: "manual",
                label: "Tap to Run",
                subLabel: "1-Tap from Dashboard"
              };
            }
          }
          if (!s.home) s.home = "Nari home IoT";
          if (!Array.isArray(s.actions)) {
            // Convert legacy actions object { devId: true } to array
            const actArr = [];
            if (s.actions && typeof s.actions === "object") {
              for (const [k, v] of Object.entries(s.actions)) {
                actArr.push({
                  deviceId: k,
                  deviceName: k,
                  state: v,
                  actionLabel: v ? "Turn ON" : "Turn OFF"
                });
              }
            }
            s.actions = actArr;
          }
          return s;
        });
      }
    } catch (e) {}
    return defaultScenes;
  }

  function saveLocalScenes(list) {
    try {
      localStorage.setItem(STORAGE_KEY_SCENES, JSON.stringify(list));
    } catch (e) {}
    if (store && store.save) store.save();
  }

  const scenes = {
    list: loadLocalScenes(),
    activeSceneId: null,
    _currentEdit: null, // Temporary scene state being edited

    init() {
      // 1. Listen to sensor trigger events for "One-to-All" mode triggers
      bus.on("trigger:fired", (e) => {
        this._handleSensorEvent(e.type);
      });

      // 2. Watch device state updates for cross-switch automations
      bus.on("device:updated", (idx) => {
        this._checkDeviceAutomations(idx);
      });
      bus.on("device:commanded", (e) => {
        if (e && e.index !== undefined) {
          this._checkDeviceAutomations(e.index);
        }
      });

      // 3. Tab visibility listener to refresh active scene state
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this._evaluateActiveState();
      });
    },

    getScenes() {
      return this.list;
    },

    isSupervisor() {
      if (NARI.sharing && typeof NARI.sharing.isSupervisor === "function") {
        return NARI.sharing.isSupervisor();
      }
      return true;
    },

    // ---------- Cross-Device Smart Automation Engine ----------
    _checkDeviceAutomations(idx) {
      const dev = store.devices && store.devices[idx];
      if (!dev) return;
      const devKey = dev.id || dev.ip || dev.name;
      const now = Date.now();

      for (const scene of this.list) {
        if (scene.enabled === false) continue;
        if (!scene.trigger || scene.trigger.type !== "device") continue;
        // 3-second loop/debounce guard
        if (scene._lastTriggered && (now - scene._lastTriggered < 3000)) continue;

        const trigDev = scene.trigger.deviceId;
        const trigName = scene.trigger.deviceName;
        const matchesDev = (trigDev === devKey || trigDev === dev.id || trigDev === dev.ip || trigDev === dev.name || trigName === dev.name);

        if (!matchesDev) continue;

        const cond = scene.trigger.condition; // "on", "off", "toggle"
        const trigRelay = scene.trigger.relay === 2 ? 2 : 1;
        const curState = trigRelay === 2 ? !!dev.state2 : !!dev.state;
        const isMatch = (cond === "on" && curState === true) ||
                        (cond === "off" && curState === false) ||
                        (cond === "toggle");

        if (isMatch) {
          scene._lastTriggered = now;
          console.log(`[Smart Automation] Switch "${dev.name}" triggered scene "${scene.name}"!`);
          if (NARI.showToast) {
            NARI.showToast(`⚡ Automation: "${dev.name}" triggered "${scene.name}"`, "info");
          }
          this.executeScene(scene.id);
        }
      }
    },

    // ---------- Scene Execution Engine (Sub-100ms Parallel Batch) ----------
    async executeScene(sceneId) {
      const scene = this.list.find(s => s.id === sceneId);
      if (!scene) return;

      const devices = store.devices || [];
      if (devices.length === 0) {
        if (NARI.showToast) NARI.showToast("No smart switches to control", "warn");
        return;
      }

      this.activeSceneId = sceneId;
      if (NARI.showToast) NARI.showToast(`Activating "${scene.name}"...`, "info");
      if (navigator.vibrate) { try { navigator.vibrate(50); } catch (e) {} }

      const promises = [];
      let adjustedCount = 0;

      // Handle specific action items defined in scene
      if (Array.isArray(scene.actions) && scene.actions.length > 0) {
        for (const act of scene.actions) {
          const devIdx = devices.findIndex(d => 
            (d.id && d.id === act.deviceId) || 
            (d.ip && d.ip === act.deviceId) || 
            (d.name && (d.name === act.deviceName || d.name === act.deviceId))
          );

          if (devIdx >= 0) {
            const dev = devices[devIdx];
            const targetRelay = act.relay || (dev.dual ? 'both' : 1);

            // Execute Relay 1 if targeted
            if (targetRelay === 1 || targetRelay === 'relay1' || targetRelay === 'both') {
              let targetState = act.state;
              if (targetState === "toggle") targetState = !dev.state;
              if (dev.state !== targetState) {
                adjustedCount++;
                promises.push(transport.setState(devIdx, targetState, { relay: 1, quiet: true, source: "scene:" + scene.id }));
              }
            }

            // Execute Relay 2 if targeted and device is dual
            if (dev.dual && (targetRelay === 2 || targetRelay === 'relay2' || targetRelay === 'both')) {
              let targetState = act.state;
              if (targetState === "toggle") targetState = !dev.state2;
              if (dev.state2 !== targetState) {
                adjustedCount++;
                promises.push(transport.setState(devIdx, targetState, { relay: 2, quiet: true, source: "scene:" + scene.id }));
              }
            }
          }
        }
      }

      // Handle global scenes (Good Morning / Good Night / Away / Welcome)
      if (scene.defaultAll) {
        const targetAll = scene.defaultAll === "on";
        for (let i = 0; i < devices.length; i++) {
          const dev = devices[i];
          // If not explicitly overridden, apply defaultAll
          const isExplicit = Array.isArray(scene.actions) && scene.actions.some(a => a.deviceId === dev.id || a.deviceName === dev.name);
          if (!isExplicit) {
            if (dev.state !== targetAll || (dev.dual && dev.state2 !== targetAll)) adjustedCount++;
            if (dev.state !== targetAll) {
              promises.push(transport.setState(i, targetAll, { relay: 1, quiet: true, source: "scene:" + scene.id }));
            }
            if (dev.dual && dev.state2 !== targetAll) {
              promises.push(transport.setState(i, targetAll, { relay: 2, quiet: true, source: "scene:" + scene.id }));
            }
          }
        }
      }

      // Execute all switches in parallel with zero sequential waiting
      await Promise.allSettled(promises);

      // Log to Switch Activity History using phone time ($0 cost)
      if (NARI.sharing && typeof NARI.sharing.logActivity === "function") {
        NARI.sharing.logActivity(`Scene "${scene.name}" activated (${adjustedCount} switches updated)`, "scene");
      }

      if (NARI.app && NARI.app.renderDeviceCards) {
        NARI.app.renderDeviceCards();
      }

      if (NARI.showToast) {
        NARI.showToast(`✅ "${scene.name}" activated (${adjustedCount} switches updated)`, "ok");
      }
    },

    // Master Controls
    async allOff() {
      await this.executeScene("scene_away");
    },

    async allOn() {
      await this.executeScene("scene_welcome");
    },

    // ---------- Sensor Mode Binding (One-to-All) ----------
    _handleSensorEvent(sensorType) {
      if (!sensorType) return;
      // Match scene with trigger.mode === sensorType or legacy triggerMode
      const matchedScene = this.list.find(s => 
        (s.trigger && s.trigger.type === "sensor" && s.trigger.mode === sensorType) ||
        (s.triggerMode === sensorType)
      );
      if (matchedScene) {
        console.log(`[Smart Scenes] Sensor mode "${sensorType}" fired -> Executing scene "${matchedScene.name}"`);
        this.executeScene(matchedScene.id);
      }
    },

    _evaluateActiveState() {
      const devices = store.devices || [];
      if (!devices.length) return;
      const allOff = devices.every(d => !d.state);
      const allOn = devices.every(d => d.state);
      if (allOff) this.activeSceneId = "scene_away";
      else if (allOn) this.activeSceneId = "scene_welcome";
    },

    // ========================================================
    // eWeLink-Style Creative Scene Editor UI
    // ========================================================
    openSceneEditor(sceneId) {
      if (!this.isSupervisor()) {
        alert("👑 Permission Denied:\nOnly the Home Admin (Supervisor) can create or customize Smart Scenes.\nFamily members can activate scenes from the dashboard.");
        return;
      }

      const isNew = !sceneId;
      const existing = sceneId ? this.list.find(s => s.id === sceneId) : null;

      // Deep clone or create initial scene state
      this._currentEdit = isNew ? {
        id: "scene_" + Date.now(),
        name: "My Scene",
        icon: "fa-wand-magic-sparkles",
        color: "#06b6d4",
        home: "Nari home IoT",
        trigger: {
          type: "manual",
          label: "Tap to Run",
          subLabel: "1-Tap from Dashboard"
        },
        actions: [],
        notify: false,
        notifyEmail: "user@example.com",
        isNew: true
      } : JSON.parse(JSON.stringify(existing));

      if (!this._currentEdit.home) this._currentEdit.home = "Nari home IoT";
      if (!Array.isArray(this._currentEdit.actions)) this._currentEdit.actions = [];

      this._renderSceneEditor();
    },

    _renderSceneEditor() {
      const scene = this._currentEdit;
      if (!scene) return;
      const isNew = !!scene.isNew;

      const trigger = scene.trigger || {
        type: "manual",
        label: "Tap to Run",
        subLabel: "1-Tap from Dashboard"
      };

      const actions = scene.actions || [];

      // Determine trigger icon and badge color
      let trigIcon = "fa-hand-pointer";
      if (trigger.type === "device") trigIcon = "fa-plug";
      else if (trigger.mode === "clap") trigIcon = "fa-hands-clapping";
      else if (trigger.mode === "flip") trigIcon = "fa-mobile-screen";
      else if (trigger.mode === "shake") trigIcon = "fa-hand";
      else if (trigger.mode === "presence") trigIcon = "fa-house-chimney";

      const html = `
        <div class="ewelink-editor">
          <!-- Top Navigation Header -->
          <div class="ewelink-topbar">
            <button class="ewelink-back-btn" onclick="NARI.closeSheet()" title="Back">
              <i class="fa-solid fa-arrow-left"></i>
            </button>
            <div class="ewelink-title">${isNew ? 'Create Scene' : 'Edit Scene'}</div>
            <button class="ewelink-save-link" onclick="NARI.scenes._saveCurrentScene()">Save</button>
          </div>

          <!-- General Metadata Card -->
          <div class="ewelink-card">
            <!-- Scene Name -->
            <div class="ewelink-row">
              <span class="ewelink-label">Scene Name</span>
              <input type="text" id="eweSceneName" class="ewelink-value-input" value="${scene.name || ''}" placeholder="Enter scene name" oninput="NARI.scenes._currentEdit.name = this.value">
            </div>

            <!-- Labels & Homes -->
            <div class="ewelink-row">
              <span class="ewelink-label">Labels &amp; Homes</span>
              <div class="ewelink-value-badge" onclick="NARI.scenes._promptHomeName()">
                <span>${scene.home || 'Nari home IoT'}</span>
                <i class="fa-solid fa-chevron-right" style="font-size:0.75rem;"></i>
              </div>
            </div>

            <!-- Icon Picker -->
            <div class="ewelink-row">
              <span class="ewelink-label">Icon</span>
              <div class="ewelink-value-badge" onclick="NARI.scenes._toggleIconTray()">
                <div class="ewelink-icon-preview" id="eweIconPreview" style="background:${scene.color || '#06b6d4'};">
                  <i class="fa-solid ${scene.icon || 'fa-wand-magic-sparkles'}"></i>
                </div>
                <i class="fa-solid fa-chevron-right" style="font-size:0.75rem;"></i>
              </div>
            </div>
          </div>

          <!-- Hidden Tray: Icon & Color Palette -->
          <div class="ewelink-tray" id="eweIconTray">
            <div class="small muted" style="margin-bottom:6px;font-weight:700;">CHOOSE ICON:</div>
            <div class="scene-icon-grid" style="margin-bottom:12px;">
              ${[
                { id: "fa-water", label: "Tank" },
                { id: "fa-plug", label: "Switch" },
                { id: "fa-sun", label: "Morning" },
                { id: "fa-moon", label: "Night" },
                { id: "fa-film", label: "Movie" },
                { id: "fa-house-chimney", label: "Home" },
                { id: "fa-door-open", label: "Away" },
                { id: "fa-champagne-glasses", label: "Party" },
                { id: "fa-bolt", label: "Energy" },
                { id: "fa-bed", label: "Sleep" },
                { id: "fa-fan", label: "Fan" },
                { id: "fa-lightbulb", label: "Light" }
              ].map(ico => `
                <button type="button" class="icon-pick-btn ${scene.icon === ico.id ? 'active' : ''}" onclick="NARI.scenes._selectIcon('${ico.id}')">
                  <i class="fa-solid ${ico.id}"></i>
                  <span>${ico.label}</span>
                </button>
              `).join("")}
            </div>

            <div class="small muted" style="margin-bottom:6px;font-weight:700;">CHOOSE COLOR ACCENT:</div>
            <div class="scene-color-row">
              ${['#06b6d4', '#10b981', '#f59e0b', '#6366f1', '#ec4899', '#38bdf8', '#a855f7', '#ef4444'].map(c => `
                <div class="color-dot ${scene.color === c ? 'active' : ''}" style="background:${c};" onclick="NARI.scenes._selectColor('${c}')"></div>
              `).join("")}
            </div>
          </div>

          <!-- Section: IF (this triggers) -->
          <div class="ewelink-section">
            <div class="ewelink-section-hdr">
              <div class="ewelink-sec-titles">
                <span class="ewelink-sec-name">If</span>
                <span class="ewelink-sec-sub">this triggers</span>
              </div>
            </div>

            <!-- Trigger Item Card -->
            <div class="ewelink-item-card">
              <button class="ewelink-del-item" onclick="NARI.scenes._openTriggerPicker()" title="Change trigger">
                <i class="fa-solid fa-circle-minus"></i>
              </button>

              <div class="ewelink-dev-icon" style="background:linear-gradient(135deg, ${scene.color || '#06b6d4'}, #0284c7);">
                <i class="fa-solid ${trigIcon}"></i>
              </div>

              <div class="ewelink-item-info" onclick="NARI.scenes._openTriggerPicker()">
                <div class="ewelink-item-title">${trigger.label || trigger.deviceName || 'Tap to Run'}</div>
                <div class="ewelink-item-sub">
                  <span>${trigger.subLabel || 'Condition'}</span>
                  <i class="fa-solid fa-pen" style="font-size:0.65rem;opacity:0.6;margin-left:4px;"></i>
                </div>
                <div class="ewelink-item-home">${scene.home || 'Nari home IoT'}</div>
              </div>
            </div>
          </div>

          <!-- Section: THEN (that actions) -->
          <div class="ewelink-section">
            <div class="ewelink-section-hdr">
              <div class="ewelink-sec-titles">
                <span class="ewelink-sec-name">Then</span>
                <span class="ewelink-sec-sub">that actions</span>
              </div>
              <button class="ewelink-add-action-btn" onclick="NARI.scenes._openAddActionPicker()" title="Add switch action">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>

            <!-- Actions List -->
            <div class="ewelink-actions-list" style="display:flex;flex-direction:column;gap:8px;">
              ${actions.length === 0 ? `
                <div class="ewelink-empty-card" onclick="NARI.scenes._openAddActionPicker()">
                  <i class="fa-solid fa-circle-plus" style="font-size:1.4rem;color:#0ea5e9;display:block;margin-bottom:6px;"></i>
                  <span>Tap to add switches to control</span>
                </div>
              ` : actions.map((act, i) => {
                const isOff = act.state === false;
                const isOn = act.state === true;
                const isToggle = act.state === "toggle";
                const badgeClass = isOff ? 'off' : (isOn ? 'on' : 'toggle');
                const badgeText = isOff ? 'Turn OFF' : (isOn ? 'Turn ON' : 'Toggle');

                return `
                  <div class="ewelink-item-card">
                    <button class="ewelink-del-item" onclick="NARI.scenes._removeAction(${i})" title="Remove action">
                      <i class="fa-solid fa-circle-minus"></i>
                    </button>

                    <div class="ewelink-dev-icon" style="background:linear-gradient(135deg, #0ea5e9, #0284c7);">
                      <i class="fa-solid fa-plug"></i>
                    </div>

                    <div class="ewelink-item-info">
                      <div class="ewelink-item-title">${act.deviceName || 'NARI Switch'}</div>
                      <div class="ewelink-item-sub">
                        <span class="ewelink-action-tag ${badgeClass}" onclick="NARI.scenes._cycleActionState(${i})">
                          ${act.actionLabel || badgeText}
                        </span>
                      </div>
                      <div class="ewelink-item-home">${scene.home || 'Nari home IoT'}</div>
                    </div>

                    <i class="fa-solid fa-bars ewelink-drag-handle"></i>
                  </div>
                `;
              }).join("")}
            </div>
          </div>

          <!-- Section: Advanced / Notification -->
          <div class="ewelink-advanced-card" onclick="NARI.scenes._toggleNotify()">
            <div>
              <div style="font-size:0.92rem;font-weight:700;color:var(--text);display:flex;align-items:center;">
                <span>Receive Alert</span>
                <span class="ewelink-badge-adv">Advanced</span>
              </div>
              <div class="small muted" style="margin-top:2px;">
                ${scene.notify ? `Send in-app notification when scene triggers` : `Off (Tap to enable)`}
              </div>
            </div>
            <div class="toggle" style="pointer-events:none;">
              <input type="checkbox" ${scene.notify ? 'checked' : ''}>
              <span class="track"></span>
            </div>
          </div>

          <!-- Footer Buttons -->
          ${!isNew ? `
            <button class="ewelink-del-btn" onclick="NARI.scenes._deleteScene('${scene.id}')">
              Delete
            </button>
          ` : ''}

          <button class="btn primary" style="margin-top:6px;" onclick="NARI.scenes._saveCurrentScene()">
            <i class="fa-solid fa-check"></i> Save Scene
          </button>
        </div>
      `;

      NARI.openSheet(html);
    },

    // ---------- Interactive Editor Helpers ----------
    _toggleIconTray() {
      const tray = document.getElementById("eweIconTray");
      if (tray) tray.classList.toggle("show");
    },

    _selectIcon(iconId) {
      if (!this._currentEdit) return;
      this._currentEdit.icon = iconId;
      const preview = document.getElementById("eweIconPreview");
      if (preview) {
        preview.innerHTML = `<i class="fa-solid ${iconId}"></i>`;
      }
      this._toggleIconTray();
    },

    _selectColor(colorHex) {
      if (!this._currentEdit) return;
      this._currentEdit.color = colorHex;
      const preview = document.getElementById("eweIconPreview");
      if (preview) {
        preview.style.background = colorHex;
      }
      document.querySelectorAll("#eweIconTray .color-dot").forEach(d => {
        d.classList.toggle("active", d.getAttribute("onclick").includes(colorHex));
      });
    },

    _promptHomeName() {
      const current = (this._currentEdit && this._currentEdit.home) || "Nari home IoT";
      const name = prompt("Enter Label or Home Name:", current);
      if (name && name.trim()) {
        this._currentEdit.home = name.trim();
        this._renderSceneEditor();
      }
    },

    _toggleNotify() {
      if (!this._currentEdit) return;
      this._currentEdit.notify = !this._currentEdit.notify;
      this._renderSceneEditor();
    },

    _cycleActionState(index) {
      if (!this._currentEdit || !this._currentEdit.actions[index]) return;
      const act = this._currentEdit.actions[index];
      // Cycle: false (Turn OFF) -> true (Turn ON) -> "toggle" (Toggle)
      if (act.state === false) {
        act.state = true;
        act.actionLabel = "Turn ON";
      } else if (act.state === true) {
        act.state = "toggle";
        act.actionLabel = "Toggle";
      } else {
        act.state = false;
        act.actionLabel = "Turn OFF";
      }
      this._renderSceneEditor();
    },

    _removeAction(index) {
      if (!this._currentEdit || !this._currentEdit.actions) return;
      this._currentEdit.actions.splice(index, 1);
      this._renderSceneEditor();
    },

    // ---------- Trigger Picker Modal (eWeLink If Builder) ----------
    _openTriggerPicker() {
      const devices = store.devices || [];

      let html = `
        <div class="sheet-header">
          <div>Select Trigger Condition<span class="sub">When this condition happens:</span></div>
          <button class="btn-close" onclick="NARI.scenes._renderSceneEditor()">✕</button>
        </div>

        <div class="ewelink-pick-list">
          <!-- 1. Tap to Run -->
          <div class="ewelink-pick-item" onclick="NARI.scenes._setManualTrigger()">
            <div class="ewelink-dev-icon" style="background:linear-gradient(135deg, #f59e0b, #d97706);">
              <i class="fa-solid fa-hand-pointer"></i>
            </div>
            <div>
              <b style="color:var(--text);font-size:0.92rem;display:block;">Tap to Run (Manual)</b>
              <span class="small muted">Trigger scene by tapping its card on dashboard</span>
            </div>
          </div>

          <!-- 2. Smart Switch State Change Triggers -->
          <div class="small muted" style="margin-top:10px;font-weight:700;">SMART SWITCH TRIGGER:</div>
          ${devices.length === 0 ? `
            <div class="small muted" style="padding:10px;">No smart switches added yet</div>
          ` : devices.map((d, i) => {
            const key = d.id || d.ip || d.name;
            if (d.dual) {
              const r1Lbl = d.relay1Name || 'Switch 1';
              const r2Lbl = d.relay2Name || 'Switch 2';
              return `
                <!-- Dual Switch: Relay 1 -->
                <div class="ewelink-pick-item" onclick="NARI.scenes._setDeviceTrigger('${key}', '${escJs(d.name)} &bull; 💡 ${escJs(r1Lbl)}', 'on', 1)">
                  <div class="ewelink-dev-icon" style="background:linear-gradient(135deg, #06b6d4, #0284c7);">
                    <i class="fa-solid fa-lightbulb"></i>
                  </div>
                  <div style="flex:1;">
                    <b style="color:var(--text);font-size:0.92rem;display:block;">${escHtml(d.name)} &bull; 💡 ${escHtml(r1Lbl)} Turned ON</b>
                    <span class="small muted">Triggers when Relay 1 (${escHtml(r1Lbl)}) turns ON</span>
                  </div>
                  <i class="fa-solid fa-chevron-right" style="color:var(--text-muted);font-size:0.8rem;"></i>
                </div>

                <div class="ewelink-pick-item" onclick="NARI.scenes._setDeviceTrigger('${key}', '${escJs(d.name)} &bull; 💡 ${escJs(r1Lbl)}', 'off', 1)">
                  <div class="ewelink-dev-icon" style="background:linear-gradient(135deg, #ef4444, #b91c1c);">
                    <i class="fa-solid fa-power-off"></i>
                  </div>
                  <div style="flex:1;">
                    <b style="color:var(--text);font-size:0.92rem;display:block;">${escHtml(d.name)} &bull; 💡 ${escHtml(r1Lbl)} Turned OFF</b>
                    <span class="small muted">Triggers when Relay 1 (${escHtml(r1Lbl)}) turns OFF</span>
                  </div>
                  <i class="fa-solid fa-chevron-right" style="color:var(--text-muted);font-size:0.8rem;"></i>
                </div>

                <!-- Dual Switch: Relay 2 -->
                <div class="ewelink-pick-item" onclick="NARI.scenes._setDeviceTrigger('${key}', '${escJs(d.name)} &bull; 🌀 ${escJs(r2Lbl)}', 'on', 2)">
                  <div class="ewelink-dev-icon" style="background:linear-gradient(135deg, #06b6d4, #0284c7);">
                    <i class="fa-solid fa-fan"></i>
                  </div>
                  <div style="flex:1;">
                    <b style="color:var(--text);font-size:0.92rem;display:block;">${escHtml(d.name)} &bull; 🌀 ${escHtml(r2Lbl)} Turned ON</b>
                    <span class="small muted">Triggers when Relay 2 (${escHtml(r2Lbl)}) turns ON</span>
                  </div>
                  <i class="fa-solid fa-chevron-right" style="color:var(--text-muted);font-size:0.8rem;"></i>
                </div>

                <div class="ewelink-pick-item" onclick="NARI.scenes._setDeviceTrigger('${key}', '${escJs(d.name)} &bull; 🌀 ${escJs(r2Lbl)}', 'off', 2)">
                  <div class="ewelink-dev-icon" style="background:linear-gradient(135deg, #ef4444, #b91c1c);">
                    <i class="fa-solid fa-power-off"></i>
                  </div>
                  <div style="flex:1;">
                    <b style="color:var(--text);font-size:0.92rem;display:block;">${escHtml(d.name)} &bull; 🌀 ${escHtml(r2Lbl)} Turned OFF</b>
                    <span class="small muted">Triggers when Relay 2 (${escHtml(r2Lbl)}) turns OFF</span>
                  </div>
                  <i class="fa-solid fa-chevron-right" style="color:var(--text-muted);font-size:0.8rem;"></i>
                </div>
              `;
            }
            return `
              <div class="ewelink-pick-item" onclick="NARI.scenes._setDeviceTrigger('${key}', '${escJs(d.name || 'Switch')}', 'on', 1)">
                <div class="ewelink-dev-icon" style="background:linear-gradient(135deg, #06b6d4, #0284c7);">
                  <i class="fa-solid fa-plug"></i>
                </div>
                <div style="flex:1;">
                  <b style="color:var(--text);font-size:0.92rem;display:block;">${escHtml(d.name || 'Switch')} Turned ON</b>
                  <span class="small muted">Triggers when this switch is turned ON</span>
                </div>
                <i class="fa-solid fa-chevron-right" style="color:var(--text-muted);font-size:0.8rem;"></i>
              </div>

              <div class="ewelink-pick-item" onclick="NARI.scenes._setDeviceTrigger('${key}', '${escJs(d.name || 'Switch')}', 'off', 1)">
                <div class="ewelink-dev-icon" style="background:linear-gradient(135deg, #ef4444, #b91c1c);">
                  <i class="fa-solid fa-power-off"></i>
                </div>
                <div style="flex:1;">
                  <b style="color:var(--text);font-size:0.92rem;display:block;">${escHtml(d.name || 'Switch')} Turned OFF</b>
                  <span class="small muted">Triggers when this switch is turned off</span>
                </div>
                <i class="fa-solid fa-chevron-right" style="color:var(--text-muted);font-size:0.8rem;"></i>
              </div>
            `;
          }).join("")}

          <!-- 3. Sensor / Gesture Modes -->
          <div class="small muted" style="margin-top:10px;font-weight:700;">GESTURE &amp; SENSOR MODES:</div>
          <div class="ewelink-pick-item" onclick="NARI.scenes._setSensorTrigger('clap', 'Double Clap 👏', 'Clap twice near phone')">
            <div class="ewelink-dev-icon" style="background:linear-gradient(135deg, #ec4899, #be185d);">
              <i class="fa-solid fa-hands-clapping"></i>
            </div>
            <div>
              <b style="color:var(--text);font-size:0.92rem;display:block;">Double Clap 👏</b>
              <span class="small muted">Clap hands twice near phone to trigger</span>
            </div>
          </div>

          <div class="ewelink-pick-item" onclick="NARI.scenes._setSensorTrigger('flip', 'Flip Phone Down 📱', 'Place phone face-down (Good Night)')">
            <div class="ewelink-dev-icon" style="background:linear-gradient(135deg, #6366f1, #4338ca);">
              <i class="fa-solid fa-mobile-screen"></i>
            </div>
            <div>
              <b style="color:var(--text);font-size:0.92rem;display:block;">Flip Phone Down 📱</b>
              <span class="small muted">Place phone face-down on table or bed</span>
            </div>
          </div>

          <div class="ewelink-pick-item" onclick="NARI.scenes._setSensorTrigger('shake', 'Shake Phone 📳', 'Firm phone shake')">
            <div class="ewelink-dev-icon" style="background:linear-gradient(135deg, #a855f7, #7e22ce);">
              <i class="fa-solid fa-hand"></i>
            </div>
            <div>
              <b style="color:var(--text);font-size:0.92rem;display:block;">Shake Phone 📳</b>
              <span class="small muted">Give phone a firm shake</span>
            </div>
          </div>

          <div class="ewelink-pick-item" onclick="NARI.scenes._setSensorTrigger('presence', 'Arriving Home 📍', 'Connect to home Wi-Fi')">
            <div class="ewelink-dev-icon" style="background:linear-gradient(135deg, #10b981, #047857);">
              <i class="fa-solid fa-house-chimney"></i>
            </div>
            <div>
              <b style="color:var(--text);font-size:0.92rem;display:block;">Arriving Home 📍</b>
              <span class="small muted">Triggers automatically when connecting to home Wi-Fi</span>
            </div>
          </div>
        </div>
      `;

      NARI.openSheet(html);
    },

    _setManualTrigger() {
      if (!this._currentEdit) return;
      this._currentEdit.trigger = {
        type: "manual",
        label: "Tap to Run",
        subLabel: "1-Tap from Dashboard"
      };
      this._renderSceneEditor();
    },

    _setDeviceTrigger(devKey, devName, condition, relay) {
      if (!this._currentEdit) return;
      const relayNum = relay === 2 ? 2 : 1;
      const condLabel = condition === "on" ? "When switch turns ON" : "When switch turns OFF";
      this._currentEdit.trigger = {
        type: "device",
        deviceId: devKey,
        deviceName: devName,
        condition,
        relay: relayNum,
        label: devName,
        subLabel: condLabel
      };
      this._renderSceneEditor();
    },

    _setSensorTrigger(mode, label, subLabel) {
      if (!this._currentEdit) return;
      this._currentEdit.trigger = {
        type: "sensor",
        mode,
        label,
        subLabel
      };
      this._renderSceneEditor();
    },

    // ---------- Action Picker Modal (eWeLink Then Builder) ----------
    _openAddActionPicker() {
      const devices = store.devices || [];

      let html = `
        <div class="sheet-header">
          <div>Add Action Device<span class="sub">Select smart switch to control:</span></div>
          <button class="btn-close" onclick="NARI.scenes._renderSceneEditor()">✕</button>
        </div>

        <div class="ewelink-pick-list">
          ${devices.length === 0 ? `
            <div class="small muted" style="padding:14px;text-align:center;">No switches found in your home</div>
          ` : devices.map((d, i) => {
            const key = d.id || d.ip || d.name;
            if (d.dual) {
              const r1Lbl = d.relay1Name || 'Switch 1';
              const r2Lbl = d.relay2Name || 'Switch 2';
              return `
                <!-- Dual Switch: Relay 1 Action -->
                <div class="ewelink-pick-item" onclick="NARI.scenes._addAction('${key}', '${escJs(d.name)} &bull; 💡 ${escJs(r1Lbl)}', 1)">
                  <div class="ewelink-dev-icon" style="background:linear-gradient(135deg, #0ea5e9, #0284c7);">
                    <i class="fa-solid fa-lightbulb"></i>
                  </div>
                  <div style="flex:1;">
                    <b style="color:var(--text);font-size:0.92rem;display:block;">${escHtml(d.name)} &bull; 💡 ${escHtml(r1Lbl)}</b>
                    <span class="small muted">${escHtml(d.room || 'Living Room')} &bull; Relay 1 Only</span>
                  </div>
                  <div class="ewelink-add-action-btn" style="width:26px;height:26px;font-size:0.8rem;">
                    <i class="fa-solid fa-plus"></i>
                  </div>
                </div>

                <!-- Dual Switch: Relay 2 Action -->
                <div class="ewelink-pick-item" onclick="NARI.scenes._addAction('${key}', '${escJs(d.name)} &bull; 🌀 ${escJs(r2Lbl)}', 2)">
                  <div class="ewelink-dev-icon" style="background:linear-gradient(135deg, #0ea5e9, #0284c7);">
                    <i class="fa-solid fa-fan"></i>
                  </div>
                  <div style="flex:1;">
                    <b style="color:var(--text);font-size:0.92rem;display:block;">${escHtml(d.name)} &bull; 🌀 ${escHtml(r2Lbl)}</b>
                    <span class="small muted">${escHtml(d.room || 'Living Room')} &bull; Relay 2 Only</span>
                  </div>
                  <div class="ewelink-add-action-btn" style="width:26px;height:26px;font-size:0.8rem;">
                    <i class="fa-solid fa-plus"></i>
                  </div>
                </div>

                <!-- Dual Switch: Both Relays Action -->
                <div class="ewelink-pick-item" onclick="NARI.scenes._addAction('${key}', '${escJs(d.name)} &bull; ⚡ Both Switches', 'both')">
                  <div class="ewelink-dev-icon" style="background:linear-gradient(135deg, #8b5cf6, #6d28d9);">
                    <i class="fa-solid fa-bolt"></i>
                  </div>
                  <div style="flex:1;">
                    <b style="color:var(--text);font-size:0.92rem;display:block;">${escHtml(d.name)} &bull; ⚡ Both Switches</b>
                    <span class="small muted">${escHtml(d.room || 'Living Room')} &bull; Controls both relays simultaneously</span>
                  </div>
                  <div class="ewelink-add-action-btn" style="width:26px;height:26px;font-size:0.8rem;">
                    <i class="fa-solid fa-plus"></i>
                  </div>
                </div>
              `;
            }
            return `
              <div class="ewelink-pick-item" onclick="NARI.scenes._addAction('${key}', '${escJs(d.name || 'Switch')}', 1)">
                <div class="ewelink-dev-icon" style="background:linear-gradient(135deg, #0ea5e9, #0284c7);">
                  <i class="fa-solid fa-plug"></i>
                </div>
                <div style="flex:1;">
                  <b style="color:var(--text);font-size:0.95rem;display:block;">${escHtml(d.name || 'Switch')}</b>
                  <span class="small muted">${escHtml(d.room || 'Nari home IoT')} &bull; ${escHtml(d.ip || 'Online')}</span>
                </div>
                <div class="ewelink-add-action-btn" style="width:26px;height:26px;font-size:0.8rem;">
                  <i class="fa-solid fa-plus"></i>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;

      NARI.openSheet(html);
    },

    _addAction(devKey, devName, relay) {
      if (!this._currentEdit) return;
      if (!Array.isArray(this._currentEdit.actions)) this._currentEdit.actions = [];

      // Add with default action = false (Turn OFF) or toggle
      this._currentEdit.actions.push({
        deviceId: devKey,
        deviceName: devName,
        relay: relay || 1,
        state: false,
        actionLabel: "Turn OFF"
      });

      this._renderSceneEditor();
    },

    // ---------- Save & Delete Handlers ----------
    _saveCurrentScene() {
      const scene = this._currentEdit;
      if (!scene) return;

      const nameInput = document.getElementById("eweSceneName");
      const name = (nameInput ? nameInput.value : scene.name || "").trim();
      if (!name) {
        alert("Please enter a scene name.");
        return;
      }
      scene.name = name;

      // Update subtitle summary
      if (scene.trigger && scene.trigger.label) {
        scene.subtitle = `If ${scene.trigger.label} -> ${scene.actions.length} action(s)`;
      } else {
        scene.subtitle = `${scene.actions.length} switches set`;
      }

      delete scene.isNew;

      const idx = this.list.findIndex(s => s.id === scene.id);
      if (idx >= 0) {
        this.list[idx] = scene;
      } else {
        this.list.push(scene);
      }

      saveLocalScenes(this.list);
      if (NARI.closeSheet) NARI.closeSheet();
      if (NARI.showToast) NARI.showToast(`✅ Scene "${name}" saved!`, "ok");

      if (NARI.app && NARI.app.renderDeviceCards) {
        NARI.app.renderDeviceCards();
      }
    },

    _deleteScene(sceneId) {
      if (!confirm("Are you sure you want to delete this smart scene?")) return;
      this.list = this.list.filter(s => s.id !== sceneId);
      saveLocalScenes(this.list);
      if (NARI.closeSheet) NARI.closeSheet();
      if (NARI.showToast) NARI.showToast("Scene deleted", "ok");
      if (NARI.app && NARI.app.renderDeviceCards) {
        NARI.app.renderDeviceCards();
      }
    },

    // ---------- Top-Right Icon: Smart Scenes Hub Modal ----------
    openScenesHub() {
      const isSuper = this.isSupervisor();
      const currentActive = this.activeSceneId;

      const html = `
        <div class="sheet-header">
          <div>
            <i class="fa-solid fa-wand-magic-sparkles" style="color:var(--accent);margin-right:6px;"></i>
            Smart Scenes &amp; Automations
            <span class="sub">${this.list.length} Automations Ready &bull; Parallel sub-100ms</span>
          </div>
          <button class="btn-close" onclick="NARI.closeSheet()">✕</button>
        </div>

        <div class="scenes-hub-modal">
          <!-- Fast Master Controls -->
          <div class="scenes-hub-top-row">
            <button class="scene-fast-btn all-off grow" onclick="NARI.scenes.allOff()" title="Turn all switches OFF">
              <i class="fa-solid fa-moon"></i> All OFF
            </button>
            <button class="scene-fast-btn all-on grow" onclick="NARI.scenes.allOn()" title="Turn all switches ON">
              <i class="fa-solid fa-bolt"></i> All ON
            </button>
            ${isSuper ? `
              <button class="scene-add-btn" onclick="NARI.scenes.openSceneEditor()" title="Create New Smart Scene (Home Admin)">
                <i class="fa-solid fa-plus"></i> New
              </button>
            ` : ''}
          </div>

          <!-- Scenes Grid -->
          <div class="scenes-grid-wrap">
            ${this.list.map(s => {
              const isActive = s.id === currentActive;
              let triggerTag = "";
              if (s.trigger) {
                if (s.trigger.type === "device") triggerTag = `⚡ ${s.trigger.label || 'Switch'}`;
                else if (s.trigger.mode === "clap") triggerTag = `👏 Clap`;
                else if (s.trigger.mode === "flip") triggerTag = `📱 Flip`;
                else if (s.trigger.mode === "shake") triggerTag = `📳 Shake`;
                else if (s.trigger.mode === "presence") triggerTag = `📍 Arrive`;
              }

              return `
                <div class="scene-card ${isActive ? 'active' : ''}" style="--scene-color:${s.color || 'var(--primary)'};" onclick="NARI.scenes.executeScene('${s.id}')">
                  <div class="scene-top-row">
                    <div class="scene-icon-badge" style="background:${s.color || 'var(--primary)'};">
                      <i class="fa-solid ${s.icon || 'fa-wand-magic-sparkles'}"></i>
                    </div>
                    ${isSuper ? `
                      <button class="scene-edit-btn" onclick="event.stopPropagation(); NARI.scenes.openSceneEditor('${s.id}')" title="Edit Scene (Home Admin)">
                        <i class="fa-solid fa-pen"></i>
                      </button>
                    ` : ''}
                  </div>
                  <div class="scene-info">
                    <b class="scene-name">${String(s.name || 'Scene').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}</b>
                    <span class="scene-sub">${String(s.subtitle || '1-Tap Scene').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}</span>
                  </div>
                  ${triggerTag ? `
                    <div class="scene-trigger-tag">
                      ${triggerTag}
                    </div>
                  ` : ''}
                </div>
              `;
            }).join("")}
          </div>

          <div class="small muted text-center" style="margin-top:12px;text-align:center;">
            <i class="fa-solid fa-shield-halved" style="color:var(--accent);margin-right:4px;"></i>
            <span>${isSuper ? '👑 Home Admin: Tap card to run, or tap pencil to edit with eWeLink builder.' : 'Family Mode: Tap any scene to run.'}</span>
          </div>
        </div>
      `;

      NARI.openSheet(html);
    },

    // ---------- Dashboard Render Helper ----------
    renderDashboardBar() {
      const isSuper = this.isSupervisor();
      const currentActive = this.activeSceneId;

      return `
        <div class="smart-scenes-hub">
          <!-- Hub Header -->
          <div class="hub-header">
            <div class="hub-title">
              <i class="fa-solid fa-wand-magic-sparkles" style="color:var(--accent);"></i>
              <span>Smart Scenes</span>
              <span class="hub-badge">${this.list.length} Ready</span>
            </div>
            <div class="hub-actions">
              <button class="scene-fast-btn all-off" onclick="NARI.scenes.allOff()" title="Turn all switches OFF">
                <i class="fa-solid fa-moon"></i> All OFF
              </button>
              <button class="scene-fast-btn all-on" onclick="NARI.scenes.allOn()" title="Turn all switches ON">
                <i class="fa-solid fa-bolt"></i> All ON
              </button>
              ${isSuper ? `
                <button class="scene-add-btn" onclick="NARI.scenes.openSceneEditor()" title="Create New Smart Scene (Home Admin)">
                  <i class="fa-solid fa-plus"></i> New
                </button>
              ` : ''}
            </div>
          </div>

          <!-- Horizontal Scenes Carousel (Visual Apple Home / eWeLink style) -->
          <div class="scenes-carousel">
            ${this.list.map(s => {
              const isActive = s.id === currentActive;
              let triggerTag = "";
              if (s.trigger) {
                if (s.trigger.type === "device") triggerTag = `⚡ ${s.trigger.label || 'Switch'}`;
                else if (s.trigger.mode === "clap") triggerTag = `👏 Clap`;
                else if (s.trigger.mode === "flip") triggerTag = `📱 Flip`;
                else if (s.trigger.mode === "shake") triggerTag = `📳 Shake`;
                else if (s.trigger.mode === "presence") triggerTag = `📍 Arrive`;
              }

              return `
                <div class="scene-card ${isActive ? 'active' : ''}" style="--scene-color:${s.color || 'var(--primary)'};" onclick="NARI.scenes.executeScene('${s.id}')">
                  <div class="scene-top-row">
                    <div class="scene-icon-badge" style="background:${s.color || 'var(--primary)'};">
                      <i class="fa-solid ${s.icon || 'fa-wand-magic-sparkles'}"></i>
                    </div>
                    ${isSuper ? `
                      <button class="scene-edit-btn" onclick="event.stopPropagation(); NARI.scenes.openSceneEditor('${s.id}')" title="Edit Scene (Home Admin)">
                        <i class="fa-solid fa-pen"></i>
                      </button>
                    ` : ''}
                  </div>
                  <div class="scene-info">
                    <b class="scene-name">${String(s.name || 'Scene').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}</b>
                    <span class="scene-sub">${String(s.subtitle || '1-Tap Scene').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}</span>
                  </div>
                  ${triggerTag ? `
                    <div class="scene-trigger-tag">
                      ${triggerTag}
                    </div>
                  ` : ''}
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }
  };

  NARI.scenes = scenes;

  // Initialize scenes
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => scenes.init());
  } else {
    scenes.init();
  }
})(window);
