
/* Copy to js/config.local.js and fill in your deployment values.
 * js/config.local.js is git-ignored. If you deploy through GitHub Pages remember that anything in this
 * file is downloaded by every visitor - use a dedicated, ACL-restricted Mosquitto user (see README). */
window.NARI_LOCAL_CONFIG = {
  brokerUrl: "wss://mqtt.example.com:9001",
  mqttUser: "nari_customer",
  mqttPass: "change-me",
  topicPrefix: "nari",
  lanToken: "same-as-API_AUTH_KEY-in-firmware",
  otaUrl: "http://mqtt.example.com/firmware/nari_switch_esp01s.bin"
  // firebase: { apiKey: "...", authDomain: "...", projectId: "...", storageBucket: "...", messagingSenderId: "...", appId: "..." }
};
