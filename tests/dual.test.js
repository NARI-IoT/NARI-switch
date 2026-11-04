/* Dual-relay + Telugu + IR-learn behaviour tests. Run: node tests/dual.test.js
 * (modes.test.js pins its fixtures to single-relay; this file covers the dual-channel paths.) */
const vm = require("vm"), fs = require("fs"), path = require("path");
const ls = {}; const calls = [];
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, performance, Float32Array, Uint8Array, Math, JSON, Object, Array, String, Number, Promise, Map, Set, Infinity, NaN, Date,
  crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; } },
  localStorage: { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); } },
  navigator: { vibrate: () => true }, document: { addEventListener() { }, removeEventListener() { }, hidden: false, getElementById: () => null },
  location: { hash: "", search: "", origin: "http://localhost", pathname: "/" },
  addEventListener() { }, removeEventListener() { }
};
sandbox.window = sandbox;
sandbox.NARI = { settings: { hapticFeedback: false, homeLat: 17.385, homeLon: 78.4867, homeRadiusM: 150, voiceLang: "te-IN" }, saveSettings() { }, FIREBASE_CONFIG: {} };
vm.createContext(sandbox);
const load = (f) => vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), sandbox, { filename: f });
load("js/store.js");
const NARI = sandbox.NARI;
load("js/transport.js");
const parseState = NARI.parseState;
const realTransport = NARI.transport;
NARI.transport = {
  lanBlocked: false, lanFresh: () => true,
  async setState(i, st, opts) {
    const d = NARI.store.devices[i]; const relay = (opts && opts.relay) || 1;
    calls.push({ i, state: st, relay });
    if (relay === 2) d.state2 = st; else d.state = st; return "lan";
  }
};
load("js/audio.js"); load("js/sensors.js"); load("js/sharing.js");
const { store, sensors, sharing } = NARI;

let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? "  PASS " : "  FAIL ") + n + (d ? "  [" + d + "]" : "")); };
const fresh = (dual, target, st1, st2) => {
  store.devices.length = 0;
  const d = store.add({ name: "D", ip: "1.2.3.4", id: "SW_Dual", dual, state: !!st1, state2: !!st2 });
  Object.assign(d.triggers.shake, { enabled: true, targetRelay: target });
  calls.length = 0; sensors.lastFire = {}; return d;
};
const relays = () => calls.map(c => c.relay + ":" + (c.state ? "on" : "off")).sort().join(",");

