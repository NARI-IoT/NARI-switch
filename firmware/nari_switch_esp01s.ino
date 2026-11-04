/*
 * NARI Smart Switch — Commercial Production Firmware
 * Target: ESP8266 / ESP-01S (1MB Flash)
 *
 * Features & Reliability Upgrades (v1.2.3):
 * 1. Automatic Captive Portal (RFC 302 redirect for Android / iOS auto-popup
 * onboarding)
 * 2. Universal Wall Switch Engine on GPIO3:
 *    - Works with BOTH Capacitive Touch / Momentary Push-Buttons AND Standard
 *      Indian Latching Rocker Switches (Anchor Roma, Havells, Legrand)
 *    - Always works locally (0ms latency) even during Wi-Fi outages or AP mode
 *    - Safe Factory Reset: 5 rapid flips/taps within 4s (or >5s hold after a
 *      verified touch pulse) prevents accidental resets on latching switches
 * 3. Power-Cut Router Race Immunity:
 *    - Never locks into permanent AP mode when home routers take 60-90s to boot
 *      after a power cut; automatically retries home Wi-Fi in the background
 *      and shuts down fallback AP the moment the router comes back online
 * 4. On-Device Hardware Countdown Timer (/timer & MQTT nari/<id>/timer):
 *    - Guarantees high-load appliances (geysers, motors) turn OFF on schedule
 *      even if the user's phone screen locks or Wi-Fi disconnects
 * 5. In-Built LED Status Engine on GPIO2:
 *    - Pairing mode: Blink rapidly (100ms)
 *    - Reconnecting to router: Blink slowly (500ms)
 *    - Relay ON: LED ON | Relay OFF: LED OFF
 *    - Toggle state change: Blink once
 *    - Resetting Wi-Fi credentials: Blink 3 times
 * 6. Non-Blocking MQTT (400ms socket timeout) & Rollover-Safe Deferred Flash
 *    Commit (2s settle window prevents CPU freeze & SPI flash wear)
 * 7. Dual-Mode Transport: Zero-latency Local HTTP LAN + Cloud MQTT (Port 1883)
 * 8. 2-Partition Flash OTA updates with live MQTT percentage reporting
 */

#include <ArduinoOTA.h>
#include <DNSServer.h>
#include <EEPROM.h>
#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>
#include <ESP8266httpUpdate.h>
#include <PubSubClient.h>

// Bump this on every release. Must match "version" in firmware/version.json.
#define FW_VERSION "1.2.4"

// ---------- Hardware Pins (ESP-01S Relay Module v4.0) ----------
#define RELAY_PIN 0 // GPIO0 controls the relay on ESP-01S relay shield
#define LED_PIN 2   // GPIO2 onboard blue LED (active LOW on ESP-01S)
#define TOUCH_PIN 3 // GPIO3 (RX pin) wall switch / capacitive touch input

// ---------- Default Fallbacks ----------
const char *DEFAULT_MQTT_BROKER = "129.225.82.9";
const int DEFAULT_MQTT_PORT = 1883;
const char *DEFAULT_MQTT_USER = "nari_admin";
const char *DEFAULT_MQTT_PASS = "narimqtt123";
const char *DEFAULT_AUTH_KEY = "NARI_SEC_98a7df8a7sdf6a5sd4f";
const char *DEFAULT_WEBAPP_URL = "https://nari-iot.github.io/NARI-switch/";

// ---------- EEPROM Layout (512 Bytes) ----------
#define EEPROM_MAGIC 0x4E415249 // 'NARI'
struct Config {
  uint32_t magic;
  char ssid[33];
  char pass[65];
  char devId[25]; // 16-char GUID e.g. sw_9f8a7b6c1d2e3f4a
  char devName[33];
  char authKey[33];
  char bootState[8]; // "LAST", "ON", "OFF"
  bool lastState;
  uint16_t autoOffSec; // Hardware Inching: auto-turn OFF after N sec on ANY turn-on (0 = disabled)
  bool wallSwitchLock; // Child Lock: disables physical wall switch toggling when true
} config;

// ---------- Global Instances ----------
ESP8266WebServer server(80);
DNSServer dnsServer;
WiFiClient espClient;
PubSubClient mqttClient(espClient);

bool isConfigMode = false;     // true when unconfigured (no saved SSID)
bool fallbackApActive = false; // true when AP is temporarily up after 90s outage
unsigned long wifiDisconnectedSince = 0;
unsigned long lastStaRetry = 0;
bool relayState = false;
unsigned long lastMqttRetry = 0;

// Hardware Countdown Timer Engine (executes on-device even if phone/Wi-Fi dies)
bool hwTimerActive = false;
unsigned long hwTimerEndsAt = 0;
bool hwTimerTargetState = false;

// LED Status Indicator Engine (GPIO2)
bool ledBlinkState = false;
unsigned long lastLedBlink = 0;
unsigned long blinkOnceUntil = 0;

// Universal Wall Switch Engine (GPIO3: Touch/Push-Button + Latching Rocker)
int touchIdleLevel = HIGH;
int lastRawTouch = HIGH;
int debouncedTouch = HIGH;
unsigned long lastDebounceTime = 0;
const unsigned long DEBOUNCE_DELAY =
    40; // 40ms filters touch contact chatter & mains noise
unsigned long touchStartTime = 0;
unsigned long lastEdgeTime = 0;
bool touchActive = false;
bool touchPulseConfirmed = false; // true once a short <1.2s tap proves momentary sensor
bool resetTriggered = false;
uint8_t rapidFlipCount = 0;
unsigned long firstRapidFlipTime = 0;
bool configSavePending = false;
unsigned long configSaveRequestedAt = 0;

// OTA is executed from loop() (never inside an MQTT/HTTP callback) so the stack
// stays small.
String pendingOtaUrl = "";
bool otaRunning = false;
unsigned int lastOtaPct = 101;

