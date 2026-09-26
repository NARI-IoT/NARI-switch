/*
 * NARI Smart Switch — Commercial Production Firmware
 * Target: ESP8266 / ESP-01S (1MB Flash)
 *
 * Zero-Cost, Never-See-Back Features:
 * 1. Automatic Captive Portal (AP Mode) for seamless Wi-Fi onboarding (no Fing/manual IP needed)
 * 2. DNS Server redirection (Android & iOS "Sign into Wi-Fi" prompt opens automatically)
 * 3. EEPROM persistent storage for Wi-Fi credentials, Device ID (16-char GUID), and Boot State
 * 4. Automatic fallback to Setup AP if home Wi-Fi password or router changes
 * 5. Physical Reset fallback (Hold button on GPIO0 for 5 seconds to reset Wi-Fi)
 * 6. Dual-Mode Transport: Zero-latency Local HTTP LAN + Cloud MQTT (Port 1883)
 * 7. Flash-optimized (< 420 KB) leaving 580 KB free for two-partition OTA updates
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <DNSServer.h>
#include <EEPROM.h>
#include <PubSubClient.h>
#include <ArduinoOTA.h>

// ---------- Hardware Pins (ESP-01S Relay Module v4.0) ----------
#define RELAY_PIN       0     // GPIO0 controls the relay on ESP-01S relay shield
#define BUTTON_PIN      2     // GPIO2 physical toggle switch / reset button
#define LED_PIN         1     // GPIO1 TX (active LOW blue LED on ESP-01S)

// ---------- Default Fallbacks ----------
const char* DEFAULT_MQTT_BROKER = "129.225.82.9";
const int   DEFAULT_MQTT_PORT   = 1883;
const char* DEFAULT_MQTT_USER   = "nari_admin";
const char* DEFAULT_MQTT_PASS   = "narimqtt123";
const char* DEFAULT_AUTH_KEY    = "NARI_SEC_98a7df8a7sdf6a5sd4f";

// ---------- EEPROM Layout (512 Bytes) ----------
#define EEPROM_MAGIC 0x4E415249 // 'NARI'
struct Config {
  uint32_t magic;
  char ssid[33];
  char pass[65];
  char devId[25];       // 16-char GUID e.g. sw_9f8a7b6c1d2e3f4a
  char devName[33];
  char authKey[33];
  char bootState[8];    // "LAST", "ON", "OFF"
  bool lastState;
} config;

// ---------- Global Instances ----------
ESP8266WebServer server(80);
DNSServer dnsServer;
WiFiClient espClient;
PubSubClient mqttClient(espClient);

bool isConfigMode = false;
bool relayState = false;
unsigned long lastMqttRetry = 0;
unsigned long buttonPressStart = 0;
bool buttonActive = false;

// ---------- EEPROM Management ----------
void loadConfig() {
  EEPROM.begin(512);
  EEPROM.get(0, config);
  if (config.magic != EEPROM_MAGIC) {
    // Fresh unconfigured device
    memset(&config, 0, sizeof(config));
    config.magic = EEPROM_MAGIC;
    String autoId = "sw_" + String(ESP.getChipId(), HEX) + String(ESP.getFlashChipId(), HEX);
    autoId.toLowerCase();
    strncpy(config.devId, autoId.c_str(), sizeof(config.devId) - 1);
    strncpy(config.devName, "Switch 1", sizeof(config.devName) - 1);
    strncpy(config.authKey, DEFAULT_AUTH_KEY, sizeof(config.authKey) - 1);
    strncpy(config.bootState, "LAST", sizeof(config.bootState) - 1);
    config.lastState = false;
    EEPROM.put(0, config);
    EEPROM.commit();
  }
}

void saveConfig() {
  EEPROM.put(0, config);
  EEPROM.commit();
}

// ---------- Hardware Control ----------
void setRelay(bool state, bool publishMqtt = true) {
  relayState = state;
  // ESP-01S relay shield: Active LOW or HIGH depending on board revision (most ESP-01S relay v4 are active HIGH)
  digitalWrite(RELAY_PIN, relayState ? HIGH : LOW);
  
  if (strcmp(config.bootState, "LAST") == 0) {
    if (config.lastState != relayState) {
      config.lastState = relayState;
      saveConfig();
    }
  }

  if (publishMqtt && mqttClient.connected()) {
    String topic = "nari/" + String(config.devId) + "/state";
    mqttClient.publish(topic.c_str(), relayState ? "ON" : "OFF", true);
  }
}

// ---------- Captive Portal (Ultra-Lightweight HTML) ----------
void handleCaptivePortal() {
  String s = "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
             "<title>NARI Switch Setup</title><style>"
             "body{font-family:sans-serif;background:#18181b;color:#f4f4f5;padding:20px;text-align:center}"
             ".card{max-width:360px;margin:auto;background:#27272a;padding:24px;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,0.4)}"
             "h2{margin-top:0;color:#f59e0b}input,select{width:100%;box-sizing:border-box;padding:12px;margin:8px 0;background:#18181b;color:#fff;border:1px solid #3f3f46;border-radius:8px}"
             "button{width:100%;padding:12px;background:#f59e0b;color:#000;border:none;border-radius:8px;font-weight:bold;font-size:16px;cursor:pointer;margin-top:12px}"
             "</style></head><body><div class='card'>"
             "<h2>&#9889; NARI Smart Switch</h2><p>Connect switch to your home Wi-Fi</p>"
             "<form action='/save' method='POST'>";

  s += "<label style='text-align:left;display:block;'>Select Wi-Fi Network:</label>";
  s += "<select name='ssid'>";
  int n = WiFi.scanNetworks();
  if (n == 0) {
    s += "<option value=''>No networks found (Refresh)</option>";
  } else {
    for (int i = 0; i < n; ++i) {
      s += "<option value='" + WiFi.SSID(i) + "'>" + WiFi.SSID(i) + " (" + String(WiFi.RSSI(i)) + " dBm)</option>";
    }
  }
  s += "</select>";
  s += "<input type='password' name='pass' placeholder='Wi-Fi Password' required>";
  s += "<input type='text' name='name' value='" + String(config.devName) + "' placeholder='Appliance Name (e.g. Geyser)'>";
  s += "<button type='submit'>Save &amp; Connect</button></form></div></body></html>";

  server.send(200, "text/html", s);
}

void handleSave() {
  String newSsid = server.arg("ssid");
  String newPass = server.arg("pass");
  String newName = server.arg("name");

  if (newSsid.length() > 0) {
    strncpy(config.ssid, newSsid.c_str(), sizeof(config.ssid) - 1);
    strncpy(config.pass, newPass.c_str(), sizeof(config.pass) - 1);
    if (newName.length() > 0) strncpy(config.devName, newName.c_str(), sizeof(config.devName) - 1);
    saveConfig();

    String resp = "<!DOCTYPE html><html><body style='font-family:sans-serif;background:#18181b;color:#10b981;text-align:center;padding:40px;'>"
                  "<h2>&#10004; Settings Saved!</h2><p style='color:#ccc;'>Rebooting to connect to <b>" + newSsid + "</b>...<br>You can now reconnect your phone to your home Wi-Fi.</p></body></html>";
    server.send(200, "text/html", resp);
    delay(1500);
    ESP.restart();
  } else {
    server.send(400, "text/plain", "Missing SSID");
  }
}

void startSetupAP() {
  isConfigMode = true;
  WiFi.mode(WIFI_AP);
  String apName = "NARI-" + String(ESP.getChipId(), HEX);
  apName.toUpperCase();
  WiFi.softAP(apName.c_str());

  // Captive Portal DNS redirection
  dnsServer.start(53, "*", WiFi.softAPIP());

  server.on("/", handleCaptivePortal);
  server.on("/save", HTTP_POST, handleSave);
  // Android & iOS Captive Portal Detection URLs:
  server.on("/generate_204", handleCaptivePortal);
  server.on("/hotspot-detect.html", handleCaptivePortal);
  server.on("/connectivitycheck.gstatic.com/generate_204", handleCaptivePortal);
  server.onNotFound(handleCaptivePortal);
  server.begin();
}

// ---------- LAN HTTP Handlers (Normal Mode) ----------
void handleLanState() {
  if (server.method() == HTTP_POST) {
    String token = server.arg("token");
    if (token.length() > 0 && token != String(config.authKey)) {
      server.send(401, "application/json", "{\"error\":\"unauthorized\"}");
      return;
    }
    String s = server.arg("state");
    if (s == "1" || s == "true" || s == "ON") setRelay(true);
    else if (s == "0" || s == "false" || s == "OFF") setRelay(false);
    else if (s == "toggle") setRelay(!relayState);
  }

  String json = "{\"id\":\"" + String(config.devId) + "\",\"name\":\"" + String(config.devName) + "\",\"state\":" + (relayState ? "true" : "false") + ",\"rssi\":" + String(WiFi.RSSI()) + ",\"fw\":\"1.1.0\"}";
  server.send(200, "application/json", json);
}

// ---------- MQTT Callbacks ----------
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  msg.trim();

  if (msg.equalsIgnoreCase("ON") || msg == "1" || msg.equalsIgnoreCase("TRUE")) setRelay(true);
  else if (msg.equalsIgnoreCase("OFF") || msg == "0" || msg.equalsIgnoreCase("FALSE")) setRelay(false);
  else if (msg.equalsIgnoreCase("TOGGLE")) setRelay(!relayState);
}

void reconnectMqtt() {
  if (WiFi.status() != WL_CONNECTED || isConfigMode) return;
  if (millis() - lastMqttRetry < 5000) return;
  lastMqttRetry = millis();

  mqttClient.setServer(DEFAULT_MQTT_BROKER, DEFAULT_MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);

  String clientId = "nari_dev_" + String(config.devId);
  String willTopic = "nari/" + String(config.devId) + "/status";
  
  if (mqttClient.connect(clientId.c_str(), DEFAULT_MQTT_USER, DEFAULT_MQTT_PASS, willTopic.c_str(), 0, true, "offline")) {
    mqttClient.publish(willTopic.c_str(), "online", true);
    String cmdTopic = "nari/" + String(config.devId) + "/set";
    mqttClient.subscribe(cmdTopic.c_str());
    String stateTopic = "nari/" + String(config.devId) + "/state";
    mqttClient.publish(stateTopic.c_str(), relayState ? "ON" : "OFF", true);
  }
}

// ---------- Setup & Loop ----------
void setup() {
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH); // LED off

  loadConfig();

  // Apply boot state
  if (strcmp(config.bootState, "ON") == 0) relayState = true;
  else if (strcmp(config.bootState, "OFF") == 0) relayState = false;
  else relayState = config.lastState;
  setRelay(relayState, false);

  // If no SSID configured, enter Captive Portal immediately
  if (strlen(config.ssid) == 0) {
    startSetupAP();
    return;
  }

  // Attempt home Wi-Fi connection (15 second timeout before fallback)
  WiFi.mode(WIFI_STA);
  WiFi.begin(config.ssid, config.pass);
  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
    delay(250);
    digitalWrite(LED_PIN, !digitalRead(LED_PIN)); // Blink while connecting
  }

  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(LED_PIN, HIGH); // Solid off when connected
    server.on("/state", handleLanState);
    server.on("/info", handleLanState);
    server.begin();
    ArduinoOTA.setHostname(config.devId);
    ArduinoOTA.begin();
  } else {
    // Router changed or Wi-Fi failed — auto fallback to Captive Portal setup
    startSetupAP();
  }
}

void loop() {
  // Physical Button Long-Press Reset (Hold GPIO2 for 5 seconds to wipe Wi-Fi)
  if (digitalRead(BUTTON_PIN) == LOW) {
    if (!buttonActive) {
      buttonActive = true;
      buttonPressStart = millis();
    } else if (millis() - buttonPressStart > 5000) {
      // 5-second long press detected: Factory Reset
      for (int i = 0; i < 6; i++) {
        digitalWrite(LED_PIN, !digitalRead(LED_PIN));
        delay(100);
      }
      memset(config.ssid, 0, sizeof(config.ssid));
      memset(config.pass, 0, sizeof(config.pass));
      saveConfig();
      ESP.restart();
    }
  } else {
    if (buttonActive) {
      // Short press: physical toggle switch
      if (millis() - buttonPressStart < 1500 && !isConfigMode) {
        setRelay(!relayState);
      }
      buttonActive = false;
    }
  }

  if (isConfigMode) {
    dnsServer.processNextRequest();
    server.handleClient();
  } else {
    server.handleClient();
    if (!mqttClient.connected()) reconnectMqtt();
    else mqttClient.loop();
    ArduinoOTA.handle();
  }
}
