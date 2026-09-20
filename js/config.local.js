/* NARI Smart Home — Pre-configured deployment settings.
 * This file is loaded before config.js and overrides defaults.
 * LAN control is tried first; cloud (MQTT) is used automatically when outside home.
 * The lanToken MUST match API_AUTH_KEY in the ESP-01S firmware sketch. */
window.NARI_LOCAL_CONFIG = {
  // Oracle Cloud VM — WebSocket MQTT (port 9001). Firmware uses TCP 1883 separately.
  // Use ws:// when serving over http://, wss:// when serving over https:// (GitHub Pages).
  brokerUrl:      "ws://129.225.82.9:9001",
  mqttUser:       "nari_admin",
  mqttPass:       "narimqtt123",
  topicPrefix:    "nari",
  lanToken:       "NARI_SEC_98a7df8a7sdf6a5sd4f",  // Matches API_AUTH_KEY in firmware
  lanEnabled:     true,
  lanTimeoutMs:   600,
  lanScanSubnets: "192.168.1,192.168.0,192.168.29,192.168.43,192.168.4,10.0.0,10.0.1,172.16.0"
};