long remainingTimerSeconds() {
  if (!hwTimerActive)
    return 0;
  long diff = (long)(hwTimerEndsAt - millis());
  return diff > 0 ? (diff + 999) / 1000 : 0;
}

void publishOta(const String &msg) {
  if (!mqttClient.connected())
    return;
  String topic = "nari/" + String(config.devId) + "/ota/progress";
  mqttClient.publish(topic.c_str(), msg.c_str(), false);
  mqttClient.loop();
}

void publishState() {
  if (!mqttClient.connected())
    return;
  String topic = "nari/" + String(config.devId) + "/state";
  String json = String("{\"state\":") + (relayState ? "1" : "0") +
                ",\"ip\":\"" + WiFi.localIP().toString() + "\"" +
                ",\"rssi\":" + String(WiFi.RSSI()) +
                ",\"timerRemSec\":" + String(remainingTimerSeconds()) +
                ",\"autoOffSec\":" + String(config.autoOffSec) +
                ",\"lock\":" + (config.wallSwitchLock ? "1" : "0") +
                ",\"fw\":\"" + FW_VERSION + "\"}";
  mqttClient.publish(topic.c_str(), json.c_str(), true);
}

void publishHaDiscovery() {
  if (!mqttClient.connected())
    return;
  String id = String(config.devId);
  String dTopic = "homeassistant/switch/" + id + "/config";
  String base = "nari/" + id;
  String payload = String("{\"name\":\"") + String(config.devName) +
                   "\",\"uniq_id\":\"" + id +
                   "\",\"cmd_t\":\"" + base + "/set\"" +
                   ",\"stat_t\":\"" + base + "/state\"" +
                   ",\"val_tpl\":\"{{ value_json.state }}\"" +
                   ",\"pl_on\":\"1\",\"pl_off\":\"0\"" +
                   ",\"stat_on\":1,\"stat_off\":0" +
                   ",\"avty_t\":\"" + base + "/status\"" +
                   ",\"dev\":{\"ids\":[\"" + id + "\"],\"name\":\"" +
                   String(config.devName) +
                   "\",\"mf\":\"NARI\",\"mdl\":\"Smart Switch\",\"sw\":\"" +
                   FW_VERSION + "\"}}";
  mqttClient.publish(dTopic.c_str(), payload.c_str(), true);
}

// Only plain http:// links to a .bin are accepted (ESP-01S cannot do TLS
// reliably).
bool otaUrlAllowed(const String &url) {
  return url.startsWith("http://") && url.endsWith(".bin") &&
         url.length() < 200;
}

void runOta() {
  String url = pendingOtaUrl;
  pendingOtaUrl = "";
  otaRunning = true;
  lastOtaPct = 101;
  publishOta("start");

  ESPhttpUpdate.rebootOnUpdate(false);
  ESPhttpUpdate.onProgress([](int cur, int total) {
    if (total <= 0)
      return;
    unsigned int pct = (unsigned int)((cur * 100L) / total);
    if (pct / 5 != lastOtaPct / 5) { // report every 5 %
      lastOtaPct = pct;
      publishOta(String("progress:") + pct);
    }
  });

  WiFiClient otaClient;
  t_httpUpdate_return ret = ESPhttpUpdate.update(otaClient, url);
  switch (ret) {
  case HTTP_UPDATE_OK:
    publishOta("done");
    delay(500);
    ESP.restart();
    break;
  case HTTP_UPDATE_NO_UPDATES:
    publishOta("error:no update available");
    break;
  default: {
    String err = ESPhttpUpdate.getLastErrorString();
    if (mqttClient.connected()) {
      String topic = "nari/" + String(config.devId) + "/ota/error";
      mqttClient.publish(topic.c_str(), err.c_str(), false);
    }
    publishOta("error:" + err);
  }
  }
  otaRunning = false;
}

// ---------- EEPROM Management ----------
void loadConfig() {
  EEPROM.begin(512);
  EEPROM.get(0, config);
  if (config.magic != EEPROM_MAGIC) {
    // Fresh unconfigured device
    memset(&config, 0, sizeof(config));
    config.magic = EEPROM_MAGIC;
    String autoId = "sw_" + String(ESP.getChipId(), HEX) +
                    String(ESP.getFlashChipId(), HEX);
    autoId.toLowerCase();
    strncpy(config.devId, autoId.c_str(), sizeof(config.devId) - 1);
    strncpy(config.devName, "Switch 1", sizeof(config.devName) - 1);
    strncpy(config.authKey, DEFAULT_AUTH_KEY, sizeof(config.authKey) - 1);
    strncpy(config.bootState, "LAST", sizeof(config.bootState) - 1);
    config.lastState = false;
    config.autoOffSec = 0;
    config.wallSwitchLock = false;
    EEPROM.put(0, config);
    EEPROM.commit();
  }
  if (config.autoOffSec > 43200)
    config.autoOffSec = 0; // sanity guard on upgraded EEPROM struct
}

void saveConfig() {
  EEPROM.put(0, config);
  EEPROM.commit();
}

// In-built LED on GPIO2 is active LOW: LOW = ON, HIGH = OFF
void setLed(bool on) { digitalWrite(LED_PIN, on ? LOW : HIGH); }

// Flashing (resetting Wi-Fi credentials): blink 3 times, erase credentials,
// reboot to pairing mode
void triggerFactoryReset() {
  for (int i = 0; i < 3; i++) {
    setLed(true);
    delay(150);
    setLed(false);
    delay(150);
  }
  memset(config.ssid, 0, sizeof(config.ssid));
  memset(config.pass, 0, sizeof(config.pass));
  saveConfig();
  ESP.restart();
}

