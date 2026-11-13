/*
 * =========================================================================================
 * NARI Smart Dual-Switch & Universal IR Node — Production Firmware (v2.2.0)
 * Target Hardware: ESP32-C3 / ESP32-C3 SuperMini (4MB Flash, RISC-V 160MHz)
 * Native USB-CDC / Type-C Direct Flashing & Debugging
 *
 * FULLY SYNCHRONIZED WITH ANDROID KOTLIN APP & WEB APP ECOSYSTEM:
 * -----------------------------------------------------------------------------------------
 * 1. DUAL ACTIVE-LOW RELAYS (GPIO 5 & GPIO 6):
 *    - Independent control of Relay 1 and Relay 2.
 *    - Zero-blip hardware initialization (guaranteed no relay chatter on boot).
 *    - Hardware Countdown Timers & Inching (auto-off for geysers, pumps, ACs).
 *    - Power-loss memory ("LAST", "ON", "OFF") with 2s deferred flash wear protection.
 *
 * 2. DUAL TOUCH SWITCH / ROCKER INPUTS (GPIO 0 & GPIO 1):
 *    - Touch 1 (GPIO 0): Toggles Relay 1 locally (0ms latency), 10s hold resets Wi-Fi.
 *    - Touch 2 (GPIO 1): Toggles Relay 2 locally (0ms latency), 10s hold resets Wi-Fi.
 *    - Universal Switch Engine: Supports BOTH Capacitive Touch (TTP223) and standard
 *      Indian Latching Rocker switches (Anchor Roma, Havells, Legrand).
 *    - Child Lock (Wall Switch Lock): Disable physical switch toggling via app/web.
 *    - 5x Power Cycle / Rapid Tap Emergency Factory Reset (Tuya / Sonoff style).
 *
 * 3. IN-BUILT LED STATUS ENGINE (GPIO 8):
 *    - Built-in Blue LED on ESP32-C3 SuperMini (Active LOW).
 *    - Pairing Mode: Double-heartbeat cadence (2 rapid blinks + 1 slow pause).
 *    - Reconnecting to Router: Smooth breathing pulse (600ms ON / 600ms OFF).
 *    - Connected Success: Solid ON for 3.0 seconds.
 *    - Relay 1 Trigger: 1 crisp confirmation flash.
 *    - Relay 2 Trigger: 2 crisp confirmation flashes.
 *    - Factory Reset: 5 rapid flashes (80ms each).
 *    - Normal Idle: Solid ON if any relay is active, dark when both standby.
 *
 * 4. HIGH-POWER IR BLASTER OUTPUT (GPIO 4):
 *    - 940nm Infrared Transmitter LED driven via NPN transistor (BC547 / 2N2222).
 *    - Universal Home Appliance Control: TV, Air Conditioner, Soundbar, Set-top Box, Projector.
 *    - Multi-Protocol: NEC, Sony, Samsung, LG, RC5, RC6, Panasonic64, and Raw timings.
 *    - REST API: /ir/send?proto=...&code=...&bits=...
 *    - MQTT Topics: device/{id}/ir/cmd & nari/{id}/ir/send.
 *
 * 5. 38kHz IR RECEIVER PHOTO SENSOR (GPIO 3):
 *    - VS1838B 38kHz Photoreceiver with 1024-byte capture buffer and 50ms tolerance.
 *    - Real-Time Learning Mode: Record IR signals from physical remotes.
 *    - Real-Time Streaming: Broadcasts learned codes to Android App ("device/{id}/ir/learned")
 *      and Web App ("nari/{id}/ir/recv").
 *    - REST API: /ir/learn (starts 15s listen) and /ir/last (returns last recorded code).
 *
 * 6. PIEZO SPEAKER / BUZZER ACOUSTIC ENGINE (GPIO 7):
 *    - Passive / Active Piezo Buzzer or Mini Speaker on GPIO 7.
 *    - 100% Non-Blocking Acoustic Feedback:
 *      * Relay 1 Toggle: Crisp 2.4 kHz chirp (35ms).
 *      * Relay 2 Toggle: Double 2.8 kHz chirp (25ms x 2).
 *      * Pairing Mode: Ascending 3-note melody (C6 1046Hz -> E6 1318Hz -> G6 1568Hz).
 *      * Router Connected: 2-tone chime (G5 784Hz -> C6 1046Hz).
 *      * Factory Reset: Descending 4-tone alarm (1800Hz -> 1400Hz -> 1000Hz -> 600Hz).
 *      * IR Code Learned: High-pitch 3.2 kHz blip (45ms).
 *      * Timer Expiry: Triple urgent warning beeps (2000Hz).
 *      * Configurable Mute: Can be silenced via REST / MQTT if user prefers quiet mode.
 *
 * 7. ZERO-TOUCH BLE RSSI PRESENCE & 1D KALMAN FILTER AI:
 *    - Apple iBeacon (0x004C) & Android BLE Service scanner.
 *    - 2-Stage Hybrid AI Pipeline:
 *      * Stage 1: 5-sample running median outlier rejection filter.
 *      * Stage 2: 1D Kalman State Estimation filter (Process noise 0.15, Measurement noise 6.0).
 *    - Hands-Free Auto Walk-In ON & Walk-Out OFF based on proximity.
 *    - Multi-Family Member Occupancy Tracking (tracks up to 4 individual family members).
 *    - ESP-NOW Inter-Node Mesh Sync: Multiple switches in the same room share real-time
 *      RSSI consensus packets every 250ms so lights turn on the moment the user steps in.
 *    - Dynamic Calibration: Adjust trigger distance (-50 dBm to -95 dBm) via MQTT & REST.
 *
 * 8. COMPLETE TELEMETRY & AUTO-DISCOVERY:
 *    - Full JSON Telemetry for Android App & Web App: "id", "state", "relay1", "relay2",
 *      "timerRemSec", "autoOffSec", "lock", "ip", "rssi", "ble_rssi", "fw".
 *    - Immediate discovery broadcasts: device/{id}/ip, nari/{id}/ip, device/{id}/hb.
 *    - Home Assistant MQTT Auto-Discovery: homeassistant/switch/{id}_1/config.
 *    - HTTP OTA with live percentage reporting over MQTT (device/{id}/ota/progress).
 * =========================================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <PubSubClient.h>
#include <Preferences.h>
#include <ArduinoOTA.h>
#include <HTTPUpdate.h>
#include <WiFiClientSecure.h>
#include <IRremoteESP8266.h>
#include <IRsend.h>
#include <IRrecv.h>
#include <IRutils.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <BLEAdvertisedDevice.h>
#include <BLEScan.h>
#include <esp_now.h>
#include <esp_wifi.h>

#define FW_VERSION "2.2.0"

// =========================================================================================
// HARDWARE PIN DEFINITIONS (ESP32-C3 SuperMini)
// =========================================================================================
#define RELAY1_PIN      5  // Relay 1 Control Output (Active LOW)
#define RELAY2_PIN      6  // Relay 2 Control Output (Active LOW)
#define RELAY_ACTIVE    LOW
#define RELAY_INACTIVE  HIGH

#define TOUCH1_PIN      0  // Capacitive Touch 1 / Wall Switch 1 (GPIO 0)
#define TOUCH2_PIN      1  // Capacitive Touch 2 / Wall Switch 2 (GPIO 1)

#define PIN_IR_RECV     3  // VS1838B 38kHz IR Receiver Data Pin (GPIO 3)
#define PIN_IR_SEND     4  // 940nm IR Transmitter LED via NPN Transistor (GPIO 4)

#define PIN_BUZZER      7  // Piezo Speaker / Buzzer Audio Output (GPIO 7)
#define LED_PIN         8  // Built-in Blue Status LED (Active LOW on ESP32-C3 SuperMini)
#define MANUAL_BOOT_PIN 9  // Onboard BOOT Button / Auxiliary Manual Input

// =========================================================================================
// DEFAULT CLOUD FALLBACKS & BLE UUIDS
// =========================================================================================
const char *DEFAULT_MQTT_BROKER = "129.225.82.9"; // Active Oracle Cloud Broker
const int   DEFAULT_MQTT_PORT   = 1883;
const char *DEFAULT_MQTT_USER   = "nari_admin";
const char *DEFAULT_MQTT_PASS   = "narimqtt123";
const char *DEFAULT_AUTH_KEY    = "NARI_SEC_98a7df8a7sdf6a5sd4f";
const char *DEFAULT_WEBAPP_URL  = "https://nari-iot.github.io/NARI-switch/";
const char *DEFAULT_OTA_URL     = "https://firmware.narismarthome.com/latest.bin";
const char *TARGET_BEACON_UUID  = "a1b2c3d4-e5f6-7890-1234-56789abcdef0";

#define PROV_SERVICE_UUID       "0000ffff-0000-1000-8000-00805f9b34fb"
#define PROV_CHAR_WRITE_UUID    "0000ff01-0000-1000-8000-00805f9b34fb"

// =========================================================================================
// 1D KALMAN FILTER FOR HYBRID AI BLE PRESENCE
// =========================================================================================
class KalmanFilter1D {
private:
  float q; // Process noise covariance
  float r; // Measurement noise covariance
  float x; // State estimate (true RSSI)
  float p; // Estimation error covariance
  float k; // Kalman gain
public:
  KalmanFilter1D(float process_noise = 0.15f, float sensor_noise = 6.0f)
      : q(process_noise), r(sensor_noise), x(-120.0f), p(1.0f), k(0.0f) {}

  float update(float measurement) {
    if (x <= -119.0f) {
      x = measurement;
      p = 1.0f;
      return x;
    }
    p = p + q;
    k = p / (p + r);
    x = x + k * (measurement - x);
    p = (1.0f - k) * p;
    return x;
  }
  float getEstimate() const { return x; }
  void reset(float initial_val = -120.0f) {
    x = initial_val;
    p = 1.0f;
  }
};

#define MAX_FAMILY_MEMBERS 4
struct FamilyTrack {
  uint16_t userId;
  int rawRssi;
  int filteredRssi;
  KalmanFilter1D kalman;
  unsigned long lastSeen;
  int history[5];
  uint8_t hIdx;
};

// =========================================================================================
// NON-VOLATILE STORAGE CONFIGURATION (NVS Preferences)
// =========================================================================================
Preferences prefs;
struct Config {
  char ssid[33];
  char pass[65];
  char devId[25];        // Lowercase unique ID e.g. "a40a" or "sw_9f8a7b6c"
  char devName[33];
  char room[24];        // Room cluster e.g. "Living Room"
  uint8_t applianceType;// 0: Light, 1: Fan, 2: TV, 3: Soundbar, 4: AC, 5: General
  char authKey[33];
  char mqttUser[33];     // Per-device MQTT username (stored in NVS)
  char mqttPass[65];     // Per-device MQTT password (stored in NVS)
  uint16_t mqttPort;     // 1883 (TCP) or 8883 (TLS)
  char houseId[33];      // Isolated home cluster ID e.g. "house_9f8a..."
  char bootState[8];     // "LAST", "ON", "OFF"
  bool lastState1;
  bool lastState2;
  int userThresholdRssi; // BLE distance trigger threshold (default -70 dBm)
  bool pwrResetEnabled;  // 5x quick power toggle reset feature (default true)
  bool buzzerEnabled;    // Acoustic audio chirps enabled (default true)
  uint16_t autoOffSec1;  // Hardware Inching Relay 1 (0 = disabled)
  uint16_t autoOffSec2;  // Hardware Inching Relay 2 (0 = disabled)
  bool wallSwitchLock;   // Child Lock: disables physical switch toggles when true
} config;

// =========================================================================================
// GLOBAL INSTANCES & SYSTEM STATE
// =========================================================================================
WebServer server(80);
DNSServer dnsServer;
WiFiClient espClient;
WiFiClientSecure espSecureClient;
PubSubClient mqttClient(espClient);

bool isConfigMode = false;
bool relay1State = false;
bool relay2State = false;
unsigned long lastMqttRetry = 0;
unsigned long pendingConfigSave = 0;
unsigned long lastHeartbeatTime = 0;
uint16_t wifiFailedAttempts = 0;
bool emergencyPwrResetActive = false;
bool wasConnectedBefore = false;
unsigned long lastStaRetryTime = 0;

// Hardware Timers
bool hwTimer1Active = false;
unsigned long hwTimer1EndsAt = 0;
bool hwTimer1TargetState = false;

bool hwTimer2Active = false;
unsigned long hwTimer2EndsAt = 0;
bool hwTimer2TargetState = false;

// Touch Switch Engines
int touch1IdleLevel = HIGH;
int lastRawTouch1 = HIGH;
int debouncedTouch1 = HIGH;
unsigned long lastDebounceTime1 = 0;
unsigned long touch1StartTime = 0;
bool touch1Active = false;
bool resetTriggered1 = false;

int touch2IdleLevel = HIGH;
int lastRawTouch2 = HIGH;
int debouncedTouch2 = HIGH;
unsigned long lastDebounceTime2 = 0;
unsigned long touch2StartTime = 0;
bool touch2Active = false;
bool resetTriggered2 = false;

const unsigned long DEBOUNCE_DELAY = 40; // 40ms debounce filter

// IR Hardware Instances
const uint16_t kCaptureBufferSize = 1024;
const uint8_t  kTimeout = 50; // 50ms tolerance
IRrecv irrecv(PIN_IR_RECV, kCaptureBufferSize, kTimeout, true);
IRsend irsend(PIN_IR_SEND);
decode_results irResults;
bool isLearningIr = false;
unsigned long irLearnTimeoutMs = 0;
String lastLearnedIrCode = "";

// BLE & ESP-NOW Clustered Presence
BLEScan *pBLEScan = nullptr;
BLEServer *pProvServer = nullptr;
BLECharacteristic *pProvWriteChar = nullptr;
unsigned long winStartTime = 0;
unsigned long lossStartTime = 0;
const unsigned long DEBOUNCE_DELAY_MS = 2000;
const int HYSTERESIS_DELTA_DBM = 6;
FamilyTrack family[MAX_FAMILY_MEMBERS];

#define MAX_CLUSTER_PEERS 6
typedef struct __attribute__((packed)) {
  char magic[4];
  char room[20];
  char nodeId[8];
  uint8_t applianceType;
  int8_t bestRssi;
  uint8_t entryExitEvent;
  struct {
    uint16_t userId;
    int8_t rssi;
    uint8_t active;
  } familyRssi[MAX_FAMILY_MEMBERS];
  uint32_t timestamp;
} RoomClusterPacket;

struct ClusterPeer {
  char nodeId[8];
  uint8_t applianceType;
  int8_t bestRssi;
  uint8_t entryExitEvent;
  unsigned long lastSeen;
};

RoomClusterPacket myClusterPacket;
ClusterPeer clusterPeers[MAX_CLUSTER_PEERS];
uint8_t clusterPeerCount = 0;
int clusterBestRssi = -120;
unsigned long lastClusterSeenTime = 0;
int currentFilteredRssi = -120;

// LED & Buzzer State
unsigned long pairedSolidUntil = 0;
unsigned long blinkUntil = 0;
bool blinkActive = false;
unsigned long lastBlinkToggle = 0;
bool currentBlinkLedState = false;

// OTA Progress State
String pendingOtaUrl = "";
bool otaRunning = false;
unsigned int lastOtaPct = 101;

// Forward Declarations
void setRelay1(bool state, bool publishMqtt = true);
void setRelay2(bool state, bool publishMqtt = true);
void setLed(bool on);
void triggerLedBlinks(uint8_t count);
void playRelay1Chirp();
void playRelay2Chirp();
void playPairingChime();
void playConnectedChime();
void playFactoryResetChime();
void playTimerExpiryChirp();
void playIrLearnedBlip();
void buzzerInit();
void buzzerTone(uint32_t freq, uint32_t durationMs);
void buzzerStop();
void updateBuzzer();
void publishState();
void triggerFactoryReset();
void handleCaptivePortal();
void handleSave();
void startSetupAP();
void performHttpOta(const String &url);
void publishHaDiscovery();

// =========================================================================================
// PIEZO SPEAKER / BUZZER ACOUSTIC ENGINE (GPIO 7)
// =========================================================================================
unsigned long buzzerStopAt = 0;
uint8_t buzzerStep = 0;
unsigned long nextBuzzerStepAt = 0;

void buzzerInit() {
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
}

void buzzerTone(uint32_t freq, uint32_t durationMs) {
  if (!config.buzzerEnabled) return;
  tone(PIN_BUZZER, freq);
  buzzerStopAt = millis() + durationMs;
}

void buzzerStop() {
  noTone(PIN_BUZZER);
  digitalWrite(PIN_BUZZER, LOW);
  buzzerStopAt = 0;
}

void playRelay1Chirp() {
  if (!config.buzzerEnabled) return;
  buzzerTone(2400, 35);
}

void playRelay2Chirp() {
  if (!config.buzzerEnabled) return;
  buzzerTone(2800, 25);
  buzzerStep = 1;
  nextBuzzerStepAt = millis() + 55;
}

void playPairingChime() {
  if (!config.buzzerEnabled) return;
  buzzerTone(1046, 60); // C6
  buzzerStep = 10;
  nextBuzzerStepAt = millis() + 80;
}

void playConnectedChime() {
  if (!config.buzzerEnabled) return;
  buzzerTone(784, 80);  // G5
  buzzerStep = 20;
  nextBuzzerStepAt = millis() + 100;
}

void playFactoryResetChime() {
  if (!config.buzzerEnabled) return;
  buzzerTone(1800, 70);
  buzzerStep = 30;
  nextBuzzerStepAt = millis() + 90;
}

void playTimerExpiryChirp() {
  if (!config.buzzerEnabled) return;
  buzzerTone(2000, 100);
  buzzerStep = 40;
  nextBuzzerStepAt = millis() + 160;
}

void playIrLearnedBlip() {
  if (!config.buzzerEnabled) return;
  buzzerTone(3200, 45);
}

void updateBuzzer() {
  unsigned long now = millis();
  if (buzzerStopAt > 0 && now >= buzzerStopAt) {
    buzzerStop();
  }

  if (buzzerStep > 0 && now >= nextBuzzerStepAt) {
    switch (buzzerStep) {
      case 1:
        buzzerTone(2800, 25);
        buzzerStep = 0;
        break;
      case 10:
        buzzerTone(1318, 60);
        buzzerStep = 11;
        nextBuzzerStepAt = now + 80;
        break;
      case 11:
        buzzerTone(1568, 100);
        buzzerStep = 0;
        break;
      case 20:
        buzzerTone(1046, 120);
        buzzerStep = 0;
        break;
      case 30:
        buzzerTone(1400, 70);
        buzzerStep = 31;
        nextBuzzerStepAt = now + 90;
        break;
      case 31:
        buzzerTone(1000, 70);
        buzzerStep = 32;
        nextBuzzerStepAt = now + 90;
        break;
      case 32:
        buzzerTone(600, 120);
        buzzerStep = 0;
        break;
      case 40:
        buzzerTone(2000, 100);
        buzzerStep = 41;
        nextBuzzerStepAt = now + 160;
        break;
      case 41:
        buzzerTone(2000, 150);
        buzzerStep = 0;
        break;
      default:
        buzzerStep = 0;
        break;
    }
  }
}

// =========================================================================================
// IN-BUILT LED STATUS ENGINE (GPIO 8)
// =========================================================================================
void setLed(bool on) {
  // Built-in Blue LED on ESP32-C3 SuperMini is Active LOW
  digitalWrite(LED_PIN, on ? LOW : HIGH);
}

struct BlinkPattern {
  uint16_t durations[12];
  uint8_t count;
  uint8_t index;
  unsigned long nextChange;
  bool baselineState;
} activePattern;

void triggerLedBlinks(uint8_t count) {
  blinkActive = true;
  activePattern.count = count * 2;
  activePattern.index = 0;
  // Snappy, ultra-fast 35ms pulse (high-speed stroboscopic feedback)
  for (int i = 0; i < activePattern.count; i++) {
    activePattern.durations[i] = 35;
  }
  activePattern.nextChange = millis() + activePattern.durations[0];
  // Capture steady-state baseline: true if any relay is active, false if both standby
  activePattern.baselineState = (relay1State || relay2State);
  // First pulse inverts baseline so it is instantly noticeable regardless of current state
  setLed(!activePattern.baselineState);
}

void triggerFactoryReset() {
  Serial.println("[RESET] Factory reset triggered! Erasing NVS and rebooting...");
  playFactoryResetChime();
  for (int i = 0; i < 5; i++) {
    setLed(true);
    delay(80);
    setLed(false);
    delay(80);
  }
  prefs.begin("nari_cfg", false);
  prefs.clear();
  prefs.end();
  prefs.begin("nari_pwr", false);
  prefs.clear();
  prefs.end();
  delay(300);
  ESP.restart();
}

// =========================================================================================
// HARDWARE COUNTDOWN TIMER ENGINE (DUAL-CHANNEL)
// =========================================================================================
void startTimer1(unsigned long seconds, bool targetState) {
  if (seconds == 0) {
    hwTimer1Active = false;
    hwTimer1EndsAt = 0;
  } else {
    hwTimer1Active = true;
    hwTimer1EndsAt = millis() + (seconds * 1000UL);
    hwTimer1TargetState = targetState;
  }
}

void startTimer2(unsigned long seconds, bool targetState) {
  if (seconds == 0) {
    hwTimer2Active = false;
    hwTimer2EndsAt = 0;
  } else {
    hwTimer2Active = true;
    hwTimer2EndsAt = millis() + (seconds * 1000UL);
    hwTimer2TargetState = targetState;
  }
}

void updateHwTimers() {
  unsigned long now = millis();
  if (hwTimer1Active && (long)(now - hwTimer1EndsAt) >= 0) {
    hwTimer1Active = false;
    hwTimer1EndsAt = 0;
    setRelay1(hwTimer1TargetState, true);
    playTimerExpiryChirp();
  }
  if (hwTimer2Active && (long)(now - hwTimer2EndsAt) >= 0) {
    hwTimer2Active = false;
    hwTimer2EndsAt = 0;
    setRelay2(hwTimer2TargetState, true);
    playTimerExpiryChirp();
  }
}

// =========================================================================================
// RELAY CONTROL ENGINE (ZERO-BLIP ACTIVE-LOW)
// =========================================================================================
void setRelay1(bool state, bool publishMqtt) {
  bool changed = (relay1State != state);
  relay1State = state;
  digitalWrite(RELAY1_PIN, relay1State ? RELAY_ACTIVE : RELAY_INACTIVE);

  if (changed) {
    triggerLedBlinks(1);
    playRelay1Chirp();
  }

  // Hardware Inching
  if (relay1State && config.autoOffSec1 > 0) {
    startTimer1(config.autoOffSec1, false);
  } else if (!relay1State && hwTimer1Active && !hwTimer1TargetState) {
    hwTimer1Active = false;
    hwTimer1EndsAt = 0;
  }

  if (strcmp(config.bootState, "LAST") == 0 && config.lastState1 != relay1State) {
    config.lastState1 = relay1State;
    pendingConfigSave = millis() + 2000;
  }
  if (publishMqtt) publishState();
}

void setRelay2(bool state, bool publishMqtt) {
  bool changed = (relay2State != state);
  relay2State = state;
  digitalWrite(RELAY2_PIN, relay2State ? RELAY_ACTIVE : RELAY_INACTIVE);

  if (changed) {
    triggerLedBlinks(2);
    playRelay2Chirp();
  }

  // Hardware Inching
  if (relay2State && config.autoOffSec2 > 0) {
    startTimer2(config.autoOffSec2, false);
  } else if (!relay2State && hwTimer2Active && !hwTimer2TargetState) {
    hwTimer2Active = false;
    hwTimer2EndsAt = 0;
  }

  if (strcmp(config.bootState, "LAST") == 0 && config.lastState2 != relay2State) {
    config.lastState2 = relay2State;
    pendingConfigSave = millis() + 2000;
  }
  if (publishMqtt) publishState();
}

// =========================================================================================
// NVS STORAGE LOAD & SAVE
// =========================================================================================
void loadConfig() {
  prefs.begin("nari_cfg", false);
  String ssid = prefs.getString("ssid", "");
  String pass = prefs.getString("pass", "");
  String devId = prefs.getString("devId", "");
  String devName = prefs.getString("devName", "");
  String room = prefs.getString("room", "Living Room");
  uint8_t appType = prefs.getUChar("appType", 0);
  String authKey = prefs.getString("authKey", DEFAULT_AUTH_KEY);
  String mqttUser = prefs.getString("mqttUser", DEFAULT_MQTT_USER);
  String mqttPass = prefs.getString("mqttPass", DEFAULT_MQTT_PASS);
  uint16_t mqttPort = prefs.getUShort("mqttPort", DEFAULT_MQTT_PORT);
  String houseId = prefs.getString("houseId", "");
  String bootState = prefs.getString("bootState", "LAST");
  bool ls1 = prefs.getBool("lastState1", false);
  bool ls2 = prefs.getBool("lastState2", false);
  int rssiThresh = prefs.getInt("rssiThresh", -70);
  bool pwrReset = prefs.getBool("pwrReset", true);
  bool buzEn = prefs.getBool("buzEn", true);
  uint16_t ao1 = prefs.getUShort("ao1", 0);
  uint16_t ao2 = prefs.getUShort("ao2", 0);
  bool swLock = prefs.getBool("swLock", false);
  prefs.end();

  strncpy(config.ssid, ssid.c_str(), sizeof(config.ssid) - 1);
  strncpy(config.pass, pass.c_str(), sizeof(config.pass) - 1);

  if (devId.length() == 0) {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char autoId[16];
    sprintf(autoId, "%02x%02x%02x%02x", mac[2], mac[3], mac[4], mac[5]);
    strncpy(config.devId, autoId, sizeof(config.devId) - 1);
  } else {
    strncpy(config.devId, devId.c_str(), sizeof(config.devId) - 1);
  }

  if (devName.length() == 0) {
    String defName = "NARI Switch " + String(config.devId);
    strncpy(config.devName, defName.c_str(), sizeof(config.devName) - 1);
  } else {
    strncpy(config.devName, devName.c_str(), sizeof(config.devName) - 1);
  }

  strncpy(config.room, room.c_str(), sizeof(config.room) - 1);
  config.applianceType = appType;
  strncpy(config.authKey, authKey.c_str(), sizeof(config.authKey) - 1);
  strncpy(config.mqttUser, mqttUser.c_str(), sizeof(config.mqttUser) - 1);
  strncpy(config.mqttPass, mqttPass.c_str(), sizeof(config.mqttPass) - 1);
  config.mqttPort = mqttPort > 0 ? mqttPort : DEFAULT_MQTT_PORT;
  strncpy(config.houseId, houseId.c_str(), sizeof(config.houseId) - 1);
  strncpy(config.bootState, bootState.c_str(), sizeof(config.bootState) - 1);
  config.lastState1 = ls1;
  config.lastState2 = ls2;
  config.userThresholdRssi = rssiThresh;
  config.pwrResetEnabled = pwrReset;
  config.buzzerEnabled = buzEn;
  config.autoOffSec1 = ao1;
  config.autoOffSec2 = ao2;
  config.wallSwitchLock = swLock;
}

void saveConfig() {
  prefs.begin("nari_cfg", false);
  prefs.putString("ssid", config.ssid);
  prefs.putString("pass", config.pass);
  prefs.putString("devId", config.devId);
  prefs.putString("devName", config.devName);
  prefs.putString("room", config.room);
  prefs.putUChar("appType", config.applianceType);
  prefs.putString("authKey", config.authKey);
  prefs.putString("mqttUser", config.mqttUser);
  prefs.putString("mqttPass", config.mqttPass);
  prefs.putUShort("mqttPort", config.mqttPort);
  prefs.putString("houseId", config.houseId);
  prefs.putString("bootState", config.bootState);
  prefs.putBool("lastState1", config.lastState1);
  prefs.putBool("lastState2", config.lastState2);
  prefs.putInt("rssiThresh", config.userThresholdRssi);
  prefs.putBool("pwrReset", config.pwrResetEnabled);
  prefs.putBool("buzEn", config.buzzerEnabled);
  prefs.putUShort("ao1", config.autoOffSec1);
  prefs.putUShort("ao2", config.autoOffSec2);
  prefs.putBool("swLock", config.wallSwitchLock);
  prefs.end();
  Serial.println("[NVS] Configuration saved successfully.");
}

// =========================================================================================
// IR TRANSMITTER (BLASTER) & RECEIVER ENGINE
// =========================================================================================
void executeIrBlast(String commandStr) {
  Serial.printf("[IR BLAST] Command: %s\n", commandStr.c_str());
  int firstColon = commandStr.indexOf(':');
  int secondColon = commandStr.indexOf(':', firstColon + 1);

  if (firstColon == -1 || secondColon == -1) return;

  String protocol = commandStr.substring(0, firstColon);
  String hexCodeStr = commandStr.substring(firstColon + 1, secondColon);
  int bits = commandStr.substring(secondColon + 1).toInt();

  uint64_t code = strtoull(hexCodeStr.c_str(), NULL, 16);
  protocol.toUpperCase();

  if (protocol == "NEC")            irsend.sendNEC(code, bits);
  else if (protocol == "SONY")      irsend.sendSony(code, bits);
  else if (protocol == "RC5")       irsend.sendRC5(code, bits);
  else if (protocol == "RC6")       irsend.sendRC6(code, bits);
  else if (protocol == "SAMSUNG")   irsend.sendSAMSUNG(code, bits);
  else if (protocol == "LG")        irsend.sendLG(code, bits);
  else if (protocol == "PANASONIC") irsend.sendPanasonic64(code, bits);
  else                              irsend.sendNEC(code, 32);

  playRelay1Chirp();
}

// =========================================================================================
// HYBRID AI BLE PRESENCE & ESP-NOW CLUSTER ENGINE
// =========================================================================================
void initFamilyTracker() {
  for (int i = 0; i < MAX_FAMILY_MEMBERS; i++) {
    family[i].userId = 0;
    family[i].rawRssi = -120;
    family[i].filteredRssi = -120;
    family[i].lastSeen = 0;
    family[i].hIdx = 0;
    for (int j = 0; j < 5; j++) family[i].history[j] = -120;
  }
}

int computeHybridAiRssi(FamilyTrack &u, int newSample) {
  u.history[u.hIdx] = newSample;
  u.hIdx = (u.hIdx + 1) % 5;

  int sorted[5];
  for (int i = 0; i < 5; i++) sorted[i] = u.history[i];
  for (int i = 0; i < 4; i++) {
    for (int j = 0; j < 4 - i; j++) {
      if (sorted[j] > sorted[j + 1]) {
        int temp = sorted[j];
        sorted[j] = sorted[j + 1];
        sorted[j + 1] = temp;
      }
    }
  }
  int median = sorted[2];
  u.filteredRssi = (int)round(u.kalman.update((float)median));
  return u.filteredRssi;
}

void updateClusterPeer(const RoomClusterPacket &pkt) {
  unsigned long now = millis();
  int foundIdx = -1;
  for (int i = 0; i < clusterPeerCount; i++) {
    if (strcmp(clusterPeers[i].nodeId, pkt.nodeId) == 0) {
      foundIdx = i;
      break;
    }
  }

  if (foundIdx != -1) {
    clusterPeers[foundIdx].applianceType = pkt.applianceType;
    clusterPeers[foundIdx].bestRssi = pkt.bestRssi;
    clusterPeers[foundIdx].entryExitEvent = pkt.entryExitEvent;
    clusterPeers[foundIdx].lastSeen = now;
  } else if (clusterPeerCount < MAX_CLUSTER_PEERS) {
    strncpy(clusterPeers[clusterPeerCount].nodeId, pkt.nodeId, 7);
    clusterPeers[clusterPeerCount].nodeId[7] = '\0';
    clusterPeers[clusterPeerCount].applianceType = pkt.applianceType;
    clusterPeers[clusterPeerCount].bestRssi = pkt.bestRssi;
    clusterPeers[clusterPeerCount].entryExitEvent = pkt.entryExitEvent;
    clusterPeers[clusterPeerCount].lastSeen = now;
    clusterPeerCount++;
  }

  int best = -120;
  for (int i = 0; i < clusterPeerCount; i++) {
    if (now - clusterPeers[i].lastSeen < 5000) {
      if (clusterPeers[i].bestRssi > best) best = clusterPeers[i].bestRssi;
    }
  }
  clusterBestRssi = best;
  lastClusterSeenTime = now;
}

#if defined(ESP_ARDUINO_VERSION) && ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
void onEspNowDataRecv(const esp_now_recv_info_t *info, const uint8_t *incomingData, int len) {
#else
void onEspNowDataRecv(const uint8_t *mac, const uint8_t *incomingData, int len) {
#endif
  if (len == sizeof(RoomClusterPacket)) {
    RoomClusterPacket incoming;
    memcpy(&incoming, incomingData, sizeof(RoomClusterPacket));

    if (memcmp(incoming.magic, "NARI", 4) != 0) return;

    if (strlen(config.room) > 0 && strlen(incoming.room) > 0 &&
        strcasecmp(incoming.room, config.room) != 0) {
      return;
    }

    if (strcmp(incoming.nodeId, config.devId) != 0) {
      updateClusterPeer(incoming);
      if (incoming.entryExitEvent == 1 && !relay1State) {
        Serial.printf("[CLUSTER] Peer '%s' detected ENTRY -> Relay 1 ON\n", incoming.nodeId);
        setRelay1(true);
      }
    }
  }
}

class BeaconAdvertisedDeviceCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice advertisedDevice) {
    bool match = false;
    uint16_t detectedUserId = 1;

    if (advertisedDevice.haveServiceUUID()) {
      if (advertisedDevice.getServiceUUID().toString().indexOf(TARGET_BEACON_UUID) != -1) {
        match = true;
      }
    }

    if (!match && advertisedDevice.haveManufacturerData()) {
      String mData = advertisedDevice.getManufacturerData();
      if (mData.length() >= 23) {
        const uint8_t *p = (const uint8_t *)mData.c_str();
        size_t offset = 0;
        if (mData.length() >= 25 && p[0] == 0x4C && p[1] == 0x00) offset = 2;
        if (p[offset] == 0x02 && p[offset + 1] == 0x15) {
          char uuidStr[37];
          const uint8_t *u = &p[offset + 2];
          snprintf(uuidStr, sizeof(uuidStr),
                   "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
                   u[0], u[1], u[2], u[3], u[4], u[5], u[6], u[7], u[8], u[9],
                   u[10], u[11], u[12], u[13], u[14], u[15]);
          if (strcasecmp(uuidStr, TARGET_BEACON_UUID) == 0) {
            match = true;
            detectedUserId = (p[offset + 20] << 8) | p[offset + 21];
            if (detectedUserId == 0) detectedUserId = 1;
          }
        }
      }
    }

    if (match) {
      int rawRssi = advertisedDevice.getRSSI();
      int slot = -1;
      for (int i = 0; i < MAX_FAMILY_MEMBERS; i++) {
        if (family[i].userId == detectedUserId) {
          slot = i;
          break;
        }
      }
      if (slot == -1) {
        for (int i = 0; i < MAX_FAMILY_MEMBERS; i++) {
          if (family[i].userId == 0 || millis() - family[i].lastSeen > 30000) {
            slot = i;
            family[slot].userId = detectedUserId;
            family[slot].kalman.reset((float)rawRssi);
            break;
          }
        }
      }
      if (slot != -1) {
        family[slot].rawRssi = rawRssi;
        computeHybridAiRssi(family[slot], rawRssi);
        family[slot].lastSeen = millis();
      }
    }
  }
};

// =========================================================================================
// OVER-THE-AIR (OTA) UPDATE ENGINE
// =========================================================================================
void publishOta(const String &msg) {
  if (!mqttClient.connected()) return;
  String topicDevice = "device/" + String(config.devId) + "/ota/progress";
  mqttClient.publish(topicDevice.c_str(), msg.c_str(), false);

  String topicNari = "nari/" + String(config.devId) + "/ota/progress";
  mqttClient.publish(topicNari.c_str(), msg.c_str(), false);
  mqttClient.loop();
}

void performHttpOta(const String &url) {
  if (otaRunning || url.length() < 7) return;
  otaRunning = true;
  lastOtaPct = 101;
  Serial.printf("[OTA] Starting HTTP update from: %s\n", url.c_str());

  publishOta("OTA_STARTING");
  mqttClient.publish(("device/" + String(config.devId) + "/state").c_str(), "OTA_STARTING", false);

  httpUpdate.rebootOnUpdate(false);
  httpUpdate.onProgress([](size_t cur, size_t total) {
    if (total <= 0) return;
    unsigned int pct = (unsigned int)((cur * 100L) / total);
    if (pct / 5 != lastOtaPct / 5) {
      lastOtaPct = pct;
      publishOta(String("progress:") + pct);
    }
  });

  t_httpUpdate_return ret;
  if (url.startsWith("https://")) {
    WiFiClientSecure otaSecureClient;
    otaSecureClient.setInsecure(); // Encrypts OTA transport over TLS; pin root CA via setCACert() if desired
    ret = httpUpdate.update(otaSecureClient, url);
  } else {
    WiFiClient otaClient;
    ret = httpUpdate.update(otaClient, url);
  }

  switch (ret) {
    case HTTP_UPDATE_OK:
      publishOta("OTA_SUCCESS");
      mqttClient.publish(("device/" + String(config.devId) + "/state").c_str(), "OTA_SUCCESS", false);
      delay(500);
      ESP.restart();
      break;
    case HTTP_UPDATE_NO_UPDATES:
      publishOta("OTA_FAILED:No update available");
      break;
    default: {
      String err = httpUpdate.getLastErrorString();
      publishOta("OTA_FAILED:" + err);
      mqttClient.publish(("device/" + String(config.devId) + "/state").c_str(), "OTA_FAILED", false);
      break;
    }
  }
  otaRunning = false;
}

// =========================================================================================
// HOME ASSISTANT MQTT AUTO-DISCOVERY
// =========================================================================================
void publishHaDiscovery() {
  if (!mqttClient.connected()) return;
  String id = String(config.devId);

  // Relay 1 Discovery
  String dTopic1 = "homeassistant/switch/" + id + "_1/config";
  String payload1 = String("{\"name\":\"") + String(config.devName) + " 1\"" +
                    ",\"uniq_id\":\"" + id + "_1\"" +
                    ",\"cmd_t\":\"device/" + id + "/cmd\"" +
                    ",\"stat_t\":\"device/" + id + "/state\"" +
                    ",\"val_tpl\":\"{{ value_json.relay1 }}\"" +
                    ",\"pl_on\":\"r1:1\",\"pl_off\":\"r1:0\"" +
                    ",\"stat_on\":1,\"stat_off\":0" +
                    ",\"avty_t\":\"device/" + id + "/status\"" +
                    ",\"dev\":{\"ids\":[\"" + id + "\"],\"name\":\"" + String(config.devName) +
                    "\",\"mdl\":\"ESP32-C3 SuperMini Dual\",\"mf\":\"NARI Smart Home\",\"sw\":\"" + FW_VERSION + "\"}}";
  mqttClient.publish(dTopic1.c_str(), payload1.c_str(), true);

  // Relay 2 Discovery
  String dTopic2 = "homeassistant/switch/" + id + "_2/config";
  String payload2 = String("{\"name\":\"") + String(config.devName) + " 2\"" +
                    ",\"uniq_id\":\"" + id + "_2\"" +
                    ",\"cmd_t\":\"device/" + id + "/cmd\"" +
                    ",\"stat_t\":\"device/" + id + "/state\"" +
                    ",\"val_tpl\":\"{{ value_json.relay2 }}\"" +
                    ",\"pl_on\":\"r2:1\",\"pl_off\":\"r2:0\"" +
                    ",\"stat_on\":1,\"stat_off\":0" +
                    ",\"avty_t\":\"device/" + id + "/status\"" +
                    ",\"dev\":{\"ids\":[\"" + id + "\"]}}";
  mqttClient.publish(dTopic2.c_str(), payload2.c_str(), true);
}

// =========================================================================================
// MQTT PROTOCOL ENGINE (DUAL ANDROID & WEB APP COMPATIBILITY)
// =========================================================================================
void publishState() {
  if (!mqttClient.connected()) return;

  long rem1 = hwTimer1Active ? max(0L, (long)((hwTimer1EndsAt - millis()) / 1000UL)) : 0L;
  long rem2 = hwTimer2Active ? max(0L, (long)((hwTimer2EndsAt - millis()) / 1000UL)) : 0L;

  // Fully formatted JSON satisfying both Android App & Web App schema
  String json = "{\"id\":\"" + String(config.devId) +
                "\",\"name\":\"" + String(config.devName) +
                "\",\"room\":\"" + String(config.room) +
                "\",\"state\":" + String(relay1State ? "1" : "0") +
                ",\"relay1\":" + (relay1State ? "1" : "0") +
                ",\"relay2\":" + (relay2State ? "1" : "0") +
                ",\"timerRemSec\":" + String(rem1) +
                ",\"timer1\":" + String(rem1) +
                ",\"timer2\":" + String(rem2) +
                ",\"autoOffSec\":" + String(config.autoOffSec1) +
                ",\"lock\":" + (config.wallSwitchLock ? "1" : "0") +
                ",\"ip\":\"" + WiFi.localIP().toString() + "\"" +
                ",\"rssi\":" + String(WiFi.RSSI()) +
                ",\"ble_rssi\":" + String(currentFilteredRssi) +
                ",\"rssi_thresh\":" + String(config.userThresholdRssi) +
                ",\"buzzer\":" + (config.buzzerEnabled ? "1" : "0") +
                ",\"fw\":\"" + FW_VERSION + "\"}";

  // 1. Android App Pipeline
  String topicDevice = "device/" + String(config.devId) + "/state";
  mqttClient.publish(topicDevice.c_str(), json.c_str(), true);

  // 2. Web App Pipeline
  String topicNari = "nari/" + String(config.devId) + "/state";
  mqttClient.publish(topicNari.c_str(), json.c_str(), true);

  // Dedicated secondary web topic for Relay 2
  String topicNari2 = "nari/" + String(config.devId) + "/state2";
  mqttClient.publish(topicNari2.c_str(), relay2State ? "ON" : "OFF", true);

  // Dedicated auxiliary telemetry topics
  mqttClient.publish(("device/" + String(config.devId) + "/ip").c_str(), WiFi.localIP().toString().c_str(), true);
  mqttClient.publish(("nari/" + String(config.devId) + "/ip").c_str(), WiFi.localIP().toString().c_str(), true);
  mqttClient.publish(("device/" + String(config.devId) + "/hb").c_str(), "1", false);
  mqttClient.publish(("device/" + String(config.devId) + "/signal").c_str(), String(WiFi.RSSI()).c_str(), false);

  // Multi-tenant isolated home topic if houseId is set
  if (strlen(config.houseId) > 0) {
    String tenantTopic = "nari/" + String(config.houseId) + "/device/" + String(config.devId) + "/state";
    mqttClient.publish(tenantTopic.c_str(), json.c_str(), true);
  }
}

void onMqttMessage(char *topic, byte *payload, unsigned int length) {
  char message[length + 1];
  memcpy(message, payload, length);
  message[length] = '\0';
  String topicStr = String(topic);
  String msgStr = String(message);
  msgStr.trim();

  // 0. Query / Status Trigger
  if (msgStr.equalsIgnoreCase("STATUS") || msgStr.equalsIgnoreCase("QUERY")) {
    publishState();
    return;
  }

  // 1. Emergency Remote Reset
  if (msgStr.equalsIgnoreCase("RESET")) {
    triggerFactoryReset();
    return;
  }

  // 2. Over-The-Air (OTA) Trigger
  if (topicStr.endsWith("/ota") || msgStr.startsWith("OTA:")) {
    String url = msgStr.startsWith("OTA:") ? msgStr.substring(4) : msgStr;
    url.trim();
    performHttpOta(url);
    return;
  }

  // 3. IR Control Commands
  if (topicStr.endsWith("/ir/cmd") || topicStr.endsWith("/ir/send")) {
    if (msgStr == "learn") {
      isLearningIr = true;
      irLearnTimeoutMs = millis() + 15000;
      irrecv.enableIRIn();
      playPairingChime();
    } else if (msgStr.startsWith("send:")) {
      executeIrBlast(msgStr.substring(5));
    } else if (msgStr.indexOf(':') != -1) {
      executeIrBlast(msgStr);
    }
    return;
  }

  // 4. Acoustic Buzzer Commands
  if (topicStr.endsWith("/buzzer")) {
    if (msgStr == "chirp1") playRelay1Chirp();
    else if (msgStr == "chirp2") playRelay2Chirp();
    else if (msgStr == "pair") playPairingChime();
    else if (msgStr == "alert") playTimerExpiryChirp();
    else if (msgStr == "reset") playFactoryResetChime();
    else if (msgStr == "mute" || msgStr == "off") {
      config.buzzerEnabled = false;
      pendingConfigSave = millis() + 2000;
    } else if (msgStr == "unmute" || msgStr == "on") {
      config.buzzerEnabled = true;
      pendingConfigSave = millis() + 2000;
      playRelay1Chirp();
    } else if (msgStr.startsWith("tone:")) {
      int first = msgStr.indexOf(':');
      int second = msgStr.indexOf(':', first + 1);
      if (first != -1 && second != -1) {
        uint32_t f = msgStr.substring(first + 1, second).toInt();
        uint32_t d = msgStr.substring(second + 1).toInt();
        buzzerTone(f, d);
      }
    }
    return;
  }

  // 5. Hardware Countdown Timer Commands
  if (topicStr.endsWith("/timer") || msgStr.startsWith("TIMER:")) {
    String tCmd = msgStr.startsWith("TIMER:") ? msgStr.substring(6) : msgStr;
    tCmd.trim();
    int colon = tCmd.indexOf(':');
    if (colon != -1) {
      unsigned long sec = tCmd.substring(0, colon).toInt();
      bool targetSt = (tCmd.substring(colon + 1).toInt() == 1);
      startTimer1(sec, targetSt);
    } else {
      unsigned long sec = tCmd.toInt();
      startTimer1(sec, false);
    }
    publishState();
    return;
  }

  // 6. Child Lock (Wall Switch Lock) Configuration
  if (topicStr.endsWith("/config/lock") || msgStr.startsWith("LOCK:")) {
    String lockStr = msgStr.startsWith("LOCK:") ? msgStr.substring(5) : msgStr;
    lockStr.trim();
    config.wallSwitchLock = (lockStr == "1" || lockStr.equalsIgnoreCase("true"));
    pendingConfigSave = millis() + 2000;
    Serial.printf("[CONFIG] Wall switch child lock set to: %s\n", config.wallSwitchLock ? "LOCKED" : "UNLOCKED");
    publishState();
    return;
  }

  // 7. Power-On Boot State Configuration
  if (topicStr.endsWith("/config/boot") || msgStr.startsWith("POWERON:")) {
    String bMode = msgStr.startsWith("POWERON:") ? msgStr.substring(8) : msgStr;
    bMode.trim();
    bMode.toUpperCase();
    strncpy(config.bootState, bMode.c_str(), sizeof(config.bootState) - 1);
    pendingConfigSave = millis() + 2000;
    Serial.printf("[CONFIG] Power-on boot state set to: %s\n", config.bootState);
    publishState();
    return;
  }

  // 8. Hardware Inching (Auto-Off) Configuration
  if (topicStr.endsWith("/config/inching") || msgStr.startsWith("INCHING:")) {
    String iStr = msgStr.startsWith("INCHING:") ? msgStr.substring(8) : msgStr;
    iStr.trim();
    if (iStr.startsWith("ON:")) iStr = iStr.substring(3);
    uint16_t sec = (uint16_t)iStr.toInt();
    config.autoOffSec1 = sec;
    config.autoOffSec2 = sec;
    pendingConfigSave = millis() + 2000;
    Serial.printf("[CONFIG] Hardware Inching set to: %d sec\n", config.autoOffSec1);
    publishState();
    return;
  }

  // 9. BLE Range & Cluster Configuration
  if (topicStr.endsWith("/config/rssi")) {
    config.userThresholdRssi = msgStr.toInt();
    pendingConfigSave = millis() + 2000;
    Serial.printf("[CONFIG] New BLE trigger threshold: %d dBm\n", config.userThresholdRssi);
    return;
  }
  if (topicStr.endsWith("/config/room")) {
    strncpy(config.room, msgStr.c_str(), sizeof(config.room) - 1);
    config.room[sizeof(config.room) - 1] = '\0';
    pendingConfigSave = millis() + 2000;
    return;
  }
  if (topicStr.endsWith("/config/appliance")) {
    config.applianceType = (uint8_t)msgStr.toInt();
    pendingConfigSave = millis() + 2000;
    return;
  }

  // 10. Relay 1 & Relay 2 Switching Commands
  if (topicStr.endsWith("/set2")) {
    if (msgStr == "1" || msgStr.equalsIgnoreCase("ON")) setRelay2(true);
    else if (msgStr == "0" || msgStr.equalsIgnoreCase("OFF")) setRelay2(false);
    else if (msgStr.equalsIgnoreCase("TOGGLE")) setRelay2(!relay2State);
    return;
  }

  if (msgStr == "1" || msgStr.equalsIgnoreCase("ON") || msgStr == "r1:1") {
    setRelay1(true);
  } else if (msgStr == "0" || msgStr.equalsIgnoreCase("OFF") || msgStr == "r1:0") {
    setRelay1(false);
  } else if (msgStr.equalsIgnoreCase("TOGGLE") || msgStr == "r1:toggle") {
    setRelay1(!relay1State);
  } else if (msgStr == "r2:1" || msgStr.equalsIgnoreCase("R2_ON")) {
    setRelay2(true);
  } else if (msgStr == "r2:0" || msgStr.equalsIgnoreCase("R2_OFF")) {
    setRelay2(false);
  } else if (msgStr == "r2:toggle" || msgStr.equalsIgnoreCase("R2_TOGGLE")) {
    setRelay2(!relay2State);
  } else if (msgStr.equalsIgnoreCase("ALL_ON")) {
    setRelay1(true);
    setRelay2(true);
  } else if (msgStr.equalsIgnoreCase("ALL_OFF")) {
    setRelay1(false);
    setRelay2(false);
  }
}

void reconnectMqtt() {
  if (WiFi.status() != WL_CONNECTED || isConfigMode) return;
  if (millis() - lastMqttRetry < 6000) return;
  lastMqttRetry = millis();

  const bool useTls = (config.mqttPort == 8883);
  if (useTls) {
    espSecureClient.setInsecure();
    espSecureClient.setTimeout(400);
    mqttClient.setClient(espSecureClient);
  } else {
    espClient.setTimeout(400);
    mqttClient.setClient(espClient);
  }
  mqttClient.setServer(DEFAULT_MQTT_BROKER, config.mqttPort);
  mqttClient.setCallback(onMqttMessage);

  String clientId = "NariC3_" + String(config.devId);
  String willTopicDevice = "device/" + String(config.devId) + "/status";
  const char *mqttUser = strlen(config.mqttUser) > 0 ? config.mqttUser : DEFAULT_MQTT_USER;
  const char *mqttPass = strlen(config.mqttPass) > 0 ? config.mqttPass : DEFAULT_MQTT_PASS;

  if (mqttClient.connect(clientId.c_str(), mqttUser, mqttPass,
                         willTopicDevice.c_str(), 0, true, "offline")) {
    Serial.println("[MQTT] Connected to Oracle Cloud broker!");

    // Retained LWT Online Signals
    mqttClient.publish(willTopicDevice.c_str(), "online", true);
    mqttClient.publish(("nari/" + String(config.devId) + "/status").c_str(), "online", true);

    // Multi-tenant subscriptions
    if (strlen(config.houseId) > 0) {
      String housePrefix = "nari/" + String(config.houseId) + "/";
      mqttClient.subscribe((housePrefix + "device/" + String(config.devId) + "/cmd").c_str());
      mqttClient.subscribe((housePrefix + "device/" + String(config.devId) + "/set").c_str());
      mqttClient.subscribe((housePrefix + "device/all/cmd").c_str());
      mqttClient.subscribe((housePrefix + "device/all/set").c_str());
      mqttClient.subscribe((housePrefix + "device/" + String(config.devId) + "/ir/cmd").c_str());
    }

    // Android App subscriptions
    String baseDevice = "device/" + String(config.devId);
    mqttClient.subscribe((baseDevice + "/cmd").c_str());
    mqttClient.subscribe((baseDevice + "/set").c_str());
    mqttClient.subscribe((baseDevice + "/set2").c_str());
    mqttClient.subscribe("device/all/cmd");
    mqttClient.subscribe((baseDevice + "/ir/cmd").c_str());
    mqttClient.subscribe((baseDevice + "/buzzer").c_str());
    mqttClient.subscribe((baseDevice + "/timer").c_str());
    mqttClient.subscribe((baseDevice + "/config/rssi").c_str());
    mqttClient.subscribe((baseDevice + "/config/room").c_str());
    mqttClient.subscribe((baseDevice + "/config/appliance").c_str());
    mqttClient.subscribe((baseDevice + "/config/boot").c_str());
    mqttClient.subscribe((baseDevice + "/config/inching").c_str());
    mqttClient.subscribe((baseDevice + "/config/lock").c_str());

    // Web App subscriptions
    String baseNari = "nari/" + String(config.devId);
    mqttClient.subscribe((baseNari + "/set").c_str());
    mqttClient.subscribe((baseNari + "/set2").c_str());
    mqttClient.subscribe((baseNari + "/timer").c_str());
    mqttClient.subscribe((baseNari + "/ir/send").c_str());
    mqttClient.subscribe((baseNari + "/ir/cmd").c_str());
    mqttClient.subscribe((baseNari + "/buzzer").c_str());
    mqttClient.subscribe((baseNari + "/ota").c_str());
    mqttClient.subscribe((baseNari + "/config/boot").c_str());
    mqttClient.subscribe((baseNari + "/config/inching").c_str());
    mqttClient.subscribe((baseNari + "/config/lock").c_str());

    publishHaDiscovery();
    publishState();
  }
}

// =========================================================================================
// CAPTIVE PORTAL (RFC 302 AUTO-POPUP ON 192.168.4.1)
// =========================================================================================
void redirectToPortal() {
  server.sendHeader("Location", "http://192.168.4.1/", true);
  server.send(302, "text/plain", "");
}

void handlePortalNotFound() {
  String host = server.hostHeader();
  if (host != "192.168.4.1" && host != "192.168.4.1:80") {
    redirectToPortal();
    return;
  }
  handleCaptivePortal();
}

void handleCaptivePortal() {
  server.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  server.sendHeader("Pragma", "no-cache");
  server.sendHeader("Expires", "-1");

  String s = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
             "<title>NARI Smart Switch Setup</title><style>"
             "body{font-family:system-ui,-apple-system,sans-serif;background:radial-gradient(ellipse at 50% -10%,#154c33 0%,#091d14 45%,#050e0a 100%);color:#f1f5f9;margin:0;padding:24px 14px;min-height:100vh;display:flex;align-items:center;justify-content:center;box-sizing:border-box;}"
             ".card{width:100%;max-width:390px;background:rgba(12,28,20,0.85);backdrop-filter:blur(20px);border:1px solid rgba(52,211,153,0.25);border-radius:26px;padding:26px 20px;box-shadow:0 24px 60px -12px rgba(0,0,0,0.7);text-align:center;box-sizing:border-box;}"
             ".title{font-size:1.45rem;font-weight:800;color:#fff;margin-bottom:6px;}.title span{color:#34d399;font-weight:600;}"
             ".pill{display:inline-flex;align-items:center;gap:6px;background:rgba(16,185,129,0.14);border:1px solid rgba(52,211,153,0.3);padding:4px 12px;border-radius:20px;font-size:0.7rem;font-weight:700;color:#6ee7b7;margin-bottom:18px;}"
             ".pulse{width:6px;height:6px;background:#34d399;border-radius:50%;box-shadow:0 0 8px #34d399;}"
             ".form-group{margin-bottom:14px;text-align:left;}label{display:block;font-size:0.74rem;font-weight:700;color:#cbd5e1;margin-bottom:6px;}"
             "select,input[type='text'],input[type='password']{width:100%;box-sizing:border-box;padding:12px;background:#06140d;color:#fff;border:1px solid #1e4532;border-radius:12px;font-size:0.9rem;outline:none;}"
             "select:focus,input:focus{border-color:#34d399;box-shadow:0 0 0 3px rgba(16,185,129,0.2);}"
             ".btn{width:100%;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;padding:14px;border-radius:14px;font-size:0.95rem;font-weight:700;cursor:pointer;margin-top:10px;}"
             ".features{margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.08);font-size:0.75rem;color:#94a3b8;line-height:1.6;text-align:left;}"
             "</style></head><body><div class='card'>"
             "<div class='title'>NARI <span>DUAL-SWITCH</span></div>"
             "<div class='pill'><div class='pulse'></div>ESP32-C3 SUPERMINI (v2.2.0)</div>"
             "<form action='/save' method='POST'>"
             "<div class='form-group'><label>SELECT WI-FI NETWORK</label><select name='ssid' id='s'>";

  int n = WiFi.scanComplete();
  if (n <= 0) n = WiFi.scanNetworks();
  for (int i = 0; i < n; i++) {
    s += "<option value='" + WiFi.SSID(i) + "'>" + WiFi.SSID(i) + " (" + String(WiFi.RSSI(i)) + " dBm)</option>";
  }
  s += "</select></div>"
       "<div class='form-group'><label>WI-FI PASSWORD</label><input type='password' name='pass' placeholder='Enter Wi-Fi password'></div>"
       "<div class='form-group'><label>ROOM / CLUSTER</label><input type='text' name='room' value='" + String(config.room) + "'></div>"
       "<div class='form-group'><label>DEVICE NAME</label><input type='text' name='name' value='" + String(config.devName) + "'></div>"
       "<details style='margin-bottom:14px;font-size:12px;color:#94a3b8;'>"
       "<summary style='cursor:pointer;font-weight:700;color:#38bdf8;'>Advanced Security (Optional)</summary>"
       "<div class='form-group' style='margin-top:10px;'><label>LAN AUTH KEY</label><input type='text' name='authKey' placeholder='Leave blank to keep current'></div>"
       "<div class='form-group'><label>MQTT USERNAME</label><input type='text' name='mqttUser' placeholder='Leave blank for default'></div>"
       "<div class='form-group'><label>MQTT PASSWORD</label><input type='password' name='mqttPass' placeholder='Leave blank for default'></div>"
       "<div class='form-group'><label>MQTT PORT (1883 or 8883 TLS)</label><input type='text' name='mqttPort' value='" + String(config.mqttPort) + "'></div>"
       "</details>"
       "<button type='submit' class='btn'>Connect & Save Settings</button></form>"
       "<div class='features'>"
       "&#10004; Dual Active-LOW Relays (GPIO 5 & 6)<br>"
       "&#10004; Dual Touch / Rocker Switches (GPIO 0 & 1)<br>"
       "&#10004; 940nm IR Blaster (GPIO 4) & 38kHz Receiver (GPIO 3)<br>"
       "&#10004; Acoustic Piezo Buzzer (GPIO 7) & Status LED (GPIO 8)<br>"
       "&#10004; BLE RSSI Kalman Filter & ESP-NOW Mesh Consensus<br>"
       "&#10004; Native BLE Pairing + Zero-Latency LAN REST"
       "</div></div></body></html>";

  server.send(200, "text/html", s);
}

void handleSave() {
  if (server.hasArg("ssid")) strncpy(config.ssid, server.arg("ssid").c_str(), sizeof(config.ssid) - 1);
  if (server.hasArg("pass")) strncpy(config.pass, server.arg("pass").c_str(), sizeof(config.pass) - 1);
  if (server.hasArg("name") && server.arg("name").length() > 0)
    strncpy(config.devName, server.arg("name").c_str(), sizeof(config.devName) - 1);
  if (server.hasArg("room") && server.arg("room").length() > 0)
    strncpy(config.room, server.arg("room").c_str(), sizeof(config.room) - 1);
  if (server.hasArg("authKey") && server.arg("authKey").length() > 0) {
    memset(config.authKey, 0, sizeof(config.authKey));
    strncpy(config.authKey, server.arg("authKey").c_str(), sizeof(config.authKey) - 1);
  }
  if (server.hasArg("mqttUser") && server.arg("mqttUser").length() > 0) {
    memset(config.mqttUser, 0, sizeof(config.mqttUser));
    strncpy(config.mqttUser, server.arg("mqttUser").c_str(), sizeof(config.mqttUser) - 1);
  }
  if (server.hasArg("mqttPass") && server.arg("mqttPass").length() > 0) {
    memset(config.mqttPass, 0, sizeof(config.mqttPass));
    strncpy(config.mqttPass, server.arg("mqttPass").c_str(), sizeof(config.mqttPass) - 1);
  }
  if (server.hasArg("mqttPort") && server.arg("mqttPort").toInt() > 0) {
    config.mqttPort = (uint16_t)server.arg("mqttPort").toInt();
  }

  saveConfig();
  playConnectedChime();

  String html = "<!DOCTYPE html><html><body style='background:#050e0a;color:#34d399;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;'>"
                "<div style='text-align:center;'><h2>Settings Saved!</h2><p style='color:#cbd5e1;'>Reconnecting to home network... You may return to the app.</p></div></body></html>";
  server.send(200, "text/html", html);
  delay(1000);
  ESP.restart();
}

// =========================================================================================
// BLE SMART PROVISIONING (ANDROID NATIVE PAIRING)
// =========================================================================================
class ProvWriteCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) override {
    String rx = String(pChar->getValue().c_str());
    Serial.printf("[BLE PROV] Payload: %s\n", rx.c_str());
    int pipe1 = rx.indexOf('|');
    int pipe2 = rx.indexOf('|', pipe1 + 1);
    if (pipe1 != -1) {
      String newSsid = rx.substring(0, pipe1);
      String newPass = (pipe2 != -1) ? rx.substring(pipe1 + 1, pipe2) : rx.substring(pipe1 + 1);
      strncpy(config.ssid, newSsid.c_str(), sizeof(config.ssid) - 1);
      strncpy(config.pass, newPass.c_str(), sizeof(config.pass) - 1);
      saveConfig();
      playConnectedChime();
      delay(500);
      ESP.restart();
    }
  }
};

void startSetupAP() {
  isConfigMode = true;
  playPairingChime();

  WiFi.mode(WIFI_AP_STA);
  IPAddress apIP(192, 168, 4, 1);
  IPAddress netMsk(255, 255, 255, 0);
  WiFi.softAPConfig(apIP, apIP, netMsk);

  String apName = "NARI-" + String(config.devId);
  apName.toUpperCase();
  WiFi.softAP(apName.c_str());
  WiFi.scanNetworks(true);

  dnsServer.setErrorReplyCode(DNSReplyCode::NoError);
  dnsServer.start(53, "*", apIP);

  server.on("/", handleCaptivePortal);
  server.on("/save", HTTP_POST, handleSave);
  server.on("/generate_204", redirectToPortal);
  server.on("/gen_204", redirectToPortal);
  server.on("/mobile/status.php", redirectToPortal);
  server.on("/check_network_status.txt", redirectToPortal);
  server.on("/hotspot-detect.html", redirectToPortal);
  server.onNotFound(handlePortalNotFound);
  server.begin();

  // BLE Smart Discovery Service
  BLEDevice::init(apName.c_str());
  pProvServer = BLEDevice::createServer();
  BLEService *pProvService = pProvServer->createService(PROV_SERVICE_UUID);
  pProvWriteChar = pProvService->createCharacteristic(
      PROV_CHAR_WRITE_UUID,
      BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  pProvWriteChar->setCallbacks(new ProvWriteCallbacks());
  pProvService->start();

  BLEAdvertising *pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(PROV_SERVICE_UUID);
  pAdv->setScanResponse(true);
  pAdv->setMinPreferred(0x06);
  pAdv->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[SETUP] Pairing Mode Active: BLE '" + apName + "' & SoftAP http://192.168.4.1");
}

// =========================================================================================
// LAN REST HTTP API HANDLERS
// =========================================================================================
void sendCors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
  server.sendHeader("Access-Control-Allow-Headers", "*");
}

bool lanAuthorized() {
  String k = server.hasArg("k") ? server.arg("k") : server.arg("token");
  if (k == String(config.authKey)) return true;
  sendCors();
  server.send(401, "application/json", "{\"error\":\"unauthorized\"}");
  return false;
}

void handleLanPing() {
  if (!lanAuthorized()) return;
  long rem1 = hwTimer1Active ? max(0L, (long)((hwTimer1EndsAt - millis()) / 1000UL)) : 0L;
  long rem2 = hwTimer2Active ? max(0L, (long)((hwTimer2EndsAt - millis()) / 1000UL)) : 0L;

  String json = "{\"id\":\"" + String(config.devId) +
                "\",\"name\":\"" + String(config.devName) +
                "\",\"room\":\"" + String(config.room) +
                "\",\"state\":" + String(relay1State ? "1" : "0") +
                ",\"relay1\":" + (relay1State ? "1" : "0") +
                ",\"relay2\":" + (relay2State ? "1" : "0") +
                ",\"timerRemSec\":" + String(rem1) +
                ",\"timer1\":" + String(rem1) +
                ",\"timer2\":" + String(rem2) +
                ",\"autoOffSec\":" + String(config.autoOffSec1) +
                ",\"lock\":" + (config.wallSwitchLock ? "1" : "0") +
                ",\"ip\":\"" + WiFi.localIP().toString() + "\"" +
                ",\"rssi\":" + String(WiFi.RSSI()) +
                ",\"ble_rssi\":" + String(currentFilteredRssi) +
                ",\"rssi_thresh\":" + String(config.userThresholdRssi) +
                ",\"buzzer\":" + (config.buzzerEnabled ? "1" : "0") +
                ",\"fw\":\"" + FW_VERSION + "\"}";
  sendCors();
  server.send(200, "application/json", json);
}

void handleLanToggle() {
  if (!lanAuthorized()) return;

  // Check for reset parameter
  if (server.arg("state") == "RESET") {
    sendCors();
    server.send(200, "application/json", "{\"status\":\"resetting\"}");
    delay(200);
    triggerFactoryReset();
    return;
  }

  String ch = server.hasArg("ch") ? server.arg("ch") : server.arg("relay");
  String s = server.arg("state");

  if (ch == "2") {
    if (s == "1" || s == "ON") setRelay2(true);
    else if (s == "0" || s == "OFF") setRelay2(false);
    else setRelay2(!relay2State);
  } else {
    if (s == "1" || s == "ON") setRelay1(true);
    else if (s == "0" || s == "OFF") setRelay1(false);
    else setRelay1(!relay1State);
  }

  sendCors();
  server.send(200, "application/json",
              "{\"state\":" + String(relay1State ? "1" : "0") +
              ",\"relay1\":" + String(relay1State ? "1" : "0") +
              ",\"relay2\":" + String(relay2State ? "1" : "0") + "}");
}

void handleLanTimer() {
  if (!lanAuthorized()) return;
  String ch = server.hasArg("ch") ? server.arg("ch") : "1";
  unsigned long sec = server.arg("sec").toInt();
  bool targetState = server.hasArg("state") ? (server.arg("state").toInt() == 1) : false;

  if (ch == "2") startTimer2(sec, targetState);
  else startTimer1(sec, targetState);

  publishState();
  sendCors();
  server.send(200, "application/json", "{\"status\":\"timer_set\",\"sec\":" + String(sec) + "}");
}

void handleLanBootState() {
  if (!lanAuthorized()) return;
  if (server.hasArg("mode")) {
    String m = server.arg("mode");
    m.toUpperCase();
    strncpy(config.bootState, m.c_str(), sizeof(config.bootState) - 1);
  }
  if (server.hasArg("autoOff")) {
    uint16_t ao = (uint16_t)server.arg("autoOff").toInt();
    config.autoOffSec1 = ao;
    config.autoOffSec2 = ao;
  }
  if (server.hasArg("lock")) {
    config.wallSwitchLock = (server.arg("lock") == "1" || server.arg("lock").equalsIgnoreCase("true"));
  }
  pendingConfigSave = millis() + 2000;
  publishState();

  sendCors();
  server.send(200, "application/json",
              "{\"bootState\":\"" + String(config.bootState) +
              "\",\"autoOffSec\":" + String(config.autoOffSec1) +
              ",\"lock\":" + (config.wallSwitchLock ? "1" : "0") + "}");
}

void handleLanIrSend() {
  if (!lanAuthorized()) return;
  String proto = server.arg("proto");
  String code = server.arg("code");
  int bits = server.hasArg("bits") ? server.arg("bits").toInt() : 32;

  executeIrBlast(proto + ":" + code + ":" + String(bits));
  sendCors();
  server.send(200, "application/json", "{\"status\":\"ir_blasted\"}");
}

void handleLanIrLearn() {
  if (!lanAuthorized()) return;
  isLearningIr = true;
  irLearnTimeoutMs = millis() + 15000;
  irrecv.enableIRIn();
  playPairingChime();

  sendCors();
  server.send(200, "application/json", "{\"status\":\"learning_mode_active\",\"timeout_sec\":15}");
}

void handleLanIrLast() {
  if (!lanAuthorized()) return;
  sendCors();
  server.send(200, "application/json", "{\"last_code\":\"" + lastLearnedIrCode + "\"}");
}

void handleLanBuzzer() {
  if (!lanAuthorized()) return;
  if (server.hasArg("mute")) {
    config.buzzerEnabled = (server.arg("mute") == "0");
    pendingConfigSave = millis() + 2000;
  }
  if (server.hasArg("tone")) {
    uint32_t f = server.arg("freq").toInt();
    uint32_t d = server.arg("dur").toInt();
    buzzerTone(f, d);
  } else {
    playRelay1Chirp();
  }
  sendCors();
  server.send(200, "application/json", "{\"buzzer_enabled\":" + String(config.buzzerEnabled ? "1" : "0") + "}");
}

void handleLanRssiConfig() {
  if (!lanAuthorized()) return;
  if (server.hasArg("val")) {
    config.userThresholdRssi = server.arg("val").toInt();
    pendingConfigSave = millis() + 2000;
  }
  sendCors();
  server.send(200, "application/json",
              "{\"userThresholdRssi\":" + String(config.userThresholdRssi) +
              ",\"currentFilteredRssi\":" + String(currentFilteredRssi) + "}");
}

void handleLanOta() {
  if (!lanAuthorized()) return;
  if (!server.hasArg("url")) {
    sendCors();
    server.send(400, "application/json", "{\"error\":\"missing url\"}");
    return;
  }
  String url = server.arg("url");
  sendCors();
  server.send(200, "application/json", "{\"status\":\"ota_initiated\"}");
  performHttpOta(url);
}

// =========================================================================================
// 5X POWER CYCLE BOOT DETECTION
// =========================================================================================
void checkPowerCycleReset() {
  prefs.begin("nari_pwr", false);
  uint8_t count = prefs.getUChar("cnt", 0);
  count++;
  prefs.putUChar("cnt", count);
  prefs.end();

  Serial.printf("[POWER-CYCLE] Boot count: %d / 5\n", count);
  if (count >= 5 && (config.pwrResetEnabled || emergencyPwrResetActive)) {
    Serial.println("[POWER-CYCLE] 5 quick cycles detected -> Factory reset!");
    prefs.begin("nari_pwr", false);
    prefs.putUChar("cnt", 0);
    prefs.end();
    triggerFactoryReset();
  }
}

// =========================================================================================
// SETUP (INITIALIZATION)
// =========================================================================================
void setup() {
  Serial.begin(115200);
  delay(150);
  Serial.println("\n========================================================");
  Serial.println(" NARI ESP32-C3 SUPERMINI DUAL-SWITCH & IR NODE (v2.2.0) ");
  Serial.println("========================================================");

  // 1. Hardware Pin Initialization (ZERO-BLIP: Write INACTIVE before pinMode)
  digitalWrite(RELAY1_PIN, RELAY_INACTIVE);
  pinMode(RELAY1_PIN, OUTPUT);
  digitalWrite(RELAY2_PIN, RELAY_INACTIVE);
  pinMode(RELAY2_PIN, OUTPUT);

  pinMode(LED_PIN, OUTPUT);
  setLed(false);

  // 2. Capacitive Touch Sensors Setup (TTP223 / Wall Switches)
  pinMode(TOUCH1_PIN, INPUT_PULLDOWN);
  pinMode(TOUCH2_PIN, INPUT_PULLDOWN);
  delay(300); // Allow sensor capacitance to settle
  touch1IdleLevel = digitalRead(TOUCH1_PIN);
  lastRawTouch1 = touch1IdleLevel;
  debouncedTouch1 = touch1IdleLevel;

  touch2IdleLevel = digitalRead(TOUCH2_PIN);
  lastRawTouch2 = touch2IdleLevel;
  debouncedTouch2 = touch2IdleLevel;

  // 3. Initialize IR Blaster & 38kHz Receiver
  irsend.begin();
  irrecv.enableIRIn();

  // 4. Initialize Piezo Acoustic Buzzer
  buzzerInit();

  // 5. Load Stored Configurations & Check 5x Power Reset
  loadConfig();
  memcpy(myClusterPacket.magic, "NARI", 4);
  strncpy(myClusterPacket.nodeId, config.devId, sizeof(myClusterPacket.nodeId) - 1);
  strncpy(myClusterPacket.room, config.room, sizeof(myClusterPacket.room) - 1);
  myClusterPacket.applianceType = config.applianceType;
  initFamilyTracker();
  checkPowerCycleReset();

  // 6. Apply Configured Boot States
  if (strcmp(config.bootState, "ON") == 0) {
    setRelay1(true, false);
    setRelay2(true, false);
  } else if (strcmp(config.bootState, "OFF") == 0) {
    setRelay1(false, false);
    setRelay2(false, false);
  } else {
    setRelay1(config.lastState1, false);
    setRelay2(config.lastState2, false);
  }

  // 7. Check Saved Wi-Fi Credentials
  if (strlen(config.ssid) == 0) {
    Serial.println("[Wi-Fi] No credentials stored. Launching Pairing Mode...");
    startSetupAP();
    return;
  }

  // 8. Connect to Home Wi-Fi Network
  isConfigMode = false;
  WiFi.mode(WIFI_STA);
  WiFi.begin(config.ssid, config.pass);
  Serial.printf("[Wi-Fi] Connecting to '%s'...\n", config.ssid);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 10000) {
    delay(200);
    setLed((millis() / 300) % 2 == 0); // Smooth connecting pulse
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[Wi-Fi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    wasConnectedBefore = true;
    wifiFailedAttempts = 0;
    pairedSolidUntil = millis() + 3000;
    setLed(true);
    playConnectedChime();
  } else {
    Serial.println("[Wi-Fi] Router not ready yet. Operating offline with background reconnect.");
    wasConnectedBefore = false;
    wifiFailedAttempts = 1;
    setLed(false);
  }

  // 9. Attach LAN REST API Endpoints
  server.on("/ping", HTTP_GET, handleLanPing);
  server.on("/info", HTTP_GET, handleLanPing);
  server.on("/toggle", HTTP_GET, handleLanToggle);
  server.on("/toggle2", HTTP_GET, []() {
    server.sendHeader("Location", "/toggle?relay=2", true);
    server.send(307, "text/plain", "");
  });
  server.on("/relay", HTTP_GET, handleLanToggle);
  server.on("/timer", HTTP_GET, handleLanTimer);
  server.on("/setBootState", HTTP_GET, handleLanBootState);
  server.on("/reset", HTTP_GET, []() {
    if (!lanAuthorized()) return;
    sendCors();
    server.send(200, "application/json", "{\"status\":\"resetting\"}");
    delay(200);
    triggerFactoryReset();
  });
  server.on("/ota", HTTP_GET, handleLanOta);
  server.on("/ir/send", HTTP_GET, handleLanIrSend);
  server.on("/ir/learn", HTTP_GET, handleLanIrLearn);
  server.on("/ir/last", HTTP_GET, handleLanIrLast);
  server.on("/beep", HTTP_GET, handleLanBuzzer);
  server.on("/buzzer", HTTP_GET, handleLanBuzzer);
  server.on("/config/rssi", HTTP_GET, handleLanRssiConfig);
  server.onNotFound([]() {
    sendCors();
    server.send(204);
  });
  server.begin();

  // 10. Arduino OTA
  ArduinoOTA.setHostname(config.devId);
  ArduinoOTA.setPassword(config.authKey);
  ArduinoOTA.begin();

  // 11. ESP-NOW Inter-Node Sync Mesh
  if (esp_now_init() == ESP_OK) {
    esp_now_register_recv_cb(onEspNowDataRecv);
    esp_now_peer_info_t peerInfo = {};
    memset(peerInfo.peer_addr, 0xFF, 6);
    peerInfo.channel = 0;
    peerInfo.encrypt = false;
    esp_now_add_peer(&peerInfo);
  }

  // 12. BLE Presence Scanner & Advertising Setup
  BLEDevice::init(config.devName);
  pBLEScan = BLEDevice::getScan();
  pBLEScan->setAdvertisedDeviceCallbacks(new BeaconAdvertisedDeviceCallbacks());
  pBLEScan->setActiveScan(true);
  pBLEScan->setInterval(100);
  pBLEScan->setWindow(99);

  BLEAdvertising *pAdv = BLEDevice::getAdvertising();
  pAdv->setScanResponse(true);
  pAdv->setMinPreferred(0x06);
  pAdv->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();
}

// =========================================================================================
// MAIN RUNTIME LOOP
// =========================================================================================
bool pwrCounterCleared = false;
unsigned long lastEspNowSync = 0;

void loop() {
  unsigned long nowMs = millis();

  // Clear 5x Power Cycle count after 4 seconds of stable run
  if (!pwrCounterCleared && nowMs > 4000) {
    pwrCounterCleared = true;
    prefs.begin("nari_pwr", false);
    prefs.putUChar("cnt", 0);
    prefs.end();
  }

  // Update Non-Blocking Engines
  updateBuzzer();
  updateHwTimers();

  // ---------------------------------------------------------------------------------------
  // TOUCH SWITCH 1 (GPIO 0 -> Controls Relay 1)
  // ---------------------------------------------------------------------------------------
  int rawTouch1 = digitalRead(TOUCH1_PIN);
  if (rawTouch1 != lastRawTouch1) {
    lastDebounceTime1 = nowMs;
    lastRawTouch1 = rawTouch1;
  }
  if ((nowMs - lastDebounceTime1) > DEBOUNCE_DELAY) {
    if (rawTouch1 != debouncedTouch1) {
      debouncedTouch1 = rawTouch1;
      bool isTouched = (debouncedTouch1 != touch1IdleLevel);
      if (isTouched) {
        touch1Active = true;
        touch1StartTime = nowMs;
        resetTriggered1 = false;
        // Physical switch respects Child Lock
        if (!isConfigMode && !config.wallSwitchLock) {
          setRelay1(!relay1State);
        }
      } else {
        touch1Active = false;
      }
    }
  }
  // 10-Second Hold Reset on Touch 1 (Emergency failsafe, works even when locked)
  if (touch1Active && !resetTriggered1 && (nowMs - touch1StartTime > 10000)) {
    resetTriggered1 = true;
    triggerFactoryReset();
  }

  // ---------------------------------------------------------------------------------------
  // TOUCH SWITCH 2 (GPIO 1 -> Controls Relay 2)
  // ---------------------------------------------------------------------------------------
  int rawTouch2 = digitalRead(TOUCH2_PIN);
  if (rawTouch2 != lastRawTouch2) {
    lastDebounceTime2 = nowMs;
    lastRawTouch2 = rawTouch2;
  }
  if ((nowMs - lastDebounceTime2) > DEBOUNCE_DELAY) {
    if (rawTouch2 != debouncedTouch2) {
      debouncedTouch2 = rawTouch2;
      bool isTouched = (debouncedTouch2 != touch2IdleLevel);
      if (isTouched) {
        touch2Active = true;
        touch2StartTime = nowMs;
        resetTriggered2 = false;
        // Physical switch respects Child Lock
        if (!isConfigMode && !config.wallSwitchLock) {
          setRelay2(!relay2State);
        }
      } else {
        touch2Active = false;
      }
    }
  }
  // 10-Second Hold Reset on Touch 2 (Emergency failsafe, works even when locked)
  if (touch2Active && !resetTriggered2 && (nowMs - touch2StartTime > 10000)) {
    resetTriggered2 = true;
    triggerFactoryReset();
  }

  // ---------------------------------------------------------------------------------------
  // IN-BUILT LED STATUS ENGINE (GPIO 8)
  // ---------------------------------------------------------------------------------------
  if (blinkActive) {
    if (nowMs >= activePattern.nextChange) {
      activePattern.index++;
      if (activePattern.index >= activePattern.count) {
        blinkActive = false;
        // Immediately enforce solid steady-state upon completion of blink:
        // - When two relays ON (or any relay ON): LED stays solid ON
        // - When two relays OFF: LED stays solid OFF
        setLed(relay1State || relay2State);
      } else {
        activePattern.nextChange = nowMs + activePattern.durations[activePattern.index];
        bool flashState = ((activePattern.index % 2) == 0) ? !activePattern.baselineState : activePattern.baselineState;
        setLed(flashState);
      }
    }
  } else if (nowMs < pairedSolidUntil) {
    setLed(true);
  } else if (isConfigMode) {
    // 2 Rapid Blinks + 1 Slow Blink Pattern (1500ms cycle)
    unsigned long phase = nowMs % 1500;
    if (phase < 80) setLed(true);
    else if (phase < 180) setLed(false);
    else if (phase < 260) setLed(true);
    else if (phase < 420) setLed(false);
    else if (phase < 920) setLed(true);
    else setLed(false);
  } else if (WiFi.status() != WL_CONNECTED && !relay1State && !relay2State) {
    // Reconnecting pulse only when both relays are standby (OFF)
    unsigned long phase = nowMs % 1000;
    setLed(phase < 500);
  } else {
    // Normal Steady State:
    // - When two relays ON (or any relay ON): Solid ON
    // - When two relays OFF: Solid OFF
    setLed(relay1State || relay2State);
  }

  // ---------------------------------------------------------------------------------------
  // DEFERRED FLASH COMMIT (2-second settle window protects flash from wear)
  // ---------------------------------------------------------------------------------------
  if (pendingConfigSave != 0 && nowMs > pendingConfigSave) {
    pendingConfigSave = 0;
    saveConfig();
  }

  // ---------------------------------------------------------------------------------------
  // NETWORK & CLOUD HANDLING
  // ---------------------------------------------------------------------------------------
  if (isConfigMode) {
    dnsServer.processNextRequest();
  } else {
    if (WiFi.status() == WL_CONNECTED) {
      if (!wasConnectedBefore) {
        wasConnectedBefore = true;
        wifiFailedAttempts = 0;
        playConnectedChime();
        pairedSolidUntil = nowMs + 3000;
      }
    } else {
      wasConnectedBefore = false;
      if (nowMs - lastStaRetryTime > 15000) {
        lastStaRetryTime = nowMs;
        wifiFailedAttempts++;
        WiFi.disconnect();
        WiFi.begin(config.ssid, config.pass);
      }
    }
  }

  server.handleClient();

  if (!isConfigMode) {
    if (!mqttClient.connected()) {
      reconnectMqtt();
    } else {
      mqttClient.loop();
      // Periodic 30s telemetry heartbeat (keeps live WiFi RSSI signal strength fresh on smart card)
      if (nowMs - lastHeartbeatTime >= 30000UL) {
        lastHeartbeatTime = nowMs;
        publishState();
      }
    }
  }

  ArduinoOTA.handle();

  // ---------------------------------------------------------------------------------------
  // 38kHz IR RECEIVER LEARNING ENGINE (GPIO 3)
  // ---------------------------------------------------------------------------------------
  if (isLearningIr) {
    if (nowMs > irLearnTimeoutMs) {
      Serial.println("[IR] Learn Mode Timed Out.");
      isLearningIr = false;
    } else if (irrecv.decode(&irResults)) {
      String protocolName = typeToString(irResults.decode_type);
      String hexCode = uint64ToString(irResults.value, 16);
      int bits = irResults.bits;

      String payload = protocolName + ":0x" + hexCode + ":" + String(bits);
      lastLearnedIrCode = payload;
      Serial.printf("[IR LEARNED] Captured: %s\n", payload.c_str());

      playIrLearnedBlip();
      triggerLedBlinks(3);

      if (mqttClient.connected()) {
        String topicAndroid = "device/" + String(config.devId) + "/ir/learned";
        mqttClient.publish(topicAndroid.c_str(), payload.c_str());

        String topicWeb = "nari/" + String(config.devId) + "/ir/recv";
        mqttClient.publish(topicWeb.c_str(), payload.c_str());
      }

      irrecv.resume();
      isLearningIr = false;
    }
  }

  // ---------------------------------------------------------------------------------------
  // BLE PRESENCE & 1D KALMAN FILTER SPATIAL ARBITRATION ENGINE
  // ---------------------------------------------------------------------------------------
  if (pBLEScan != nullptr && !isConfigMode) {
    pBLEScan->start(1, false);
    pBLEScan->clearResults();
  }

  int bestFamilyRssi = -120;
  bool isAnyMemberActive = false;
  for (int i = 0; i < MAX_FAMILY_MEMBERS; i++) {
    if (family[i].userId > 0 && (nowMs - family[i].lastSeen < 4000)) {
      isAnyMemberActive = true;
      if (family[i].filteredRssi > bestFamilyRssi) {
        bestFamilyRssi = family[i].filteredRssi;
      }
    }
  }
  bool isBeaconFresh = isAnyMemberActive;
  currentFilteredRssi = isBeaconFresh ? bestFamilyRssi : -120;

  // Sync cluster peers over ESP-NOW every 250ms
  if (nowMs - lastEspNowSync > 250) {
    lastEspNowSync = nowMs;

    memcpy(myClusterPacket.magic, "NARI", 4);
    strncpy(myClusterPacket.room, config.room, sizeof(myClusterPacket.room) - 1);
    myClusterPacket.room[sizeof(myClusterPacket.room) - 1] = '\0';
    strncpy(myClusterPacket.nodeId, config.devId, sizeof(myClusterPacket.nodeId) - 1);
    myClusterPacket.nodeId[sizeof(myClusterPacket.nodeId) - 1] = '\0';
    myClusterPacket.applianceType = config.applianceType;
    myClusterPacket.bestRssi = (int8_t)currentFilteredRssi;

    for (int i = 0; i < MAX_FAMILY_MEMBERS; i++) {
      myClusterPacket.familyRssi[i].userId = family[i].userId;
      myClusterPacket.familyRssi[i].rssi = (int8_t)family[i].filteredRssi;
      myClusterPacket.familyRssi[i].active =
          (family[i].userId > 0 && (nowMs - family[i].lastSeen <= 2500)) ? 1 : 0;
    }

    uint8_t event = 0;
    if (isBeaconFresh && currentFilteredRssi >= config.userThresholdRssi) {
      event = 1; // Entry boundary crossed
    } else if (!isBeaconFresh || currentFilteredRssi < (config.userThresholdRssi - HYSTERESIS_DELTA_DBM)) {
      event = 2; // Exit boundary crossed
    }
    myClusterPacket.entryExitEvent = event;
    myClusterPacket.timestamp = nowMs;

    uint8_t broadcastMac[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
    esp_now_send(broadcastMac, (uint8_t *)&myClusterPacket, sizeof(RoomClusterPacket));
  }

  // Standalone BLE Presence Switching with Debounce
  // Only trigger if a valid BLE beacon is actively tracked (prevents unwanted auto-off when manual toggle is used)
  bool hasClusterPeers = (nowMs - lastClusterSeenTime < 5000);
  if (!hasClusterPeers && isBeaconFresh) {
    if (currentFilteredRssi >= config.userThresholdRssi) {
      if (!relay1State) {
        if (winStartTime == 0) {
          winStartTime = nowMs;
        } else if (nowMs - winStartTime >= DEBOUNCE_DELAY_MS) {
          Serial.printf("[BLE PRESENCE] Phone in range (%d dBm >= %d dBm) -> Auto Relay 1 ON\n",
                        currentFilteredRssi, config.userThresholdRssi);
          setRelay1(true);
          winStartTime = 0;
          lossStartTime = 0;
        }
      }
    } else if (currentFilteredRssi < (config.userThresholdRssi - HYSTERESIS_DELTA_DBM)) {
      if (relay1State) {
        if (lossStartTime == 0) {
          lossStartTime = nowMs;
        } else if (nowMs - lossStartTime >= DEBOUNCE_DELAY_MS) {
          Serial.printf("[BLE PRESENCE] Phone left area (%d dBm < %d dBm) -> Auto Relay 1 OFF\n",
                        currentFilteredRssi, (config.userThresholdRssi - HYSTERESIS_DELTA_DBM));
          setRelay1(false);
          lossStartTime = 0;
          winStartTime = 0;
        }
      }
    } else {
      winStartTime = 0;
      lossStartTime = 0;
    }
  } else {
    winStartTime = 0;
    lossStartTime = 0;
  }

  delay(10);
}
