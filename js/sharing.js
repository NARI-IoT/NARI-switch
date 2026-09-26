/*
 * NARI Smart Home — Family Sharing, Role Supervision & Guest Access System
 *
 * 100% Zero-Cost Architecture:
 * - Temporary Guest Pass requires NO LOGIN and creates ZERO Firebase reads/writes.
 * - Activity log uses internal phone clock (Date.now()) and phone localStorage.
 * - Simple, visual UI designed specifically for non-technical family members.
 */

(function (global) {
  "use strict";
  const NARI = global.NARI || {};
  const { store, bus, transport } = NARI;

  const STORAGE_KEY_SHARING = "nari_family_sharing";
  const STORAGE_KEY_LOGS    = "nari_activity_logs";

  function loadLocal(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function saveLocal(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
  }

  const defaultSharingState = {
    homeName: "My Home",
    role: "admin", // "admin" (Primary), "co-admin", "member", "guest"
    admins: [],    // Max 2: [{ email, name, role: 'primary'|'co-admin' }]
    members: [],   // [{ id, name, email, role: 'member' }]
    publicSwitchIds: [], // Switches that any family member can edit & delete
    activeGuests: [],    // [{ id, name, exp, switches: [] }]
    primaryLastSeen: Date.now()
  };

  const sharing = {
    data: Object.assign({}, defaultSharingState, loadLocal(STORAGE_KEY_SHARING, {})),
    isGuestMode: false,
    guestConfig: null,

    init() {
      // Check if URL has a Guest Pass token
      this._checkGuestUrl();

      // Ensure Admin list has current user if logged in
      if (!this.data.admins || this.data.admins.length === 0) {
        const u = store.currentUser;
        this.data.admins = [{
          email: u ? u.email : "admin@narismarthome.local",
          name: u ? (u.displayName || u.email.split("@")[0]) : "Home Owner",
          role: "primary",
          addedAt: Date.now()
        }];
        this.save();
      }

      // Listen for switch changes to record phone-clock activity log
      bus.on("device:updated", (idx) => {
        const dev = store.devices[idx];
        if (!dev) return;
        this.logActivity(`${dev.name} is now turned ${dev.state ? "ON ⚡" : "OFF 🌙"}`, dev.state ? "on" : "off");
      });

      // Render UI components
      this._bindSidebarEvents();
    },

    save() {
      saveLocal(STORAGE_KEY_SHARING, this.data);
      if (store.save) store.save();
    },

    // ---------- Activity Log (Inbuilt Phone Time - 100% Free) ----------
    logActivity(text, state) {
      const logs = loadLocal(STORAGE_KEY_LOGS, []);
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
      const dateStr = now.toLocaleDateString([], { month: 'short', day: 'numeric' });

      logs.unshift({
        id: "log_" + Date.now(),
        text,
        state,
        time: timeStr,
        date: dateStr,
        timestamp: Date.now()
      });

      // Keep only latest 40 entries to protect local memory
      if (logs.length > 40) logs.pop();
      saveLocal(STORAGE_KEY_LOGS, logs);

      // Refresh log in sidebar if open
      const logContainer = document.getElementById("sidebarActivityList");
      if (logContainer) logContainer.innerHTML = this.renderActivityLogHtml();
    },

    getLogs() {
      return loadLocal(STORAGE_KEY_LOGS, []);
    },

    clearLogs() {
      saveLocal(STORAGE_KEY_LOGS, []);
      const logContainer = document.getElementById("sidebarActivityList");
      if (logContainer) logContainer.innerHTML = `<div class="empty-log"><i class="fa-solid fa-clock-rotate-left"></i> No recent switch activity recorded</div>`;
      if (NARI.showToast) NARI.showToast("Activity history cleared", "ok");
    },

    // ---------- Roles & Permissions Helpers ----------
    getCurrentRole() {
      if (this.isGuestMode) return "guest";
      const u = store.currentUser;
      if (!u) return this.data.role || "admin";

      const email = (u.email || "").toLowerCase();
      const adminMatch = this.data.admins.find(a => (a.email || "").toLowerCase() === email);
      if (adminMatch) return adminMatch.role === "primary" ? "admin" : "co-admin";

      const memberMatch = this.data.members.find(m => (m.email || "").toLowerCase() === email);
      if (memberMatch) return "member";

      return "admin"; // Default owner if first user
    },

    isSupervisor() {
      const r = this.getCurrentRole();
      return r === "admin" || r === "co-admin";
    },

    canDeleteSwitch(dev) {
      if (this.isSupervisor()) return true;
      // Public switches in common areas can be deleted by any family member
      if (this.isPublicSwitch(dev)) return true;
      return false;
    },

    isPublicSwitch(dev) {
      const id = dev.id || dev.ip;
      return (this.data.publicSwitchIds || []).includes(id);
    },

    togglePublicSwitch(devId) {
      if (!this.data.publicSwitchIds) this.data.publicSwitchIds = [];
      const idx = this.data.publicSwitchIds.indexOf(devId);
      if (idx >= 0) {
        this.data.publicSwitchIds.splice(idx, 1);
        if (NARI.showToast) NARI.showToast("Switch marked as Private", "info");
      } else {
        this.data.publicSwitchIds.push(devId);
        if (NARI.showToast) NARI.showToast("Switch marked as Public (Anyone can edit/delete)", "ok");
      }
      this.save();
      this.renderSidebar();
    },

    // ---------- Family Management (Max 2 Admins) ----------
    addFamilyMember(name, email) {
      if (!name || !email) return;
      if (this.data.members.some(m => m.email.toLowerCase() === email.toLowerCase())) {
        if (NARI.showToast) NARI.showToast("Member already in family", "warn");
        return;
      }
      this.data.members.push({
        id: "fam_" + Date.now(),
        name,
        email,
        role: "member",
        addedAt: Date.now()
      });
      this.save();
      if (NARI.showToast) NARI.showToast(`Added ${name} to Family!`, "ok");
      this.renderSidebar();
    },

    removeFamilyMember(email) {
      this.data.members = this.data.members.filter(m => m.email.toLowerCase() !== email.toLowerCase());
      this.data.admins = this.data.admins.filter(a => a.email.toLowerCase() !== email.toLowerCase());
      this.save();
      if (NARI.showToast) NARI.showToast("Member removed", "ok");
      this.renderSidebar();
    },

    promoteToCoAdmin(email) {
      // RULE: Only 2 Supervisors/Admins allowed total
      if (this.data.admins.length >= 2) {
        alert("Maximum 2 Home Admins allowed!\nPlease demote or remove the other Admin first before adding a new one.");
        return;
      }
      const mem = this.data.members.find(m => m.email.toLowerCase() === email.toLowerCase());
      if (!mem) return;

      this.data.admins.push({
        email: mem.email,
        name: mem.name,
        role: "co-admin",
        addedAt: Date.now()
      });
      this.data.members = this.data.members.filter(m => m.email.toLowerCase() !== email.toLowerCase());
      this.save();
      if (NARI.showToast) NARI.showToast(`${mem.name} is now Home Co-Admin 👑`, "ok");
      this.renderSidebar();
    },

    demoteToMember(email) {
      const adm = this.data.admins.find(a => a.email.toLowerCase() === email.toLowerCase());
      if (!adm || adm.role === "primary") {
        if (NARI.showToast) NARI.showToast("Primary Admin cannot be demoted", "warn");
        return;
      }
      this.data.admins = this.data.admins.filter(a => a.email.toLowerCase() !== email.toLowerCase());
      this.data.members.push({
        id: "fam_" + Date.now(),
        name: adm.name,
        email: adm.email,
        role: "member",
        addedAt: Date.now()
      });
      this.save();
      if (NARI.showToast) NARI.showToast(`${adm.name} changed to Family Member`, "info");
      this.renderSidebar();
    },

    // ---------- Emergency Admin Succession ----------
    claimEmergencyAdmin() {
      const u = store.currentUser;
      if (!u || !u.email) {
        alert("Please log in first to claim Admin status.");
        return;
      }
      const confirmed = confirm(
        "EMERGENCY SUCCESSION:\n\nIf the previous Home Admin is lost, deleted, or permanently offline, you can become the new Primary Home Admin.\n\nDo you want to proceed?"
      );
      if (!confirmed) return;

      this.data.admins = [{
        email: u.email,
        name: u.displayName || u.email.split("@")[0],
        role: "primary",
        addedAt: Date.now()
      }];
      this.data.role = "admin";
      this.save();
      if (NARI.showToast) NARI.showToast("You are now the Primary Home Admin 👑", "ok");
      this.renderSidebar();
    },

    // ---------- Temporary Guest Pass (No Login, Zero Cost) ----------
    createGuestPass(name, durationHours, allowedSwitchIds) {
      if (!allowedSwitchIds || allowedSwitchIds.length === 0) {
        alert("Please select at least 1 switch for the guest!");
        return null;
      }
      const expTime = Date.now() + (durationHours * 60 * 60 * 1000);
      const guestId = "gst_" + Math.random().toString(36).slice(2, 9);
      
      const passData = {
        gid: guestId,
        hname: this.data.homeName || "NARI Home",
        gname: name || "Guest",
        sw: allowedSwitchIds,
        exp: expTime,
        bp: NARI.settings.brokerUrl,
        tp: NARI.settings.topicPrefix
      };

      // Store in Admin's active guest list so they can revoke anytime
      if (!this.data.activeGuests) this.data.activeGuests = [];
      this.data.activeGuests.push({
        id: guestId,
        name: name || "Guest",
        exp: expTime,
        swCount: allowedSwitchIds.length,
        createdAt: Date.now()
      });
      this.save();

      // Encode into URL hash for direct guest sharing (Zero Firebase Reads!)
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(passData))));
      const currentUrl = window.location.origin + window.location.pathname;
      const guestLink = `${currentUrl}#guest=${encoded}`;

      return { passData, guestLink, guestId, expTime };
    },

    revokeGuestPass(guestId) {
      this.data.activeGuests = (this.data.activeGuests || []).filter(g => g.id !== guestId);
      this.save();
      if (NARI.showToast) NARI.showToast("Guest access revoked 🚫", "ok");
      this.renderSidebar();
    },

    _checkGuestUrl() {
      const hash = window.location.hash || "";
      if (!hash.startsWith("#guest=")) return;

      try {
        const raw = decodeURIComponent(escape(atob(hash.replace("#guest=", ""))));
        const data = JSON.parse(raw);

        // Check expiration using phone clock
        if (Date.now() > data.exp) {
          this.isGuestMode = true;
          this._showExpiredGuestScreen();
          return;
        }

        // Active guest mode!
        this.isGuestMode = true;
        this.guestConfig = data;
        document.body.classList.add("guest-mode");

        // Override settings and broker if provided in pass
        if (data.bp && NARI.settings) NARI.settings.brokerUrl = data.bp;
        if (data.tp && NARI.settings) NARI.settings.topicPrefix = data.tp;

        // Auto-refresh countdown banner
        setTimeout(() => this._initGuestBanner(data), 300);
      } catch (e) {
        console.error("Invalid guest token:", e);
      }
    },

    _showExpiredGuestScreen() {
      document.body.innerHTML = `
        <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;background:#18181b;color:#f4f4f5;font-family:sans-serif;">
          <div style="width:72px;height:72px;border-radius:50%;background:rgba(239,68,68,0.2);color:#ef4444;display:grid;place-items:center;font-size:32px;margin-bottom:16px;">
            <i class="fa-solid fa-hourglass-end"></i>
          </div>
          <h2 style="font-size:24px;margin-bottom:8px;color:#fca5a5;">Guest Pass Expired</h2>
          <p style="color:#a1a1aa;max-width:340px;line-height:1.5;margin-bottom:24px;">
            Your temporary access to this smart home has ended.<br>Please ask the Home Admin for a new Guest Pass.
          </p>
          <a href="${window.location.origin + window.location.pathname}" style="background:#f59e0b;color:#000;padding:12px 24px;border-radius:12px;font-weight:700;text-decoration:none;">
            Go to Main App
          </a>
        </div>
      `;
    },

    _initGuestBanner(data) {
      const bannerContainer = document.getElementById("banners");
      if (!bannerContainer) return;

      const formatTimeLeft = () => {
        const ms = data.exp - Date.now();
        if (ms <= 0) {
          window.location.reload();
          return "Expired";
        }
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        return hours > 0 ? `${hours}h ${mins}m left` : `${mins}m left`;
      };

      bannerContainer.innerHTML = `
        <div class="guest-banner" style="background:linear-gradient(135deg, rgba(245,158,11,0.2), rgba(217,119,6,0.1));border:1px solid rgba(245,158,11,0.4);border-radius:14px;padding:12px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:36px;height:36px;border-radius:50%;background:#f59e0b;color:#000;display:grid;place-items:center;font-size:18px;">
              <i class="fa-solid fa-key"></i>
            </div>
            <div>
              <b style="display:block;font-size:13px;color:#fef3c7;">Guest Access: ${data.gname || 'Visitor'}</b>
              <span style="font-size:11px;color:#fcd34d;">Temporary Smart Switch Remote</span>
            </div>
          </div>
          <span style="background:rgba(0,0,0,0.4);color:#fcd34d;font-weight:700;padding:4px 8px;border-radius:8px;font-size:11px;border:1px solid rgba(245,158,11,0.3);">
            <i class="fa-regular fa-clock"></i> ${formatTimeLeft()}
          </span>
        </div>
      `;

      // Hide Admin actions for guest
      const toHide = ["btnAdd", "btnSettings", "btnShare", "authContainer"];
      toHide.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
      });

      // Filter displayed devices to only allowed switch IDs
      if (Array.isArray(data.sw) && store.devices) {
        store.devices = store.devices.filter(d => data.sw.includes(d.id || d.ip));
        if (NARI.app && NARI.app.renderDeviceCards) NARI.app.renderDeviceCards();
      }
    },

    // ---------- Left Sidebar UI & Events ----------
    _bindSidebarEvents() {
      const btnMenu = document.getElementById("btnMenu");
      const backdrop = document.getElementById("sidebarBackdrop");

      if (btnMenu) btnMenu.addEventListener("click", () => this.openSidebar());
      if (backdrop) backdrop.addEventListener("click", () => this.closeSidebar());

      // Also allow the top share button to open the Guest pass section directly
      const btnShare = document.getElementById("btnShare");
      if (btnShare) {
        btnShare.addEventListener("click", () => {
          this.openSidebar();
          setTimeout(() => {
            const el = document.getElementById("secGuestPass");
            if (el) el.scrollIntoView({ behavior: "smooth" });
          }, 300);
        });
      }
    },

    openSidebar() {
      const sidebar = document.getElementById("leftSidebar");
      const backdrop = document.getElementById("sidebarBackdrop");
      if (!sidebar || !backdrop) return;
      this.renderSidebar();
      sidebar.classList.add("open");
      backdrop.classList.add("open");
    },

    closeSidebar() {
      const sidebar = document.getElementById("leftSidebar");
      const backdrop = document.getElementById("sidebarBackdrop");
      if (sidebar) sidebar.classList.remove("open");
      if (backdrop) backdrop.classList.remove("open");
    },

    renderActivityLogHtml() {
      const logs = this.getLogs();
      if (!logs.length) {
        return `<div class="empty-log"><i class="fa-solid fa-clock-rotate-left"></i> No recent switch activity recorded</div>`;
      }
      return logs.map(l => `
        <div class="log-item">
          <div class="log-dot ${l.state === 'on' ? 'on' : 'off'}"></div>
          <div class="log-content">
            <span class="log-text">${l.text}</span>
            <span class="log-time">${l.time} &bull; ${l.date}</span>
          </div>
        </div>
      `).join("");
    },

    renderSidebar() {
      const sidebar = document.getElementById("leftSidebar");
      if (!sidebar) return;

      const role = this.getCurrentRole();
      const isAdmin = this.isSupervisor();
      const admins = this.data.admins || [];
      const members = this.data.members || [];
      const activeGuests = this.data.activeGuests || [];
      const devices = store.devices || [];

      sidebar.innerHTML = `
        <div class="sidebar-header">
          <div style="display:flex;align-items:center;gap:12px;">
            <div class="home-icon"><i class="fa-solid fa-house-chimney"></i></div>
            <div>
              <h3 style="margin:0;font-size:1.1rem;color:#f4f4f5;">${this.data.homeName || 'My Home'}</h3>
              <div class="role-badge ${isAdmin ? 'admin' : 'member'}">
                ${isAdmin ? '<i class="fa-solid fa-crown"></i> Home Admin (Supervisor)' : '<i class="fa-solid fa-user-group"></i> Family Member'}
              </div>
            </div>
          </div>
          <button class="btn-close-sidebar" onclick="NARI.sharing.closeSidebar()">✕</button>
        </div>

        <div class="sidebar-body">
          <!-- Non-Technical Role Summary Banner -->
          <div class="role-explainer">
            ${isAdmin
              ? '👑 <b>Full Power:</b> You can add switches, invite family, share guest keys, and delete switches.'
              : '👨‍👩‍👧 <b>Family Power:</b> You can operate all switches, rename them, and add new switches.'}
          </div>

          <!-- SECTION 1: GIVE GUEST PASS (No login needed) -->
          <div class="sidebar-card" id="secGuestPass">
            <div class="card-title">
              <i class="fa-solid fa-key" style="color:#f59e0b;"></i>
              <span>Give Guest Pass (Temporary)</span>
            </div>
            <p class="card-desc">For visitors, house help, or guests. <b>No password or login required!</b></p>

            <div class="form-group sm">
              <label>Guest Name / Reason</label>
              <input type="text" id="guestNameInput" placeholder="e.g. Electrician, Painter, Aunt" />
            </div>

            <div class="form-group sm">
              <label>How long can they control?</label>
              <div class="duration-pills" id="durationSelector">
                <button class="dur-pill active" data-hours="2" onclick="NARI.sharing._pickDuration(this)">2 Hours</button>
                <button class="dur-pill" data-hours="12" onclick="NARI.sharing._pickDuration(this)">12 Hours</button>
                <button class="dur-pill" data-hours="24" onclick="NARI.sharing._pickDuration(this)">1 Day</button>
                <button class="dur-pill" data-hours="72" onclick="NARI.sharing._pickDuration(this)">3 Days</button>
              </div>
            </div>

            <div class="form-group sm">
              <label>Select Switches They Can Use:</label>
              <div class="switch-selector-list">
                ${devices.length === 0 ? '<span class="small muted">No switches available</span>' : devices.map(d => `
                  <label class="switch-select-item">
                    <input type="checkbox" name="guestSwitch" value="${d.id || d.ip}" checked />
                    <span>${d.name || 'Switch'}</span>
                  </label>
                `).join("")}
              </div>
            </div>

            <button class="btn primary sm" style="width:100%;margin-top:8px;" onclick="NARI.sharing._handleGeneratePass()">
              <i class="fa-solid fa-qrcode"></i> Create Guest Pass &amp; QR Code
            </button>

            <!-- Active Guest Passes List -->
            ${activeGuests.length > 0 ? `
              <div style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.08);padding-top:10px;">
                <b style="font-size:12px;color:#fcd34d;display:block;margin-bottom:6px;">Active Guest Passes:</b>
                ${activeGuests.map(g => {
                  const timeLeft = Math.max(0, Math.round((g.exp - Date.now()) / (1000 * 60)));
                  return `
                    <div class="active-guest-row">
                      <div>
                        <b>${g.name}</b>
                        <span class="small muted">${timeLeft > 60 ? Math.round(timeLeft/60) + 'h left' : timeLeft + 'm left'} &bull; ${g.swCount} switches</span>
                      </div>
                      <button class="btn-revoke" onclick="NARI.sharing.revokeGuestPass('${g.id}')" title="Revoke now">Stop 🚫</button>
                    </div>
                  `;
                }).join("")}
              </div>
            ` : ''}
          </div>

          <!-- SECTION 2: FAMILY MEMBERS (Max 2 Supervisors) -->
          <div class="sidebar-card">
            <div class="card-title">
              <i class="fa-solid fa-people-roof" style="color:#10b981;"></i>
              <span>Family Members</span>
            </div>
            <p class="card-desc">Permanent family members who live in this home.</p>

            <div class="family-list">
              <!-- Admins (Supervisors) -->
              ${admins.map(a => `
                <div class="family-member-row admin">
                  <div class="member-info">
                    <div class="avatar admin"><i class="fa-solid fa-crown"></i></div>
                    <div>
                      <b>${a.name}</b>
                      <span class="role-tag">${a.role === 'primary' ? '👑 Primary Admin' : '👑 Co-Admin'}</span>
                    </div>
                  </div>
                  ${(isAdmin && a.role !== 'primary') ? `
                    <button class="btn-demote" onclick="NARI.sharing.demoteToMember('${a.email}')" title="Demote to Member">Demote</button>
                  ` : ''}
                </div>
              `).join("")}

              <!-- Standard Family Members -->
              ${members.map(m => `
                <div class="family-member-row">
                  <div class="member-info">
                    <div class="avatar"><i class="fa-solid fa-user"></i></div>
                    <div>
                      <b>${m.name}</b>
                      <span class="small muted">${m.email}</span>
                    </div>
                  </div>
                  <div style="display:flex;gap:4px;">
                    ${(isAdmin && admins.length < 2) ? `
                      <button class="btn-promote" onclick="NARI.sharing.promoteToCoAdmin('${m.email}')" title="Make Co-Admin">Make Admin 👑</button>
                    ` : ''}
                    ${isAdmin ? `
                      <button class="btn-remove" onclick="NARI.sharing.removeFamilyMember('${m.email}')" title="Remove Member">✕</button>
                    ` : ''}
                  </div>
                </div>
              `).join("")}
            </div>

            <!-- Add Family Member Form (Admins only) -->
            ${isAdmin ? `
              <div style="margin-top:12px;display:flex;gap:6px;">
                <input type="text" id="newFamName" placeholder="Name (e.g. Sister)" style="flex:1;font-size:12px;padding:8px;" />
                <input type="email" id="newFamEmail" placeholder="Email address" style="flex:1;font-size:12px;padding:8px;" />
                <button class="btn secondary sm" onclick="NARI.sharing._handleAddMemberClick()">Add</button>
              </div>
            ` : ''}
          </div>

          <!-- SECTION 3: PUBLIC SWITCHES (Common Area e.g. Gate, Garden) -->
          <div class="sidebar-card">
            <div class="card-title">
              <i class="fa-solid fa-globe" style="color:#38bdf8;"></i>
              <span>Public / Common Area Switches</span>
            </div>
            <p class="card-desc">Anyone in the family can edit, rename, and delete these switches (e.g., Gate Light, Veranda, Garden).</p>

            <div class="public-switch-list">
              ${devices.length === 0 ? '<span class="small muted">No switches added yet</span>' : devices.map(d => {
                const isPub = this.isPublicSwitch(d);
                return `
                  <div class="pub-switch-item">
                    <span>${d.name || 'Switch'}</span>
                    <button class="btn-pub-toggle ${isPub ? 'active' : ''}" onclick="NARI.sharing.togglePublicSwitch('${d.id || d.ip}')">
                      ${isPub ? '🌐 Public (Deletable by all)' : '🔒 Private (Admin only)'}
                    </button>
                  </div>
                `;
              }).join("")}
            </div>
          </div>

          <!-- SECTION 4: SWITCH ACTIVITY LOG (Inbuilt Phone Time - $0) -->
          <div class="sidebar-card">
            <div class="card-title between">
              <div style="display:flex;align-items:center;gap:8px;">
                <i class="fa-solid fa-clock-rotate-left" style="color:#a78bfa;"></i>
                <span>Switch Activity History</span>
              </div>
              <button class="btn-clear-log" onclick="NARI.sharing.clearLogs()">Clear</button>
            </div>
            <p class="card-desc">Shows when switches turned ON/OFF using your phone clock (100% Free, 0 Database calls).</p>
            <div class="activity-log-box" id="sidebarActivityList">
              ${this.renderActivityLogHtml()}
            </div>
          </div>

          <!-- SECTION 5: EMERGENCY SUCCESSION -->
          <div class="sidebar-card" style="border-color:rgba(239,68,68,0.25);">
            <div class="card-title">
              <i class="fa-solid fa-shield-halved" style="color:#ef4444;"></i>
              <span>Emergency Admin Backup</span>
            </div>
            <p class="card-desc">
              If the Home Admin phone is lost, account deleted, or offline permanently, any family member can claim Admin ownership here.
            </p>
            <button class="btn danger sm" style="width:100%;margin-top:6px;" onclick="NARI.sharing.claimEmergencyAdmin()">
              <i class="fa-solid fa-user-shield"></i> Claim Home Admin Role
            </button>
          </div>
        </div>
      `;
    },

    _pickDuration(btn) {
      document.querySelectorAll("#durationSelector .dur-pill").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
    },

    _handleAddMemberClick() {
      const nameInput = document.getElementById("newFamName");
      const emailInput = document.getElementById("newFamEmail");
      if (!nameInput || !emailInput) return;
      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      if (!name || !email) {
        alert("Please enter both family member name and email.");
        return;
      }
      this.addFamilyMember(name, email);
      nameInput.value = "";
      emailInput.value = "";
    },

    _handleGeneratePass() {
      const name = (document.getElementById("guestNameInput")?.value || "").trim() || "Visitor";
      const activePill = document.querySelector("#durationSelector .dur-pill.active");
      const hours = activePill ? parseInt(activePill.getAttribute("data-hours"), 10) : 2;

      const checkedSwitches = Array.from(document.querySelectorAll("input[name='guestSwitch']:checked")).map(cb => cb.value);
      if (checkedSwitches.length === 0) {
        alert("Please check at least one switch the guest can use!");
        return;
      }

      const res = this.createGuestPass(name, hours, checkedSwitches);
      if (!res) return;

      this.closeSidebar();

      // Open a large, beautiful QR code and WhatsApp share sheet for non-technical users
      if (NARI.openSheet) {
        NARI.openSheet(`
          <div class="sheet-header">
            <div>Temporary Guest Pass<span class="sub">${name} &bull; Valid for ${hours} hours</span></div>
            <button class="btn-close" onclick="NARI.app.closeSheet()">✕</button>
          </div>
          <div style="text-align:center;padding:12px 0;">
            <div id="guestQrBox" style="background:#fff;padding:14px;border-radius:14px;display:inline-block;box-shadow:0 8px 24px rgba(0,0,0,0.4);margin-bottom:14px;"></div>
            <p style="font-size:13px;color:#fcd34d;font-weight:600;margin-bottom:6px;">
              Ask your guest to scan this QR code with their phone camera!
            </p>
            <p class="small muted" style="margin-bottom:16px;">
              No app install or login needed. Switch controls open instantly on their phone.
            </p>
            <div style="display:flex;gap:10px;">
              <button class="btn primary" style="flex:1;background:#25D366;border-color:#25D366;color:#fff;" onclick="window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent('Here is your temporary smart switch key for ' + '${name}' + ': ' + '${res.guestLink}'), '_blank')">
                <i class="fa-brands fa-whatsapp"></i> Share on WhatsApp
              </button>
              <button class="btn secondary" style="flex:1;" onclick="navigator.clipboard.writeText('${res.guestLink}'); NARI.showToast('Link copied to clipboard!', 'ok');">
                <i class="fa-solid fa-copy"></i> Copy Link
              </button>
            </div>
          </div>
        `);

        setTimeout(() => {
          const qrBox = document.getElementById("guestQrBox");
          if (qrBox && typeof QRCode !== "undefined") {
            new QRCode(qrBox, {
              text: res.guestLink,
              width: 180,
              height: 180,
              colorDark: "#000000",
              colorLight: "#ffffff",
              correctLevel: QRCode.CorrectLevel.M
            });
          }
        }, 150);
      }
    }
  };

  NARI.sharing = sharing;

  // Initialize sharing when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => sharing.init());
  } else {
    sharing.init();
  }
})(window);