// ---------- Hardware Control ----------
void setRelay(bool state, bool publishMqtt = true) {
  relayState = state;
  // ESP-01S relay shield: Active HIGH
  digitalWrite(RELAY_PIN, relayState ? HIGH : LOW);

  // Hardware Inching (Auto-Off Pulse Mode) & Orphaned Timer Cleanup:
  // - When turned ON (even via physical wall switch!), auto-arm inching timer if configured
  // - When turned OFF manually, cancel any pending auto-off countdown timer
  if (relayState && config.autoOffSec > 0) {
    hwTimerActive = true;
    hwTimerEndsAt = millis() + ((unsigned long)config.autoOffSec * 1000UL);
    hwTimerTargetState = false;
  } else if (!relayState && hwTimerActive && !hwTimerTargetState) {
    hwTimerActive = false;
    hwTimerEndsAt = 0;
  }

  if (strcmp(config.bootState, "LAST") == 0) {
    if (config.lastState != relayState) {
      config.lastState = relayState;
      // Defer flash commit by 2s (rollover-safe) so rapid switching never stalls
      // the CPU or wears flash
      configSavePending = true;
      configSaveRequestedAt = millis();
    }
  }

  if (publishMqtt)
    publishState();
}

void setHardwareTimer(unsigned long seconds, bool targetState) {
  if (seconds == 0) {
    hwTimerActive = false;
    hwTimerEndsAt = 0;
  } else {
    hwTimerActive = true;
    hwTimerEndsAt = millis() + (seconds * 1000UL);
    hwTimerTargetState = targetState;
  }
  publishState();
}

// ---------- Captive Portal Auto-Popup & Handlers ----------
String urlEncode(const String &str) {
  String encoded = "";
  for (size_t i = 0; i < str.length(); i++) {
    char c = str.charAt(i);
    if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
      encoded += c;
    } else if (c == ' ') {
      encoded += "+";
    } else {
      encoded += '%';
      char hex[3];
      sprintf(hex, "%02X", (unsigned char)c);
      encoded += hex;
    }
  }
  return encoded;
}

bool isIpAddress(const String &str) {
  for (size_t i = 0; i < str.length(); i++) {
    int c = str.charAt(i);
    if (c != '.' && (c < '0' || c > '9'))
      return false;
  }
  return true;
}

// 302 Redirect to 192.168.4.1 triggers OS Captive Network Assistant (Android,
// iOS, Windows) Note: NEVER call server.client().stop() here as it drops the
// TCP socket before lwIP transmits the 302!
void redirectToPortal() {
  server.sendHeader("Location", "http://192.168.4.1/", true);
  server.send(302, "text/plain", "");
}

void handleCaptivePortal();

void handlePortalNotFound() {
  if (!isConfigMode && !fallbackApActive) {
    // In normal STA mode, answer browser OPTIONS CORS preflights
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Private-Network", "true");
    server.sendHeader("Access-Control-Allow-Headers", "*");
    server.send(204);
    return;
  }
  String host = server.hostHeader();
  // If request is probing an external domain (e.g.
  // connectivitycheck.gstatic.com, captive.apple.com), issue a 302 redirect so
  // mobile OSes automatically pop up the Wi-Fi setup page!
  if (!isIpAddress(host) && host != "192.168.4.1" && host != "192.168.4.1:80") {
    redirectToPortal();
    return;
  }
  handleCaptivePortal();
}

