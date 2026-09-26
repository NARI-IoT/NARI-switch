/* NARI Smart Switch - defaults & runtime settings.
 * Everything here can be overridden from the in-app Settings modal
 * (stored in localStorage under "nari_settings").
 *
 * Deployment defaults (broker host, MQTT password, LAN token) belong in js/config.local.js
 * (git-ignored, see js/config.local.example.js) as `window.NARI_LOCAL_CONFIG = {...}` so the
 * public repository never contains your secrets. */
(function (global) {
  "use strict";
 
  const IS_SECURE_PAGE = location.protocol === "https:";
 
  const DEFAULT_SETTINGS = Object.assign({
    // Oracle Cloud Mosquitto broker (browser side MUST be wss:// when the page is https://)
    brokerUrl: IS_SECURE_PAGE ? "wss://YOUR-BROKER-HOST:9001" : "ws://YOUR-BROKER-HOST:9001",
    mqttUser: "nari_admin",
    mqttPass: "",
    topicPrefix: "nari",
    // Shared secret expected by the ESP-01S firmware on /ping, /toggle, ... (API_AUTH_KEY in the sketch)
    lanToken: "",
    // LAN behaviour
    lanEnabled: true,
    lanTimeoutMs: 400,
    lanScanSubnets: "192.168.1,192.168.0,192.168.29,192.168.43,192.168.4",
    // UX
    theme: "default",
    speakFeedback: false,
    hapticFeedback: true,
    voiceLang: "en-IN",
    // Home location (for geofence + sunrise/sunset)
    homeLat: null,
    homeLon: null,
    homeRadiusM: 150,
    // Default firmware .bin URL used by the one-click "Update firmware" button (http:// - the ESP cannot do TLS reliably)
    otaUrl: ""
  }, global.NARI_LOCAL_CONFIG || {});
 
  // Firebase web config is public by design (security is enforced by Firestore rules), so it may live here.
  const FIREBASE_CONFIG = Object.assign({
    apiKey: "AIzaSyDdWakuiPRF2ucBnEtJ2s77e0Gf7MK2djs",
    authDomain: "nari-smart-home.firebaseapp.com",
    projectId: "nari-smart-home",
    storageBucket: "nari-smart-home.firebasestorage.app",
    messagingSenderId: "285100807860",
    appId: "1:285100807860:web:31a5c284f9c457111c29e1"
  }, (global.NARI_LOCAL_CONFIG && global.NARI_LOCAL_CONFIG.firebase) || {});
 
  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("nari_settings") || "{}"); } catch (e) { saved = {}; }
    // Legacy theme key
    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
    // Ensure deployment defaults from config.local.js are not shadowed by empty saved strings
    if (!merged.lanToken && DEFAULT_SETTINGS.lanToken) merged.lanToken = DEFAULT_SETTINGS.lanToken;
    if (!merged.brokerUrl || /YOUR-BROKER-HOST/.test(merged.brokerUrl)) merged.brokerUrl = DEFAULT_SETTINGS.brokerUrl;
    return merged;
  }
 
  function saveSettings(s) {
    localStorage.setItem("nari_settings", JSON.stringify(s));
  }
 
  global.NARI = global.NARI || {};
  global.NARI.IS_SECURE_PAGE = IS_SECURE_PAGE;
  global.NARI.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  global.NARI.FIREBASE_CONFIG = FIREBASE_CONFIG;
  global.NARI.settings = loadSettings();
  global.NARI.saveSettings = function () { saveSettings(global.NARI.settings); };
  global.NARI.resetSettings = function () {
    global.NARI.settings = Object.assign({}, DEFAULT_SETTINGS);
    saveSettings(global.NARI.settings);
  };
  global.NARI.isConfigured = function () {
    const s = global.NARI.settings;
    return !!s.brokerUrl && !/YOUR-BROKER-HOST/.test(s.brokerUrl);
  };
})(window);
