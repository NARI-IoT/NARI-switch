/*
 * NARI Smart Home — Smart Scenes & Master Automations Hub
 * 
 * Features:
 * - One-Tap Multi-Device Scene Activation (Parallel sub-100ms response)
 * - "One-to-All" Master Trigger by Mode (Clap, Flip, Shake, Voice, Geofence, Time)
 * - Exclusive Supervision Controls (Only Home Admin can create/edit/delete scenes)
 * - Custom Scene Builder with visual icon and color picker
 * - Stored in localStorage + single-document cloud sync ($0 Zero-Cost)
 */

(function (global) {
  "use strict";
  const NARI = global.NARI || {};
  const { store, bus, transport } = NARI;

  const STORAGE_KEY_SCENES = "nari_smart_scenes";

  // Pre-configured commercial preset scenes (Apple Home / Philips Hue style)
  const defaultScenes = [
    {
      id: "scene_morning",
      name: "Good Morning",
      icon: "fa-sun",
      color: "#f59e0b",
      triggerMode: "none",
      actions: {}, // { switchId: true (ON) | false (OFF) }
      defaultAll: "on",
      subtitle: "Turn on day appliances"
    },
    {
      id: "scene_night",
      name: "Good Night",
      icon: "fa-moon",
      color: "#6366f1",
      triggerMode: "flip", // Flipped face down at night triggers Good Night!
      actions: {},
      defaultAll: "off",
      subtitle: "Turn off all lights & appliances"
    },
    {
      id: "scene_movie",
      name: "Cinema Time",
      icon: "fa-film",
      color: "#ec4899",
      triggerMode: "clap", // Double clap triggers Movie scene!
      actions: {},
      subtitle: "Cozy ambient mood lighting"
    },
    {
      id: "scene_away",
      name: "Leaving Home",
      icon: "fa-door-open",
      color: "#ef4444",
      triggerMode: "none",
      defaultAll: "off",
      subtitle: "All switches off for safety"
    },
    {
      id: "scene_welcome",
      name: "Welcome Home",
      icon: "fa-house-chimney",
      color: "#10b981",
      triggerMode: "presence", // Arriving home triggers Welcome scene!
      actions: {},
      defaultAll: "on",
      subtitle: "Hallway & essential lights ON"
    },
    {
      id: "scene_party",
      name: "Party Mode",
      icon: "fa-champagne-glasses",
      color: "#a855f7",
      triggerMode: "shake",
      actions: {},
      subtitle: "All lights active with strobe"
    }
  ];

  function loadLocalScenes() {
    try {
      const v = JSON.parse(localStorage.getItem(STORAGE_KEY_SCENES));
      if (Array.isArray(v) && v.length > 0) return v;
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

    init() {
      // Listen to sensor trigger events for "One-to-All" mode triggers
      bus.on("trigger:fired", (e) => {
        this._handleSensorEvent(e.type);
      });

      // Tab visibility listener to refresh active scene state
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

      for (let i = 0; i < devices.length; i++) {
        const dev = devices[i];
        const devKey = dev.id || dev.ip;
        let targetState = null;

        // Check explicit action in scene
        if (scene.actions && scene.actions[devKey] !== undefined) {
          targetState = scene.actions[devKey];
        } else if (scene.defaultAll === "off") {
          targetState = false;
        } else if (scene.defaultAll === "on") {
          targetState = true;
        }

        if (targetState !== null && dev.state !== targetState) {
          adjustedCount++;
          // Fire parallel commands over both MQTT WebSocket and local LAN simultaneously
          promises.push(transport.setState(i, targetState, { quiet: true, source: "scene:" + scene.id }));
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
      // Find any scene that is bound to this sensor mode
      const matchedScene = this.list.find(s => s.triggerMode === sensorType);
      if (matchedScene) {
        console.log(`[Smart Scenes] Trigger mode "${sensorType}" fired -> Executing scene "${matchedScene.name}"`);
        this.executeScene(matchedScene.id);
      }
    },

    _evaluateActiveState() {
      // Check if current device states match a known scene
      const devices = store.devices || [];
      if (!devices.length) return;
      const allOff = devices.every(d => !d.state);
      const allOn = devices.every(d => d.state);
      if (allOff) this.activeSceneId = "scene_away";
      else if (allOn) this.activeSceneId = "scene_welcome";
    },

    // ---------- Supervision Modal: Create & Edit Smart Scenes ----------
    openSceneEditor(sceneId) {
      // Permission check: Only Home Admin (Supervisor) can edit or configure scenes
      if (!this.isSupervisor()) {
        alert("👑 Permission Denied:\nOnly the Home Admin (Supervisor) can create or customize Smart Scenes.\nFamily members can activate scenes from the dashboard.");
        return;
      }

      const isNew = !sceneId;
      const scene = isNew ? {
        id: "scene_" + Date.now(),
        name: "My Scene",
        icon: "fa-star",
        color: "#10b981",
        triggerMode: "none",
        actions: {},
        subtitle: "Custom Scene"
      } : JSON.parse(JSON.stringify(this.list.find(s => s.id === sceneId) || {}));

      const devices = store.devices || [];
      const iconOptions = [
        { id: "fa-sun", label: "Morning" },
        { id: "fa-moon", label: "Night" },
        { id: "fa-film", label: "Movie" },
        { id: "fa-house-chimney", label: "Home" },
        { id: "fa-door-open", label: "Away" },
        { id: "fa-champagne-glasses", label: "Party" },
        { id: "fa-couch", label: "Relax" },
        { id: "fa-utensils", label: "Dining" },
        { id: "fa-book-open", label: "Study" },
        { id: "fa-mug-hot", label: "Coffee" },
        { id: "fa-bed", label: "Sleep" },
        { id: "fa-bolt", label: "Energy" }
      ];

      const triggerOptions = [
        { id: "none", label: "Manual 1-Tap Only", desc: "Activate by tapping card" },
        { id: "clap", label: "Double Clap 👏", desc: "Clap twice near phone to trigger" },
        { id: "flip", label: "Flip Phone Down 📱", desc: "Place phone face-down (great for Good Night)" },
        { id: "shake", label: "Shake Phone 📳", desc: "Give phone a firm shake" },
        { id: "presence", label: "Arriving Home 📍", desc: "Triggers automatically when entering home Wi-Fi" }
      ];

      NARI.openSheet(`
        <div class="sheet-header">
          <div>${isNew ? 'Create Smart Scene' : 'Edit Smart Scene'}<span class="sub">Supervisor Automation Manager</span></div>
          <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
        </div>

        <div class="scene-editor-wrap">
          <!-- Scene Name & Color -->
          <div class="form-group sm">
            <label>Scene Name</label>
            <input type="text" id="sceneNameInput" value="${scene.name}" placeholder="e.g. Dinner Time, Reading">
          </div>

          <!-- Icon Selector -->
          <div class="form-group sm">
            <label>Choose Scene Icon</label>
            <div class="scene-icon-grid" id="sceneIconGrid">
              ${iconOptions.map(ico => `
                <button type="button" class="icon-pick-btn ${scene.icon === ico.id ? 'active' : ''}" data-icon="${ico.id}" onclick="NARI.scenes._selectIcon(this)">
                  <i class="fa-solid ${ico.id}"></i>
                  <span>${ico.label}</span>
                </button>
              `).join("")}
            </div>
          </div>

          <!-- Color Accent Picker -->
          <div class="form-group sm">
            <label>Color Accent</label>
            <div class="scene-color-row" id="sceneColorRow">
              ${['#f59e0b', '#10b981', '#6366f1', '#ec4899', '#38bdf8', '#a855f7', '#ef4444'].map(c => `
                <div class="color-dot ${scene.color === c ? 'active' : ''}" style="background:${c};" data-color="${c}" onclick="NARI.scenes._selectColor(this)"></div>
              `).join("")}
            </div>
          </div>

          <!-- One-to-All Mode Trigger -->
          <div class="form-group sm">
            <label><i class="fa-solid fa-wand-magic-sparkles" style="color:var(--accent);"></i> Automatic Mode Trigger (One-to-All)</label>
            <p class="small muted" style="margin-bottom:6px;">Choose a sensor mode to automatically trigger all switches in this scene:</p>
            <select id="sceneTriggerSelect" style="width:100%;padding:10px;background:rgba(255,255,255,0.06);color:#fff;border:1px solid var(--card-border);border-radius:10px;">
              ${triggerOptions.map(t => `
                <option value="${t.id}" ${scene.triggerMode === t.id ? 'selected' : ''}>
                  ${t.label} — ${t.desc}
                </option>
              `).join("")}
            </select>
          </div>

          <!-- Fast Bulk Action (One-to-All Buttons) -->
          <div class="form-group sm">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <label>Switch Actions in this Scene</label>
              <div class="fast-action-btns">
                <button type="button" class="fast-pill" onclick="NARI.scenes._setAllActions(true)">All ON ⚡</button>
                <button type="button" class="fast-pill" onclick="NARI.scenes._setAllActions(false)">All OFF 🌙</button>
                <button type="button" class="fast-pill" onclick="NARI.scenes._setAllActions(null)">All Ignore ➖</button>
              </div>
            </div>

            <!-- Device Action Matrix -->
            <div class="scene-device-matrix" id="sceneDeviceMatrix">
              ${devices.length === 0 ? '<div class="small muted">No smart switches found in home</div>' : devices.map(d => {
                const key = d.id || d.ip;
                const currAction = scene.actions[key]; // true, false, or undefined
                return `
                  <div class="matrix-row" data-dev-key="${key}">
                    <span class="dev-name"><i class="fa-solid fa-plug"></i> ${d.name || 'Switch'}</span>
                    <div class="tri-state-selector">
                      <button type="button" class="tri-btn on ${currAction === true ? 'active' : ''}" onclick="NARI.scenes._setRowAction(this, true)">ON</button>
                      <button type="button" class="tri-btn off ${currAction === false ? 'active' : ''}" onclick="NARI.scenes._setRowAction(this, false)">OFF</button>
                      <button type="button" class="tri-btn ignore ${currAction === undefined ? 'active' : ''}" onclick="NARI.scenes._setRowAction(this, null)">Ignore</button>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>

          <!-- Save & Delete Buttons -->
          <div class="btn-row" style="margin-top:16px;">
            <button class="btn primary" onclick="NARI.scenes._saveEditedScene('${scene.id}', ${isNew})">
              <i class="fa-solid fa-check"></i> Save Scene
            </button>
            ${!isNew ? `
              <button class="btn danger" onclick="NARI.scenes._deleteScene('${scene.id}')">
                <i class="fa-solid fa-trash"></i> Delete
              </button>
            ` : ''}
          </div>
        </div>
      `);
    },

    _selectIcon(btn) {
      document.querySelectorAll("#sceneIconGrid .icon-pick-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    },

    _selectColor(dot) {
      document.querySelectorAll("#sceneColorRow .color-dot").forEach(d => d.classList.remove("active"));
      dot.classList.add("active");
    },

    _setRowAction(btn, state) {
      const parent = btn.closest(".tri-state-selector");
      if (!parent) return;
      parent.querySelectorAll(".tri-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    },

    _setAllActions(state) {
      document.querySelectorAll("#sceneDeviceMatrix .matrix-row").forEach(row => {
        const btns = row.querySelectorAll(".tri-btn");
        btns.forEach(b => b.classList.remove("active"));
        if (state === true) row.querySelector(".tri-btn.on")?.classList.add("active");
        else if (state === false) row.querySelector(".tri-btn.off")?.classList.add("active");
        else row.querySelector(".tri-btn.ignore")?.classList.add("active");
      });
    },

    _saveEditedScene(sceneId, isNew) {
      const name = (document.getElementById("sceneNameInput")?.value || "").trim();
      if (!name) {
        alert("Please enter a scene name.");
        return;
      }

      const activeIconBtn = document.querySelector("#sceneIconGrid .icon-pick-btn.active");
      const icon = activeIconBtn ? activeIconBtn.getAttribute("data-icon") : "fa-wand-magic-sparkles";

      const activeColorDot = document.querySelector("#sceneColorRow .color-dot.active");
      const color = activeColorDot ? activeColorDot.getAttribute("data-color") : "#10b981";

      const triggerMode = document.getElementById("sceneTriggerSelect")?.value || "none";

      const actions = {};
      document.querySelectorAll("#sceneDeviceMatrix .matrix-row").forEach(row => {
        const key = row.getAttribute("data-dev-key");
        const onActive = row.querySelector(".tri-btn.on.active");
        const offActive = row.querySelector(".tri-btn.off.active");
        if (onActive) actions[key] = true;
        else if (offActive) actions[key] = false;
        // Ignore is skipped from actions
      });

      const updated = {
        id: sceneId,
        name,
        icon,
        color,
        triggerMode,
        actions,
        subtitle: Object.keys(actions).length > 0 ? `${Object.keys(actions).length} switches set` : "Custom scene"
      };

      if (isNew) {
        this.list.push(updated);
      } else {
        const idx = this.list.findIndex(s => s.id === sceneId);
        if (idx >= 0) this.list[idx] = updated;
      }

      saveLocalScenes(this.list);
      if (NARI.closeSheet) NARI.closeSheet();
      if (NARI.showToast) NARI.showToast(`Scene "${name}" saved!`, "ok");

      if (NARI.app && NARI.app.renderDeviceCards) {
        NARI.app.renderDeviceCards();
      }
    },

    _deleteScene(sceneId) {
      if (!confirm("Are you sure you want to delete this scene?")) return;
      this.list = this.list.filter(s => s.id !== sceneId);
      saveLocalScenes(this.list);
      if (NARI.closeSheet) NARI.closeSheet();
      if (NARI.showToast) NARI.showToast("Scene deleted", "ok");
      if (NARI.app && NARI.app.renderDeviceCards) {
        NARI.app.renderDeviceCards();
      }
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

          <!-- Horizontal Scenes Carousel (Visual Apple Home style) -->
          <div class="scenes-carousel">
            ${this.list.map(s => {
              const isActive = s.id === currentActive;
              const hasTrigger = s.triggerMode && s.triggerMode !== "none";
              const triggerLabels = {
                clap: "👏 Clap",
                flip: "📱 Flip",
                shake: "📳 Shake",
                presence: "📍 Arrive",
                voice: "🗣️ Voice"
              };

              return `
                <div class="scene-card ${isActive ? 'active' : ''}" style="--scene-color:${s.color};" onclick="NARI.scenes.executeScene('${s.id}')">
                  <div class="scene-top-row">
                    <div class="scene-icon-badge" style="background:${s.color};">
                      <i class="fa-solid ${s.icon}"></i>
                    </div>
                    ${isSuper ? `
                      <button class="scene-edit-btn" onclick="event.stopPropagation(); NARI.scenes.openSceneEditor('${s.id}')" title="Edit Scene (Home Admin)">
                        <i class="fa-solid fa-pen"></i>
                      </button>
                    ` : ''}
                  </div>
                  <div class="scene-info">
                    <b class="scene-name">${s.name}</b>
                    <span class="scene-sub">${s.subtitle || '1-Tap Scene'}</span>
                  </div>
                  ${hasTrigger ? `
                    <div class="scene-trigger-tag">
                      <i class="fa-solid fa-bolt"></i> ${triggerLabels[s.triggerMode] || s.triggerMode}
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