void handleCaptivePortal() {
  server.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  server.sendHeader("Pragma", "no-cache");
  server.sendHeader("Expires", "-1");

  String s =
      "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' "
      "content='width=device-width,initial-scale=1'>"
      "<title>NARI Smart Home Setup</title><style>"
      "body{font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe "
      "UI',Roboto,sans-serif;background:radial-gradient(ellipse at 50% "
      "-10%,#154c33 0%,#091d14 45%,#050e0a "
      "100%);color:#f1f5f9;margin:0;padding:24px "
      "14px;min-height:100vh;display:flex;align-items:center;justify-content:"
      "center;box-sizing:border-box;}"
      ".card{width:100%;max-width:380px;background:rgba(12,28,20,0.85);"
      "backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:"
      "1px solid rgba(52,211,153,0.25);border-radius:26px;padding:26px "
      "20px;box-shadow:0 24px 60px -12px rgba(0,0,0,0.7),0 0 40px -10px "
      "rgba(16,185,129,0.22);text-align:center;box-sizing:border-box;}"
      ".logo-halo{display:flex;align-items:center;justify-content:center;"
      "margin:0 auto 12px;filter:drop-shadow(0 8px 20px rgba(16,185,129,0.5));}"
      ".title{font-size:1.45rem;font-weight:800;letter-spacing:-0.5px;color:#"
      "fff;margin-bottom:6px;}"
      ".title span{color:#34d399;font-weight:600;}"
      ".pill{display:inline-flex;align-items:center;gap:6px;background:rgba(16,"
      "185,129,0.14);border:1px solid rgba(52,211,153,0.3);padding:4px "
      "12px;border-radius:20px;font-size:0.7rem;font-weight:700;color:#6ee7b7;"
      "letter-spacing:0.8px;margin-bottom:20px;}"
      ".pulse{width:6px;height:6px;background:#34d399;border-radius:50%;box-"
      "shadow:0 0 8px #34d399;}"
      ".form-group{margin-bottom:14px;text-align:left;}"
      "label{display:block;font-size:0.74rem;font-weight:700;color:#cbd5e1;"
      "margin-bottom:6px;letter-spacing:0.3px;}"
      ".sel-wrap{position:relative;}"
      "select{width:100%;box-sizing:border-box;padding:12px 36px 12px "
      "12px;background:#06140d;color:#fff;border:1px solid "
      "#1e4532;border-radius:12px;font-size:0.9rem;outline:none;appearance:"
      "none;-webkit-appearance:none;cursor:pointer;}"
      ".sel-arrow{position:absolute;right:14px;top:50%;transform:translateY(-"
      "50%);pointer-events:none;color:#94a3b8;}"
      "select:focus{border-color:#34d399;box-shadow:0 0 0 3px "
      "rgba(16,185,129,0.2);}"
      ".pw-wrap{position:relative;width:100%;box-sizing:border-box;}"
      ".pw-wrap input{width:100%;box-sizing:border-box;padding:12px 42px 12px "
      "12px;margin:0;background:#06140d;color:#fff;border:1px solid "
      "#1e4532;border-radius:12px;font-size:0.9rem;outline:none;}"
      ".pw-wrap input:focus{border-color:#34d399;box-shadow:0 0 0 3px "
      "rgba(16,185,129,0.2);}"
      ".eye-btn{position:absolute;right:0;top:0;height:100%;width:42px;"
      "background:none;border:none;color:#94a3b8;cursor:pointer;display:flex;"
      "align-items:center;justify-content:center;padding:0;box-shadow:none;}"
      ".eye-btn:active{color:#34d399;}"
      "input[type='text']{width:100%;box-sizing:border-box;padding:12px;"
      "background:#06140d;color:#fff;border:1px solid "
      "#1e4532;border-radius:12px;font-size:0.9rem;outline:none;}"
      "input[type='text']:focus{border-color:#34d399;box-shadow:0 0 0 3px "
      "rgba(16,185,129,0.2);}"
      ".chips{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;}"
      ".chip{background:rgba(255,255,255,0.06);border:1px solid "
      "rgba(255,255,255,0.1);color:#94a3b8;font-size:0.68rem;padding:3px "
      "8px;border-radius:6px;cursor:pointer;}"
      ".chip:active{background:rgba(52,211,153,0.2);color:#34d399;border-color:"
      "#34d399;}"
      ".btn{width:100%;padding:14px;margin-top:6px;background:linear-gradient("
      "135deg,#10b981 0%,#059669 "
      "100%);color:#fff;border:none;border-radius:14px;font-weight:700;font-"
      "size:0.98rem;cursor:pointer;box-shadow:0 8px 24px "
      "rgba(16,185,129,0.38);transition:opacity 0.2s;}"
      ".btn:active{opacity:0.85;transform:scale(0.99);}"
      ".trust{display:flex;align-items:center;justify-content:center;gap:12px;"
      "margin-top:16px;font-size:0.68rem;color:#64748b;}"
      "</style></head><body><div class='card'>"
      "<div class='logo-halo'>"
      "<svg width='54' height='54' viewBox='0 0 192 192' "
      "xmlns='http://www.w3.org/2000/svg'>"
      "<defs><linearGradient id='lg' x1='0%' y1='0%' x2='100%' y2='100%'><stop "
      "offset='0%' stop-color='#34d399'/><stop offset='100%' "
      "stop-color='#059669'/></linearGradient></defs>"
      "<rect width='192' height='192' rx='42' fill='url(#lg)'/>"
      "<path d='M96 46 Q132 16 168 46' fill='none' stroke='white' "
      "stroke-width='12' stroke-linecap='round'/>"
      "<path d='M96 66 Q122 44 148 66' fill='none' stroke='white' "
      "stroke-width='12' stroke-linecap='round'/>"
      "<polygon points='96,78 152,122 40,122' fill='white'/>"
      "<rect x='64' y='122' width='64' height='48' rx='4' fill='white'/>"
      "<rect x='78' y='134' width='16' height='16' rx='2' fill='#064e3b'/>"
      "<rect x='100' y='130' width='16' height='40' rx='2' fill='#064e3b'/>"
      "</svg></div>"
      "<div class='title'>NARI <span>SMART HOME</span></div>"
      "<div class='pill'><span class='pulse'></span>PAIRING NEW SMART "
      "SWITCH</div>"
      "<form action='/save' method='POST'>"
      "<div class='form-group'><label>Home Wi-Fi Network (2.4 GHz)</label><div "
      "class='sel-wrap'><select name='ssid'>";

  int n = WiFi.scanComplete();
  if (n > 0) {
    for (int i = 0; i < n; ++i) {
      String rssiStr = String(WiFi.RSSI(i)) + " dBm";
      s += "<option value='" + WiFi.SSID(i) + "'>" + WiFi.SSID(i) + " (" +
           rssiStr + ")</option>";
    }
  } else {
    if (n == WIFI_SCAN_FAILED)
      WiFi.scanNetworks(true);
    s += "<option value=''>Scanning networks... (refresh if empty)</option>";
  }
  s += "</select><div class='sel-arrow'>&#9662;</div></div></div>";
  s += "<div class='form-group'><label>Wi-Fi Password</label><div "
       "class='pw-wrap'>";
  s += "<input type='password' id='pw' name='pass' placeholder='Enter Wi-Fi "
       "password' required autofocus>";
  s += "<button type='button' class='eye-btn' onclick='togglePw()' "
       "aria-label='Toggle password visibility'>";
  s += "<svg id='eyeIcon' width='20' height='20' viewBox='0 0 24 24' "
       "fill='none' stroke='currentColor' stroke-width='2' "
       "stroke-linecap='round' stroke-linejoin='round'>";
  s += "<path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'/><circle "
       "cx='12' cy='12' r='3'/>";
  s += "</svg></button></div></div>";
  s += "<div class='form-group'><label>Switch Name (Optional)</label>";
  s += "<input type='text' id='devName' name='name' value='" +
       String(config.devName) + "' placeholder='e.g. Hall Light'>";
  s += "<div class='chips'>";
  s += "<span class='chip' onclick='setName(\"Hall Light\")'>Hall Light</span>";
  s += "<span class='chip' onclick='setName(\"Bedroom Light\")'>Bedroom</span>";
  s += "<span class='chip' onclick='setName(\"Kitchen Light\")'>Kitchen</span>";
  s += "<span class='chip' onclick='setName(\"Ceiling Fan\")'>Fan</span>";
  s += "<span class='chip' onclick='setName(\"Porch Light\")'>Porch</span>";
  s += "</div></div>";
  s += "<button type='submit' class='btn'>Connect Switch &rarr;</button>";
  s += "<div class='trust'><span>&#128274; Local "
       "WPA2/WPA3</span>&bull;<span>&#9889; Instant App Sync</span></div>";
  s += "</form></div>";
  s += "<script>";
  s += "function togglePw(){";
  s += "var "
       "p=document.getElementById('pw'),ic=document.getElementById('eyeIcon');";
  s += "if(p.type==='password'){p.type='text';ic.innerHTML=\"<path d='M17.94 "
       "17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 "
       "5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 "
       "1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24'/><line x1='1' y1='1' "
       "x2='23' y2='23'/>\";}";
  s += "else{p.type='password';ic.innerHTML=\"<path d='M1 12s4-8 11-8 11 8 11 "
       "8-4 8-11 8-11-8-11-8z'/><circle cx='12' cy='12' r='3'/>\";}";
  s += "};";
  s += "function setName(v){document.getElementById('devName').value=v;}";
  s += "</script></body></html>";

  server.send(200, "text/html", s);
}

