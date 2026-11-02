# NARI Smart Home

Progressive web app + ESP-01S firmware for NARI smart switches. Control over home Wi-Fi (LAN) with automatic cloud (MQTT) fallback. Installable, works offline on the local network, and supports real over-the-air firmware updates.

## Repository layout

| Path | Purpose |
|---|---|
| `index.html`, `css/`, `js/` | The web app (no build step) |
| `sw.js` | Service worker (offline app shell) |
| `vendor/` | Bundled third-party libraries (no CDN needed) |
| `firmware/nari_switch_esp01s.ino` | Device firmware |
| `firmware/version.json` | OTA release manifest |
| `js/config.local.js` | **Your secrets - git-ignored.** Copy from `js/config.local.example.js` |

## Run locally

```bash
npx http-server . -p 8080 -c-1
```
Open http://localhost:8080. Use `http://` locally if you want LAN control (see "LAN vs HTTPS" below).

## Configure a deployment

1. `copy js\config.local.example.js js\config.local.js` and fill in broker URL/credentials/LAN token.
2. The LAN token must equal the device's auth key (`DEFAULT_AUTH_KEY` in the sketch).
3. Never commit `config.local.js`. Rotate any credentials that were ever committed - git history keeps them.

## Firmware & OTA updates

Device contract (see `js/transport.js`): `/ping`, `/toggle?state=`, `/setBootState?mode=`, `/ota?url=` (all need `?k=KEY`), plus MQTT `nari/<id>/{set,state,status,ota,ota/progress,ota/error,config/boot}`.

**Release process**
1. Bump `FW_VERSION` in the sketch and `version` in `firmware/version.json` (must match).
2. Arduino IDE (ESP8266 core): *Sketch > Export Compiled Binary*, board "Generic ESP8266 / ESP-01S 1MB", flash size **1MB (FS:64KB OTA:~470KB)**.
3. Host the `.bin` over plain **`http://`** at the `binUrl` in `version.json` (the ESP-01S cannot do TLS reliably). The Oracle Always-Free VM + nginx works at zero cost.
4. Deploy the web app. Users see "Update Available" in the device settings.

**Important:** devices running firmware older than 1.2.0 do not have the OTA endpoints. Flash them **once** over USB/serial; after that all updates are wireless. Test every release on one switch before publishing the `.bin`.

The app only reports success when the device itself comes back reporting the new version; otherwise it shows a timeout error.

## LAN vs HTTPS

Browsers block `http://` (LAN device) requests from an `https://` page. Options: use cloud (MQTT over `wss://`) when on HTTPS; or serve the app over `http://` on the LAN; or wrap it in an Android/iOS shell. Cloud mode requires `wss://` on the broker (free TLS via Let's Encrypt + a free domain such as DuckDNS).

## Zero-cost operating notes (read before scaling)

Free hosting for the static app: GitHub Pages or Cloudflare Pages (unlimited bandwidth). Free broker: Oracle Always-Free VM running Mosquitto/EMQX.

Before selling at scale, address these - they are the real limits of a zero-cost stack:

1. **One shared MQTT login = anyone can control everyone.** Do not ship the same `nari_admin` credentials to every customer. Use per-device credentials with topic ACLs (each device/customer may only access `nari/<their-id>/#`).
2. **Firebase free (Spark) quotas** are ~50k reads / 20k writes **per day** for the whole project; they will be exhausted well before 50k users if the app syncs on every action. Keep Firestore for low-frequency data only (device list, sharing), and keep switching traffic on MQTT/LAN.
3. **One free VM has a connection ceiling.** Plan for tens of thousands of concurrent MQTT connections per tuned instance (use the ARM Ampere A1 free shape: up to 4 cores / 24 GB), not 100k on a tiny VM. Shard by customer group when needed.
4. **OTA bandwidth:** 100k devices x ~400 KB = ~40 GB per release. Fine for Oracle's free egress allowance, but roll out in batches rather than all at once.
5. **Legal pages** (Privacy Policy, Terms) are still needed before app-store or paid distribution.