(async () => {
  console.log("\n=== DUAL RELAY targeting ===");
  fresh(true, "both", false, false); await sensors.fire(0, "shake", "on");
  check("both + ON drives relay 1 and relay 2 ON", relays() === "1:on,2:on", relays());
  fresh(true, "relay1", false, false); await sensors.fire(0, "shake", "on");
  check("relay1 only ON touches only relay 1", relays() === "1:on", relays());
  fresh(true, "relay2", false, false); await sensors.fire(0, "shake", "on");
  check("relay2 only ON touches only relay 2", relays() === "2:on", relays());
  fresh(true, "both", true, false); await sensors.fire(0, "shake", "toggle");
  check("both + toggle with mixed state turns BOTH off (no split state)", relays() === "1:off,2:off", relays());
  fresh(true, "both", false, false); await sensors.fire(0, "shake", "toggle");
  check("both + toggle from all-off turns BOTH on", relays() === "1:on,2:on", relays());
  fresh(true, "relay2", false, true); await sensors.fire(0, "shake", "toggle");
  check("relay2 toggle flips relay 2 from ITS own state", relays() === "2:off", relays());
  fresh(false, "both", false, false); await sensors.fire(0, "shake", "on");
  check("single-relay device ignores 'both' and only drives relay 1", relays() === "1:on", relays());

  console.log("\n=== LOWERCASE ID standard ===");
  const d = fresh(true, "both");
  check("identifierOf lowercases 'SW_Dual'", store.identifierOf(d) === "sw_dual");
  check("findIndex matches regardless of case", store.findIndex("sw_DUAL") === 0 && store.exists("SW_DUAL"));

  console.log("\n=== TELUGU voice (merged for already-saved devices) ===");
  const heardAction = async (txt) => {
    const dv = fresh(true, "both", false, false); dv.triggers.shake.enabled = false;
    dv.triggers.voice.enabled = true; dv.triggers.voice.on = "light on"; dv.triggers.voice.off = "light off"; dv.triggers.voice.toggle = "";
    sensors.lastFire = {}; sensors._onSpeech([txt]); await new Promise(r => setTimeout(r, 5));
    return calls.length ? (calls[0].state ? "on" : "off") : "none";
  };
  for (const [t, want] of [["లైట్ వెయ్యి", "on"], ["లైట్ ఆపు", "off"], ["light vey", "on"], ["light aapu", "off"], ["light on", "on"], ["hello how are you", "none"], ["నమస్కారం", "none"]])
    check(`"${t}" -> ${want}`, (await heardAction(t)) === want, await heardAction(t));

  console.log("\n=== NEW DEVICE defaults ===");
  const nd = store.add({ name: "N", ip: "9.9.9.9", id: "n1" });
  check("new device has empty irKeys array", Array.isArray(nd.irKeys) && nd.irKeys.length === 0);
  check("every trigger except effect defaults to targetRelay both", Object.keys(nd.triggers).filter(k => k !== "effect").every(k => nd.triggers[k].targetRelay === "both"));

  console.log("\n=== PARSE STATE (Relay 1, Relay 2, JSON, Booleans) ===");
  check("r1:1 sets relay1 and state", parseState("r1:1").relay1 === true && parseState("r1:1").state === true);
  check("r1:0 sets relay1 false and state false", parseState("r1:0").relay1 === false && parseState("r1:0").state === false);
  check("r2:1 sets relay2 true", parseState("r2:1").relay2 === true && parseState("r2:1").state === null);
  check("r2:off sets relay2 false", parseState("r2:off").relay2 === false);
  check("json payload parsed", parseState('{"relay1":1,"relay2":0}').relay1 === true && parseState('{"relay1":1,"relay2":0}').relay2 === false);

  console.log("\n=== ANTI-FLICKER (optimistic toggle vs stale/duplicate echoes) ===");
  {
    const t = realTransport;
    const msg = (id, kind, payload) => t._onMessage(`device/${id}/${kind}`, payload);
    const fl = store.add({ name: "F", ip: "", id: "flk1", dual: true, state: false, state2: false });
    fl.isOnline = true;
    const seen = [];
    // user taps relay1 ON: optimistic update + expectation (what setState does before I/O)
    t._expect(fl, 1, true, Date.now()); fl.state = true; seen.push(fl.state);
    msg("flk1", "state", '{"relay1":0,"relay2":0}'); seen.push(fl.state);   // stale retained echo
    msg("flk1", "state", "r1:0"); seen.push(fl.state);                        // stale legacy-topic echo
    check("stale OFF echoes do NOT revert an in-flight ON toggle", seen.every(v => v === true), seen.join(","));
    msg("flk1", "state", '{"relay1":1,"relay2":0}'); seen.push(fl.state);    // real confirmation
    check("device confirmation keeps ON", fl.state === true && !t.isPending(fl, 1));
    msg("flk1", "state", '{"relay1":1,"relay2":0}'); seen.push(fl.state);    // duplicate topic echo
    check("duplicate echo after confirmation causes no bounce", seen.every(v => v === true), seen.join(","));
    // relay2 is independent: relay1 expectation must not block relay2 reports
    msg("flk1", "state", '{"relay1":1,"relay2":1}');
    check("unrelated relay2 report still applies", fl.state2 === true);
    // expectation expires -> genuine external change is accepted again
    t._expect(fl, 1, false, Date.now() - 9000); fl.state = false;
    msg("flk1", "state", '{"relay1":1,"relay2":1}');
    check("after the 8s window a real external change is applied", fl.state === true);
    check("isPending false for expired expectation", !t.isPending(fl, 1));
  }

  console.log("\n=== SMART CARD SETUP & FAMILY SUPERVISION ROLES ===");
  {
    const card = store.add({
      id: "bed_node",
      name: "Master Bedroom Switch",
      room: "Master Bedroom",
      ip: "192.168.1.150",
      dual: true,
      relay1Name: "Ceiling Light",
      relay2Name: "Ceiling Fan",
      relay1Icon: "bulb",
      relay2Icon: "fan",
      assignedTo: "dad@narismarthome.local",
      accessRole: "public"
    });
    check("smart card created with custom name", card.name === "Master Bedroom Switch");
    check("smart card allocated to selected room", card.room === "Master Bedroom");
    check("dual relays configured with custom labels", card.relay1Name === "Ceiling Light" && card.relay2Name === "Ceiling Fan");
    check("family member assigned to smart card", card.assignedTo === "dad@narismarthome.local");

    // Supervision roles: Public vs Private
    sharing.setSwitchPublic("bed_node", true);
    check("public role marks switch as public", sharing.isPublicSwitch(card) === true);

    sharing.setSwitchPublic("bed_node", false);
    check("private role marks switch as private (admin only)", sharing.isPublicSwitch(card) === false);
  }

  console.log(`\n==== SUMMARY: ${pass}/${pass + fail} passed ====`);
  process.exit(fail ? 1 : 0);
})();