void handleSave() {
  String newSsid = server.arg("ssid");
  String newPass = server.arg("pass");
  String newName = server.arg("name");

  if (newSsid.length() > 0) {
    strncpy(config.ssid, newSsid.c_str(), sizeof(config.ssid) - 1);
    strncpy(config.pass, newPass.c_str(), sizeof(config.pass) - 1);
    if (newName.length() > 0)
      strncpy(config.devName, newName.c_str(), sizeof(config.devName) - 1);
    saveConfig();

    String chosenName = newName.length() > 0 ? newName : String(config.devName);
    String webAppUrl = String(DEFAULT_WEBAPP_URL) +
                       "?action=pair&id=" + String(config.devId) +
                       "&name=" + urlEncode(chosenName);
    String localAppUrl =
        "http://localhost:8080/?action=pair&id=" + String(config.devId) +
        "&name=" + urlEncode(chosenName);

    String resp =
        "<!DOCTYPE html><html><head><meta charset='utf-8'><meta "
        "name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>Credentials Saved</title><style>"
        "body{font-family:system-ui,-apple-system,sans-serif;background:radial-"
        "gradient(ellipse at 50% -10%,#154c33 0%,#091d14 45%,#050e0a "
        "100%);color:#f1f5f9;margin:0;padding:24px "
        "14px;min-height:100vh;display:flex;align-items:center;justify-content:"
        "center;box-sizing:border-box;}"
        ".card{width:100%;max-width:390px;background:rgba(12,28,20,0.88);"
        "backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:"
        "1px solid rgba(52,211,153,0.3);border-radius:26px;padding:30px "
        "22px;box-shadow:0 24px 60px -12px rgba(0,0,0,0.7),0 0 40px -10px "
        "rgba(16,185,129,0.25);text-align:center;box-sizing:border-box;}"
        ".check{width:64px;height:64px;background:linear-gradient(135deg,#"
        "10b981,#059669);border-radius:50%;display:flex;align-items:center;"
        "justify-content:center;margin:0 auto 16px;box-shadow:0 10px 24px "
        "rgba(16,185,129,0.5);font-size:30px;color:#fff;}"
        "h2{margin:0 0 8px;color:#34d399;font-size:1.4rem;font-weight:800;}"
        "p{color:#94a3b8;font-size:0.9rem;line-height:1.5;margin:0 0 14px;}"
        ".badge{display:inline-block;background:rgba(16,185,129,0.15);border:"
        "1px solid rgba(52,211,153,0.35);padding:4px "
        "12px;border-radius:12px;font-size:0.75rem;color:#6ee7b7;font-weight:"
        "600;margin-bottom:14px;}"
        ".steps{text-align:left;background:rgba(6,20,13,0.6);border:1px solid "
        "#1e4532;border-radius:14px;padding:12px 14px;margin:12px 0 "
        "16px;font-size:0.8rem;color:#cbd5e1;line-height:1.5;}"
        ".steps b{color:#34d399;}"
        ".btn{display:block;width:100%;box-sizing:border-box;text-decoration:"
        "none;padding:15px 16px;margin:10px "
        "0;background:linear-gradient(135deg,#10b981 0%,#059669 "
        "100%);color:#fff;border-radius:14px;font-weight:800;font-size:0.95rem;"
        "letter-spacing:0.3px;box-shadow:0 8px 24px "
        "rgba(16,185,129,0.4);transition:transform 0.15s,opacity 0.15s;}"
        ".btn:active{transform:scale(0.98);opacity:0.9;}"
        ".subinfo{font-size:0.75rem;color:#64748b;margin-top:14px;line-height:"
        "1.4;}"
        ".subinfo a{color:#34d399;text-decoration:underline;}"
        "</style></head><body><div class='card'>"
        "<div class='check'>&#10004;</div>"
        "<h2>Credentials Saved!</h2>"
        "<p>Rebooting switch to connect to <b>" +
        newSsid +
        "</b>...</p>"
        "<div class='badge'>Device ID: " +
        String(config.devId) +
        "</div>"
        "<div class='steps'>"
        "<b>1.</b> Switch phone back to <b>" +
        newSsid +
        "</b> Wi-Fi.<br>"
        "<b>2.</b> Tap button below &mdash; dashboard auto-adds this switch!"
        "</div>"
        "<a href='" +
        webAppUrl +
        "' class='btn'>🚀 Open Dashboard &amp; Auto-Add Switch &rarr;</a>"
        "<div class='subinfo'>Testing locally? <a href='" +
        localAppUrl +
        "'>Open localhost:8080</a></div>"
        "</div></body></html>";
    server.send(200, "text/html", resp);
    delay(2500);
    ESP.restart();
  } else {
    server.send(400, "text/plain", "Missing SSID");
  }
}

