/* NARI Smart Home - first-run Terms & Conditions gate, plus the "About app" and "Terms" viewers.
 *
 * This is the FIRST script on the page. The real app scripts (config, store, transport, ... sharing)
 * are NOT loaded until the user has accepted the current Terms, so nothing starts (no cloud
 * connection, no sensors, no switch control) before consent.
 */
(function (g) {
  "use strict";

  var L = g.NARI_LEGAL_CONTENT;
  var KEY = "nari_terms_accepted";
  var APP_SCRIPTS = [
    { src: "js/config.local.js", optional: true },
    { src: "js/config.js?v=2.4.0" },
    { src: "js/store.js?v=2.4.0" },
    { src: "js/transport.js?v=2.4.0" },
    { src: "js/audio.js?v=2.4.0" },
    { src: "js/sensors.js?v=2.4.0" },
    { src: "js/scenes.js?v=2.4.0" },
    { src: "js/app.js?v=2.4.0" },
    { src: "js/sharing.js?v=2.4.0" }
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function readAccepted() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY));
      return v && v.version === L.termsVersion ? v : null;
    } catch (e) { return null; }
  }

  function saveAccepted() {
    var rec = { version: L.termsVersion, at: Date.now() };
    try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) { /* private mode: allow this session only */ }
    return rec;
  }

  // ---------- Make in India Badge & Attribution ----------
  function makeInIndiaBadgeHtml() {
    return '<div class="lg-mii-banner">' +
      '<div class="lg-mii-icon"><img src="icons/make-in-india-lion.svg" alt="Make in India" class="lg-mii-img" /></div>' +
      '<div class="lg-mii-details">' +
        '<div class="lg-mii-heading"><span>MAKE IN INDIA</span><div class="lg-mii-flag"><i></i><i></i><i></i></div></div>' +
        '<div class="lg-mii-sub">Developed by NARI IoT Solutions Company</div>' +
        '<div class="lg-mii-meta">Hardware PCB • Embedded Firmware • Native Mobile &amp; Web Platform</div>' +
      '</div>' +
    '</div>';
  }

  // ---------- HTML renderers (shared by the gate and by Settings) ----------
  function sectionsHtml(sections) {
    return sections.map(function (s) {
      var h = '<h4 class="lg-h">' + esc(s.title) + "</h4>";
      (s.paras || []).forEach(function (p) { h += '<p class="lg-p">' + esc(p) + "</p>"; });
      if (s.bullets && s.bullets.length) {
        h += '<ul class="lg-ul">' + s.bullets.map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ul>";
      }
      return h;
    }).join("");
  }

  function termsHtml() {
    var t = L.terms;
    return makeInIndiaBadgeHtml() +
      t.intro.map(function (p) { return '<p class="lg-p">' + esc(p) + "</p>"; }).join("") +
      sectionsHtml(t.sections) +
      '<p class="lg-p lg-muted">Version ' + esc(L.termsVersion) + " - updated " + esc(L.termsUpdated) + ". " + esc(t.footer) + "</p>";
  }

  function aboutHtml() {
    var a = L.about;
    return makeInIndiaBadgeHtml() +
      '<p class="lg-p lg-lead">' + esc(a.tagline) + "</p>" + sectionsHtml(a.sections) +
      '<p class="lg-p lg-muted">' + esc(a.footer) + " - Web App v2.4.0 - " + esc(L.website.replace("https://", "")) + "</p>";
  }

  // ---------- styles (self-contained so the gate looks right before app.css matters) ----------
  function injectStyles() {
    if (document.getElementById("nariLegalCss")) return;
    var st = document.createElement("style");
    st.id = "nariLegalCss";
    st.textContent =
      "body.nari-terms-pending>*:not(#nariTermsGate):not(script):not(style):not(noscript){display:none!important}" +
      "body.nari-terms-pending{overflow:hidden}" +
      "#nariTermsGate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:14px;background:radial-gradient(circle at 50% 0%,#14203a 0%,#060B14 70%);font-family:Outfit,system-ui,sans-serif;color:#E2E8F0}" +
      ".lg-card{width:100%;max-width:640px;max-height:100%;display:flex;flex-direction:column;background:rgba(15,23,42,.92);border:1.5px solid rgba(56,189,248,.28);border-radius:22px;box-shadow:0 20px 60px rgba(0,0,0,.55);overflow:hidden}" +
      ".lg-top{padding:20px 22px 10px}" +
      ".lg-top h2{margin:0;font-size:1.35rem;font-weight:800;color:#F8FAFC}" +
      ".lg-top .lg-sub{margin:4px 0 0;font-size:.85rem;color:#94A3B8}" +
      ".lg-body{flex:1;overflow-y:auto;padding:4px 22px 14px;-webkit-overflow-scrolling:touch;min-height:120px}" +
      ".lg-mii-banner{display:flex;align-items:center;gap:14px;background:radial-gradient(ellipse at top left,rgba(56,189,248,.14),rgba(15,23,42,.85));border:1.5px solid rgba(56,189,248,.32);border-radius:16px;padding:12px 14px;margin:8px 0 16px;box-shadow:0 8px 24px rgba(0,0,0,.35)}" +
      ".lg-mii-icon{flex:none;width:58px;height:36px;display:flex;align-items:center;justify-content:center}" +
      ".lg-mii-img{width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))}" +
      ".lg-mii-details{flex:1;min-width:0}" +
      ".lg-mii-heading{display:flex;align-items:center;gap:8px;font-weight:900;letter-spacing:1.5px;font-size:.9rem;color:#F8FAFC}" +
      ".lg-mii-flag{display:inline-flex;width:34px;height:4px;border-radius:2px;overflow:hidden}" +
      ".lg-mii-flag i:nth-child(1){flex:1;background:#FF9933}" +
      ".lg-mii-flag i:nth-child(2){flex:1;background:#FFFFFF}" +
      ".lg-mii-flag i:nth-child(3){flex:1;background:#138808}" +
      ".lg-mii-sub{font-size:.82rem;color:#38BDF8;font-weight:700;margin-top:2px}" +
      ".lg-mii-meta{font-size:.72rem;color:#94A3B8;margin-top:2px}" +
      ".lg-h{margin:18px 0 6px;font-size:1rem;font-weight:700;color:#38BDF8}" +
      ".lg-p{margin:6px 0;font-size:.92rem;line-height:1.55;color:#CBD5E1}" +
      ".lg-lead{font-size:1rem;color:#F1F5F9;font-weight:600}" +
      ".lg-muted{color:#94A3B8;font-size:.8rem}" +
      ".lg-ul{margin:6px 0 6px 18px;padding:0;font-size:.92rem;line-height:1.55;color:#CBD5E1}" +
      ".lg-ul li{margin:4px 0}" +
      ".lg-foot{padding:14px 22px 18px;border-top:1px solid rgba(148,163,184,.18);background:rgba(6,11,20,.55)}" +
      ".lg-check{display:flex;gap:10px;align-items:flex-start;font-size:.9rem;line-height:1.4;color:#E2E8F0;cursor:pointer;user-select:none}" +
      ".lg-check input{width:20px;height:20px;margin-top:1px;flex:none;accent-color:#7C4DFF}" +
      ".lg-actions{display:flex;gap:10px;margin-top:14px}" +
      ".lg-btn{flex:1;border:0;border-radius:14px;padding:13px 14px;font:700 .95rem Outfit,system-ui,sans-serif;cursor:pointer}" +
      ".lg-btn.ok{background:linear-gradient(135deg,#7C4DFF,#38BDF8);color:#fff}" +
      ".lg-btn.ok:disabled{opacity:.4;cursor:not-allowed}" +
      ".lg-btn.no{background:rgba(148,163,184,.14);color:#CBD5E1;flex:.6}" +
      ".lg-note{margin-top:12px;font-size:.85rem;color:#FCA5A5;display:none}" +
      ".lg-link{color:#38BDF8}" +
      "body.theme-light .sheet .lg-p,body.theme-light .sheet .lg-ul{color:#334155}" +
      "body.theme-light .sheet .lg-lead{color:#0f172a}" +
      "body.theme-light .sheet .lg-h,body.theme-light .sheet .lg-link{color:#047857}" +
      "body.theme-light .sheet .lg-muted{color:#64748b}" +
      "body.theme-light .sheet .lg-mii-banner{background:rgba(241,245,249,.95);border-color:#CBD5E1}" +
      "body.theme-light .sheet .lg-mii-heading{color:#0F172A}" +
      "body.theme-light .sheet .lg-mii-sub{color:#0284C7}" +
      "body.theme-light .sheet .lg-mii-meta{color:#64748B}";
    document.head.appendChild(st);
  }

  // ---------- loading the real app (only after consent) ----------
  var booted = false;
  function bootApp() {
    if (booted) return;
    booted = true;
    var i = 0;
    (function next() {
      if (i >= APP_SCRIPTS.length) return;
      var def = APP_SCRIPTS[i++];
      var s = document.createElement("script");
      s.src = def.src;
      s.async = false;
      s.onload = next;
      s.onerror = function () {
        if (!def.optional) console.error("[NARI] failed to load " + def.src);
        next();
      };
      document.body.appendChild(s);
    })();
  }

  // ---------- the gate ----------
  function showGate() {
    injectStyles();
    document.body.classList.add("nari-terms-pending");
    var gate = document.createElement("div");
    gate.id = "nariTermsGate";
    gate.setAttribute("role", "dialog");
    gate.setAttribute("aria-modal", "true");
    gate.setAttribute("aria-label", "Terms and Conditions");
    gate.innerHTML =
      '<div class="lg-card">' +
        '<div class="lg-top"><h2>Welcome to NARI Smart Home</h2>' +
        '<p class="lg-sub">Please read and accept the Terms &amp; Conditions to continue.</p></div>' +
        '<div class="lg-body" id="lgBody">' + termsHtml() +
          '<p class="lg-p">Privacy Policy: <a class="lg-link" target="_blank" rel="noopener" href="' + esc(L.privacyUrl) + '">' + esc(L.privacyUrl.replace("https://", "")) + "</a></p>" +
        "</div>" +
        '<div class="lg-foot">' +
          '<label class="lg-check"><input type="checkbox" id="lgAgree"> <span>I have read and I accept the Terms &amp; Conditions and the Privacy Policy.</span></label>' +
          '<div class="lg-actions">' +
            '<button class="lg-btn no" id="lgDecline" type="button">Decline</button>' +
            '<button class="lg-btn ok" id="lgOk" type="button" disabled>OK - Agree &amp; Continue</button>' +
          "</div>" +
          '<div class="lg-note" id="lgNote">You need to accept the Terms &amp; Conditions to use NARI Smart Home. You can close this page, or tick the box and press OK to continue.</div>' +
        "</div>" +
      "</div>";
    document.body.appendChild(gate);

    var agree = document.getElementById("lgAgree");
    var ok = document.getElementById("lgOk");
    agree.addEventListener("change", function () { ok.disabled = !agree.checked; });
    document.getElementById("lgDecline").addEventListener("click", function () {
      document.getElementById("lgNote").style.display = "block";
      try { g.close(); } catch (e) { /* browsers usually block this; the message above stays visible */ }
    });
    ok.addEventListener("click", function () {
      if (!agree.checked) return;
      saveAccepted();
      gate.remove();
      document.body.classList.remove("nari-terms-pending");
      bootApp();
    });
  }

  // ---------- public API used by Settings ----------
  g.NARI_LEGAL_UI = {
    isAccepted: function () { return !!readAccepted(); },
    acceptedAt: function () { var r = readAccepted(); return r ? r.at : null; },
    aboutHtml: aboutHtml,
    termsHtml: termsHtml,
    makeInIndiaBadgeHtml: makeInIndiaBadgeHtml,
    privacyUrl: L.privacyUrl,
    version: L.termsVersion,
    styles: injectStyles
  };

  function start() {
    if (readAccepted()) bootApp(); else showGate();
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})(window);
