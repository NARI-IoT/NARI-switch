// Automated Test Suite for Dual-Switch Audit & Completeness
const vm = require("vm");
const fs = require("fs");
const path = require("path");

const calls = [];
const ls = {};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Math, JSON, Object, Array, String, Number, Promise,
  localStorage: { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; } },
  navigator: { vibrate: () => true },
  document: { addEventListener() {}, removeEventListener() {} },
  addEventListener() {}, removeEventListener() {}
};
sandbox.window = sandbox;
sandbox.NARI = {
  settings: { hapticFeedback: false },
  saveSettings() {},
  showToast: () => {},
  openSheet: () => {}
};

vm.createContext(sandbox);
const load = (f) => vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), sandbox, { filename: f });

load("js/store.js");
const { store } = sandbox.NARI;
const newDevice = sandbox.NARI.newDevice;
const migrateDevice = sandbox.NARI.migrateDevice;

console.log("=== DUAL-SWITCH AUDIT TESTS ===");

// 1. Check newDevice default properties for dual switches
const d = newDevice("Test Switch", "192.168.1.50", "test-dual");
if (d.autoOffSec === 0 && d.autoOffSec2 === 0 && d.bootState === "LAST" && d.bootState2 === "LAST") {
  console.log("  PASS: store.newDevice has separate autoOffSec2 and bootState2");
} else {
  console.error("  FAIL: store.newDevice missing separate dual properties", d);
  process.exit(1);
}

// 2. Check migrateDevice fills missing dual properties on legacy device objects
const legacyDev = {
  id: "legacy",
  name: "Legacy Switch",
  dual: true,
  autoOffSec: 10,
  bootState: "OFF"
};
const migrated = migrateDevice(legacyDev);
if (migrated.autoOffSec === 10 && migrated.autoOffSec2 === 0 && migrated.bootState === "OFF" && migrated.bootState2 === "LAST") {
  console.log("  PASS: store.migrateDevice upgrades legacy devices with dual-switch settings");
} else {
  console.error("  FAIL: store.migrateDevice did not upgrade dual settings", migrated);
  process.exit(1);
}

// 3. Test Scene Execution relay isolation
let executedRelays = [];
sandbox.NARI.transport = {
  setState: (idx, state, opts) => {
    executedRelays.push({ idx, state, relay: opts.relay });
    return Promise.resolve();
  }
};

load("js/scenes.js");
const { scenes } = sandbox.NARI;

store.devices = [
  {
    id: "sw1",
    name: "Switch 1",
    dual: true,
    state: false,
    state2: false
  }
];

// Action targeting Relay 2 ONLY
scenes.list = [
  {
    id: "test_scene_relay2",
    name: "Fan Only Scene",
    actions: [
      {
        deviceId: "sw1",
        deviceName: "Switch 1",
        relay: 2,
        state: true
      }
    ]
  }
];

executedRelays = [];
scenes.executeScene("test_scene_relay2");

if (executedRelays.length === 1 && executedRelays[0].relay === 2 && executedRelays[0].state === true) {
  console.log("  PASS: Scene execution targets Relay 2 in isolation without switching Relay 1");
} else {
  console.error("  FAIL: Scene execution Relay 2 isolation failed", executedRelays);
  process.exit(1);
}

// Action targeting Relay 1 ONLY
scenes.list = [
  {
    id: "test_scene_relay1",
    name: "Light Only Scene",
    actions: [
      {
        deviceId: "sw1",
        deviceName: "Switch 1",
        relay: 1,
        state: true
      }
    ]
  }
];

executedRelays = [];
scenes.executeScene("test_scene_relay1");

if (executedRelays.length === 1 && executedRelays[0].relay === 1 && executedRelays[0].state === true) {
  console.log("  PASS: Scene execution targets Relay 1 in isolation without switching Relay 2");
} else {
  console.error("  FAIL: Scene execution Relay 1 isolation failed", executedRelays);
  process.exit(1);
}

// Action targeting Both Relays
scenes.list = [
  {
    id: "test_scene_both",
    name: "All On Scene",
    actions: [
      {
        deviceId: "sw1",
        deviceName: "Switch 1",
        relay: "both",
        state: true
      }
    ]
  }
];

executedRelays = [];
scenes.executeScene("test_scene_both");

if (executedRelays.length === 2 && executedRelays.some(r => r.relay === 1) && executedRelays.some(r => r.relay === 2)) {
  console.log("  PASS: Scene execution targets Both Relays simultaneously when requested");
} else {
  console.error("  FAIL: Scene execution Both Relays failed", executedRelays);
  process.exit(1);
}

console.log("\n==== ALL DUAL SWITCH AUDIT TESTS PASSED ====\n");