void enableCaptivePortalAp() {
  IPAddress apIP(192, 168, 4, 1);
  IPAddress netMsk(255, 255, 255, 0);
  WiFi.softAPConfig(apIP, apIP, netMsk);

  String apName = "NARI-" + String(ESP.getChipId(), HEX);
  apName.toUpperCase();
  WiFi.softAP(apName.c_str());
  WiFi.scanNetworks(true); // Pre-scan in background

  dnsServer.setErrorReplyCode(DNSReplyCode::NoError);
  dnsServer.start(53, "*", apIP);
}

void stopFallbackAp() {
  if (!fallbackApActive)
    return;
  fallbackApActive = false;
  dnsServer.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
}

// ---------- LAN HTTP Handlers (Normal Mode) ----------
// Contract used by js/transport.js:  /ping  /toggle?state=1
// /setBootState?mode=LAST  /timer?sec=900&state=0  /ota?url=http://...bin
void sendCors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
  server.sendHeader("Access-Control-Allow-Headers", "*");
}

bool lanAuthorized() {
  String k = server.hasArg("k") ? server.arg("k") : server.arg("token");
  if (k == String(config.authKey))
    return true;
  sendCors();
  server.send(401, "application/json", "{\"error\":\"unauthorized\"}");
  return false;
}

void handleLanPing() {
  if (!lanAuthorized())
    return;
  String json =
      "{\"id\":\"" + String(config.devId) + "\",\"name\":\"" +
      String(config.devName) + "\",\"state\":" + (relayState ? "1" : "0") +
      ",\"ip\":\"" + WiFi.localIP().toString() + "\"" +
      ",\"timerRemSec\":" + String(remainingTimerSeconds()) +
      ",\"autoOffSec\":" + String(config.autoOffSec) +
      ",\"lock\":" + (config.wallSwitchLock ? "1" : "0") +
      ",\"rssi\":" + String(WiFi.RSSI()) + ",\"fw\":\"" + FW_VERSION + "\"}";
  sendCors();
  server.send(200, "application/json", json);
}

void handleLanToggle() {
  if (!lanAuthorized())
    return;
  String s = server.arg("state");
  if (s == "1" || s == "true" || s == "ON")
    setRelay(true);
  else if (s == "0" || s == "false" || s == "OFF")
    setRelay(false);
  else
    setRelay(!relayState);
  sendCors();
  server.send(200, "text/plain", relayState ? "1" : "0");
}

void handleLanTimer() {
  if (!lanAuthorized())
    return;
  long sec = server.hasArg("sec") ? server.arg("sec").toInt() : 0;
  String st = server.arg("state");
  bool target = (st == "1" || st == "true" || st.equalsIgnoreCase("on"));
  if (sec <= 0) {
    setHardwareTimer(0, false);
  } else {
    setHardwareTimer((unsigned long)sec, target);
  }
  sendCors();
  server.send(200, "application/json",
              String("{\"timerRemSec\":") + String(remainingTimerSeconds()) +
                  "}");
}

void handleLanBootState() {
  if (!lanAuthorized())
    return;
  if (server.hasArg("autoOff")) {
    long ao = server.arg("autoOff").toInt();
    config.autoOffSec = (ao > 0 && ao <= 43200) ? (uint16_t)ao : 0;
  }
  if (server.hasArg("lock")) {
    String lk = server.arg("lock");
    config.wallSwitchLock = (lk == "1" || lk.equalsIgnoreCase("true") || lk.equalsIgnoreCase("on"));
  }
  String m = server.arg("mode");
  m.toUpperCase();
  if (m == "LAST" || m == "ON" || m == "OFF") {
    memset(config.bootState, 0, sizeof(config.bootState));
    strncpy(config.bootState, m.c_str(), sizeof(config.bootState) - 1);
  }
  saveConfig();
  publishState();
  sendCors();
  server.send(200, "text/plain", "ok");
}

void handleLanOta() {
  if (!lanAuthorized())
    return;
  String url = server.arg("url");
  sendCors();
  if (!otaUrlAllowed(url)) {
    server.send(400, "text/plain", "url must be http://...bin");
    return;
  }
  if (otaRunning || pendingOtaUrl.length() > 0) {
    server.send(409, "text/plain", "busy");
    return;
  }
  pendingOtaUrl = url;
  server.send(202, "text/plain", "ota queued");
}

void registerHttpRoutes() {
  server.on("/", handleCaptivePortal);
  server.on("/save", HTTP_POST, handleSave);

  // Android / iOS / Windows / Firefox Captive Portal detection endpoints
  server.on("/generate_204", redirectToPortal);
  server.on("/gen_204", redirectToPortal);
  server.on("/mobile/status.php", redirectToPortal);
  server.on("/check_network_status.txt", redirectToPortal);
  server.on("/hotspot-detect.html", redirectToPortal);
  server.on("/library/test/success.html", redirectToPortal);
  server.on("/success.txt", redirectToPortal);
  server.on("/connecttest.txt", redirectToPortal);
  server.on("/ncsi.txt", redirectToPortal);
  server.on("/redirect", redirectToPortal);
  server.on("/canonical.html", redirectToPortal);

  // LAN API endpoints
  server.on("/ping", HTTP_GET, handleLanPing);
  server.on("/info", HTTP_GET, handleLanPing);
  server.on("/toggle", HTTP_GET, handleLanToggle);
  server.on("/timer", HTTP_GET, handleLanTimer);
  server.on("/setBootState", HTTP_GET, handleLanBootState);
  server.on("/ota", HTTP_GET, handleLanOta);
  server.onNotFound(handlePortalNotFound);
  server.begin();
}

void startSetupAP() {
  isConfigMode = true;
  WiFi.disconnect();
  WiFi.mode(WIFI_AP_STA);
  enableCaptivePortalAp();
  registerHttpRoutes();
}

// ---------- MQTT Callbacks ----------
void onMqttMessage(char *topic, byte *payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length && i < 256; i++)
    msg += (char)payload[i];
  msg.trim();
  String t = String(topic);

  if (t.endsWith("/ota")) {
    if (otaUrlAllowed(msg) && !otaRunning)
      pendingOtaUrl = msg;
    else
      publishOta("error:rejected url");
    return;
  }
  if (t.endsWith("/config/boot")) {
    msg.toUpperCase();
    if (msg == "LAST" || msg == "ON" || msg == "OFF") {
      memset(config.bootState, 0, sizeof(config.bootState));
      strncpy(config.bootState, msg.c_str(), sizeof(config.bootState) - 1);
      saveConfig();
      publishState();
    }
    return;
  }
  if (t.endsWith("/config/inching")) {
    long ao = msg.toInt();
    config.autoOffSec = (ao > 0 && ao <= 43200) ? (uint16_t)ao : 0;
    saveConfig();
    publishState();
    return;
  }
  if (t.endsWith("/config/lock")) {
    config.wallSwitchLock = (msg == "1" || msg.equalsIgnoreCase("true") || msg.equalsIgnoreCase("on"));
    saveConfig();
    publishState();
    return;
  }
  if (t.endsWith("/timer")) {
    // Format: "<seconds>:<0|1>" or "<seconds>" (default target 0/OFF)
    int colon = msg.indexOf(':');
    long sec = (colon >= 0 ? msg.substring(0, colon) : msg).toInt();
    bool target = false;
    if (colon >= 0) {
      String act = msg.substring(colon + 1);
      act.trim();
      target = (act == "1" || act.equalsIgnoreCase("on") ||
                act.equalsIgnoreCase("true"));
    }
    setHardwareTimer(sec > 0 ? (unsigned long)sec : 0, target);
    return;
  }

  // Handle r1:1 / r1:0 or standard ON/OFF/1/0/TOGGLE
  if (msg.equalsIgnoreCase("ON") || msg == "1" || msg.equalsIgnoreCase("TRUE") ||
      msg.equalsIgnoreCase("r1:1") || msg.equalsIgnoreCase("r1:on"))
    setRelay(true);
  else if (msg.equalsIgnoreCase("OFF") || msg == "0" ||
           msg.equalsIgnoreCase("FALSE") || msg.equalsIgnoreCase("r1:0") ||
           msg.equalsIgnoreCase("r1:off"))
    setRelay(false);
  else if (msg.equalsIgnoreCase("TOGGLE") || msg.equalsIgnoreCase("r1:toggle"))
    setRelay(!relayState);
}

void reconnectMqtt() {
  if (WiFi.status() != WL_CONNECTED || isConfigMode)
    return;
  if (millis() - lastMqttRetry < 8000)
    return;
  lastMqttRetry = millis();

  espClient.setTimeout(
      400); // 400ms timeout prevents blocking loop() if broker/cloud is down
  mqttClient.setServer(DEFAULT_MQTT_BROKER, DEFAULT_MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);

  String clientId = "nari_dev_" + String(config.devId);
  String willTopic = "nari/" + String(config.devId) + "/status";

  if (mqttClient.connect(clientId.c_str(), DEFAULT_MQTT_USER, DEFAULT_MQTT_PASS,
                         willTopic.c_str(), 0, true, "offline")) {
    mqttClient.publish(willTopic.c_str(), "online", true);
    String base = "nari/" + String(config.devId);
    mqttClient.subscribe((base + "/set").c_str());
    mqttClient.subscribe((base + "/timer").c_str());
    mqttClient.subscribe((base + "/ota").c_str());
    mqttClient.subscribe((base + "/config/boot").c_str());
    mqttClient.subscribe((base + "/config/inching").c_str());
    mqttClient.subscribe((base + "/config/lock").c_str());
    publishHaDiscovery();
    publishState();
  }
}

// ---------- Wall Switch / Capacitive Touch Polling ----------
void pollWallSwitch() {
  int rawTouch = digitalRead(TOUCH_PIN);
  if (rawTouch != lastRawTouch) {
    lastDebounceTime = millis();
    lastRawTouch = rawTouch;
  }

  if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY) {
    if (rawTouch != debouncedTouch) {
      debouncedTouch = rawTouch;
      unsigned long now = millis();
      unsigned long prevHoldDuration = now - lastEdgeTime;
      lastEdgeTime = now;

      bool isActiveEdge = (debouncedTouch != touchIdleLevel);
      bool shouldToggle = false;

      if (isActiveEdge) {
        touchActive = true;
        touchStartTime = now;
        resetTriggered = false;
        shouldToggle = true; // Always toggle immediately on press / flip-ON
      } else {
        // Returning to touchIdleLevel:
        // - If held < 1200ms, this is a momentary push-button or capacitive
        //   touch release (do NOT toggle again on finger release).
        // - If held >= 1200ms, this is a latching mechanical wall rocker switch
        //   being flipped back (DO toggle on flip-OFF!).
        if (touchActive && prevHoldDuration < 1200) {
          touchPulseConfirmed = true;
        } else if (prevHoldDuration >= 1200) {
          shouldToggle = true;
        }
        touchActive = false;
        resetTriggered = false;
      }

      if (shouldToggle) {
        // Respect Child Lock / Wall Switch Lock unless in AP setup mode
        if (!config.wallSwitchLock || isConfigMode || fallbackApActive) {
          setRelay(!relayState);
          blinkOnceUntil = now + 120;
          setLed(!relayState);
        }

        // Track 5 rapid flips/taps within 4 seconds for universal factory reset
        // Security & Child-Safety Guard (Shelly/Tasmota standard): Only allow 5-flip
        // factory reset during the first 60 seconds after power-on boot!
        if (now < 60000UL) {
          if (rapidFlipCount == 0 || (now - firstRapidFlipTime > 4000)) {
            rapidFlipCount = 1;
            firstRapidFlipTime = now;
          } else {
            rapidFlipCount++;
            if (rapidFlipCount >= 5) {
              rapidFlipCount = 0;
              triggerFactoryReset();
              return;
            }
          }
        }
      }
    }
  }

  // Capacitive touch >5s hold reset: only active if a short momentary pulse was
  // previously confirmed since boot, so a latching rocker switch NEVER resets
  // Wi-Fi after 5 seconds!
  if (touchPulseConfirmed && touchActive && !resetTriggered &&
      (millis() - touchStartTime >= 5000)) {
    resetTriggered = true;
    triggerFactoryReset();
  }
}

// ---------- Setup & Loop ----------
void setup() {
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  setLed(false); // LED off initially

  // Touch / Wall Switch input on GPIO3 (RX pin)
  pinMode(TOUCH_PIN, INPUT_PULLUP);
  delay(50); // allow touch sensor voltage to stabilize
  touchIdleLevel = digitalRead(TOUCH_PIN);
  lastRawTouch = touchIdleLevel;
  debouncedTouch = touchIdleLevel;
  lastEdgeTime = millis();

  loadConfig();

  // Apply boot state immediately (before Wi-Fi connects)
  if (strcmp(config.bootState, "ON") == 0)
    relayState = true;
  else if (strcmp(config.bootState, "OFF") == 0)
    relayState = false;
  else
    relayState = config.lastState;
  setRelay(relayState, false);

  // If no SSID configured, enter Captive Portal immediately
  if (strlen(config.ssid) == 0) {
    startSetupAP();
    return;
  }

  // Register HTTP server & OTA handlers immediately
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.begin(config.ssid, config.pass);

  registerHttpRoutes();
  ArduinoOTA.setHostname(config.devId);
  ArduinoOTA.setPassword(config.authKey);
  ArduinoOTA.begin();

  // Brief non-blocking wait (up to 6s) while keeping wall switch responsive
  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 6000) {
    pollWallSwitch();
    if (millis() - lastLedBlink >= 250) {
      lastLedBlink = millis();
      ledBlinkState = !ledBlinkState;
      setLed(ledBlinkState);
    }
    delay(10);
  }

  if (WiFi.status() == WL_CONNECTED) {
    setLed(relayState);
    wifiDisconnectedSince = 0;
  } else {
    // Do NOT lock into permanent AP mode at 15s (home routers take 60-90s to
    // boot after an Indian power cut). loop() will keep retrying STA and open
    // a recoverable fallback AP only if still offline after 90s.
    wifiDisconnectedSince = millis();
    lastStaRetry = millis();
  }
}

void loop() {
  // 1. Poll physical wall switch / capacitive touch (always active, 0ms lag)
  pollWallSwitch();

  // 2. Check on-device hardware countdown timer
  if (hwTimerActive && (long)(millis() - hwTimerEndsAt) >= 0) {
    hwTimerActive = false;
    hwTimerEndsAt = 0;
    setRelay(hwTimerTargetState, true);
  }

  // 3. Power-Cut & Router Reboot Auto-Recovery Engine
  if (!isConfigMode) {
    if (WiFi.status() == WL_CONNECTED) {
      wifiDisconnectedSince = 0;
      if (fallbackApActive) {
        // Home router came back online! Shut down temporary fallback AP.
        stopFallbackAp();
      }
    } else {
      if (wifiDisconnectedSince == 0) {
        wifiDisconnectedSince = millis();
      }
      // Retry connecting to saved home router every 20 seconds
      if (millis() - lastStaRetry >= 20000) {
        lastStaRetry = millis();
        WiFi.begin(config.ssid, config.pass);
      }
      // If router is still unreachable after 90 seconds (e.g., user changed
      // Wi-Fi password), turn on fallback Captive Portal AP in WIFI_AP_STA mode
      // while continuing to retry home Wi-Fi in the background!
      if (!fallbackApActive && (millis() - wifiDisconnectedSince >= 90000)) {
        fallbackApActive = true;
        WiFi.mode(WIFI_AP_STA);
        enableCaptivePortalAp();
        WiFi.begin(config.ssid, config.pass);
      }
    }
  }

  // 4. In-Built LED Status Engine (GPIO2)
  if (isConfigMode || fallbackApActive) {
    // Pairing / Fallback AP mode: blink rapidly (100ms)
    if (millis() - lastLedBlink >= 100) {
      lastLedBlink = millis();
      ledBlinkState = !ledBlinkState;
      setLed(ledBlinkState);
    }
  } else if (WiFi.status() != WL_CONNECTED) {
    // Reconnecting to home router: blink slowly (500ms)
    if (millis() - lastLedBlink >= 500) {
      lastLedBlink = millis();
      ledBlinkState = !ledBlinkState;
      setLed(ledBlinkState);
    }
  } else {
    // Normal connected operation:
    if ((long)(blinkOnceUntil - millis()) > 0) {
      setLed(!relayState); // Confirmation blink once
    } else {
      setLed(relayState); // Relay ON = LED ON, Relay OFF = LED OFF
    }
  }

  // 5. Rollover-safe Deferred EEPROM Commit (persists lastState after 2s idle)
  if (configSavePending && (millis() - configSaveRequestedAt >= 2000)) {
    configSavePending = false;
    saveConfig();
  }

  // 6. Network & OTA Services
  if (isConfigMode || fallbackApActive) {
    dnsServer.processNextRequest();
  }
  server.handleClient();

  if (!isConfigMode && WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected())
      reconnectMqtt();
    else
      mqttClient.loop();
    ArduinoOTA.handle();
    if (pendingOtaUrl.length() > 0 && !otaRunning)
      runOta();
  }
}
