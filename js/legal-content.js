/* NARI Smart Home - "About the app" and "Terms & Conditions" text.
 *
 * Single source of truth. The Android copy (LegalContent.kt) is GENERATED from this file:
 *     node tools/gen_android_legal.js
 * Edit the text here, bump termsVersion when the Terms change (everyone is asked to accept again),
 * then regenerate the Android file.
 *
 * Written in plain English on purpose. The Terms are a practical draft - have them reviewed by a
 * lawyer before a public store release.
 */
(function (g) {
  "use strict";

  var LEGAL = {
    termsVersion: "1.1",
    termsUpdated: "4 November 2026",
    company: "NARI IoT Solutions Company",
    madeInIndia: true,
    website: "https://narismarthome.com",
    privacyUrl: "https://narismarthome.com/privacy.html",

    about: {
      title: "About NARI Smart Home",
      tagline: "Control your home from your phone - at home or anywhere in the world.",
      sections: [
        {
          title: "Developed by NARI IoT Solutions Company",
          paras: [
            "NARI Smart Home - the NARI smart switches, their firmware, the Android app and the web app - is designed, engineered, and developed in India by NARI IoT Solutions Company under the Make in India initiative.",
            "We build simple, affordable and reliable smart-home products for Indian homes: Wi-Fi switches that keep working with your normal wall switches, local control that does not need the internet, and a private, privacy-first app.",
            "Developed by NARI IoT Solutions Company | Website: narismarthome.com | Make in India"
          ]
        },
        {
          title: "What is NARI Smart Home?",
          paras: [
            "NARI Smart Home lets you switch the lights, fans and other appliances in your home from your phone or web browser.",
            "You fit a small NARI smart switch behind your normal wall switch, connect it to your home Wi-Fi once, and then control it from this app. Your normal wall switch keeps working too, and the app always shows the real state."
          ]
        },
        {
          title: "What can I control?",
          bullets: [
            "Lights, fans, geysers, water pumps, motors, sockets - anything wired through a NARI switch (always stay within the switch's rated load).",
            "Two appliances from one card. A two-channel switch shows two buttons, for example a light and a fan. A one-channel switch shows one button.",
            "TV, air conditioner, set-top box and soundbar, using the built-in infrared (IR) remote feature of the ESP32-C3 switch.",
            "Everything is organised by room, with your own names and icons."
          ]
        },
        {
          title: "How does it connect?",
          paras: ["The app picks the fastest working route by itself. You do not need to choose."],
          bullets: [
            "Home Wi-Fi (local): instant response, and it keeps working even when your internet is down.",
            "Internet (cloud): lets you control your home when you are away - from office, travel, anywhere.",
            "Set-up mode: a brand-new switch creates its own small Wi-Fi hotspot called NARI-XXXX. You join it, pick your home Wi-Fi, and you are done.",
            "Tip: switches use 2.4 GHz Wi-Fi. They do not work on 5 GHz-only networks."
          ]
        },
        {
          title: "Smart Scenes - one tap, many actions",
          paras: ["A scene is a group of actions that run together."],
          bullets: [
            "Ready-made scenes such as Good Morning, Good Night, Cinema Time and Leaving Home.",
            "One-tap All ON and All OFF for the whole house.",
            "Android app: just describe a scene in your own words - type it or say it, for example \"turn off all lights at 11 pm\" - and the app builds the scene for you and asks you to confirm. It understands your rooms, your device names and times.",
            "Web app: build scenes with the scene editor.",
            "Scenes can be started by a tap, a time, a clap, a phone gesture and more."
          ]
        },
        {
          title: "Hands-free automations",
          paras: ["Turn a switch on or off without touching the app. Each one is optional and you set it up per switch."],
          bullets: [
            "Clap: single, double or triple clap (you can also train it to your own clap).",
            "Whistle and voice commands (English and Telugu), for example \"lights on\".",
            "Phone movement: shake, wrist flick, flip the phone face-down or face-up, tilt in a direction, or point the compass at a room.",
            "Light level (switch on when it gets dark), battery level (charger guard) and idle timeout.",
            "Location: switch on when you arrive home or walk into a room, and off when you leave.",
            "Presence: use your phone being on the home Wi-Fi to know you are home.",
            "NFC: tap your phone on an NFC tag.",
            "Schedules and countdown timers, including sunrise and sunset times.",
            "Light effects such as strobe and patterns.",
            "Note: sensor and voice features use your phone. On the web app the page must stay open in the browser; the Android app can keep working in the background."
          ]
        },
        {
          title: "Extra features in the Android app",
          bullets: [
            "Fingerprint, face or PIN protection for the whole app, and secure unlock for chosen switches.",
            "Walk-in / walk-out automation using Bluetooth beacons and phone proximity.",
            "Smart suggestions that learn your habits, for example \"You usually turn this light on at 7 pm\".",
            "Google Assistant and Gemini voice commands (set up in Settings).",
            "Backup and restore of your setup to your own Google Drive.",
            "Share your home with family by QR code.",
            "AI Support chatbot for help and diagnostics."
          ]
        },
        {
          title: "TV and AC remote (IR)",
          paras: [
            "The ESP32-C3 switch has an infrared LED that can send remote commands, and an infrared receiver that can learn them.",
            "To teach a button, press Learn, point your real remote at the switch and press the button. The app saves it. After that, the button works from your phone.",
            "Common remote types are supported, including NEC, Sony, Samsung, LG, Panasonic, RC5 and RC6, and raw signals for the rest."
          ]
        },
        {
          title: "Energy and cost estimates",
          bullets: [
            "Shows live home load, today's usage, an estimated monthly bill and the cost in rupees using your own electricity tariff.",
            "You can set the wattage of each appliance (for example 12 W light, 75 W fan).",
            "These are estimates worked out from the watts you enter and how long each appliance was ON. They are not measured by an energy meter, so they will not exactly match your electricity bill."
          ]
        },
        {
          title: "Family sharing and guests",
          bullets: [
            "Roles: Home Admin, Co-admin, Family Member and Guest. Only admins can create or change scenes and settings.",
            "Temporary Guest Pass - give a visitor limited access without asking them to log in.",
            "Activity log shows who switched what, and when.",
            "Choose which switches the whole family can use."
          ]
        },
        {
          title: "Built-in safety features",
          bullets: [
            "Hardware timer: the countdown runs inside the switch itself, so a geyser or motor still turns OFF on time even if your phone or Wi-Fi goes off.",
            "Auto-off (inching) after a set number of seconds.",
            "Child lock: disable the wall switch or touch buttons.",
            "Power-cut behaviour: choose whether the switch returns to ON, OFF or its last state after the power comes back.",
            "Physical reset: hold the touch or wall switch for 10 seconds to reset Wi-Fi.",
            "If the home router is slow to start after a power cut, the switch keeps retrying your Wi-Fi by itself."
          ]
        },
        {
          title: "Wireless updates",
          paras: ["Switch firmware can be updated over Wi-Fi from the app (OTA). When an update is available you will see \"Update Available\" in the device settings. The app only reports success after the switch itself confirms the new version."]
        },
        {
          title: "Your privacy",
          bullets: [
            "Login is optional. Without login, your switch cards, rooms and scenes are saved only on your own phone or browser. They are never uploaded and no one else on the internet can see them.",
            "If you do log in, your setup is backed up to your own private account space so it follows you to a new phone. Other users cannot read it.",
            "Every switch has its own unique ID and its own private message channel. Direct network access to a switch also needs a secret key.",
            "Sound from the microphone is analysed on your device for clap and whistle detection and is not recorded or uploaded by the app.",
            "Read the full Privacy Policy on our website."
          ]
        },
        {
          title: "Supported switches",
          bullets: [
            "NARI Switch ESP-01S: one relay, a very compact switch.",
            "NARI Switch ESP32-C3: two relays, two touch or wall-switch inputs, status light, IR sender and receiver, piezo buzzer for sound feedback, and Bluetooth presence detection. Works with Home Assistant too."
          ]
        },
        {
          title: "Good to know",
          bullets: [
            "Control from outside your home needs internet on both your phone and the switch's Wi-Fi.",
            "On the web app, a page opened with https:// cannot talk straight to a switch on your home network. It then uses the internet route. Open the web app over http:// on your home network for direct local control, or use the Android app.",
            "Microphone, location, camera, Bluetooth and motion features work only after you allow the permission.",
            "Mains electricity is dangerous. Have switches installed by a qualified electrician and read the Terms & Conditions.",
            "NARI Smart Home is not a safety or life-support system."
          ]
        }
      ],
      footer: "\u00a9 2026 NARI IoT Solutions. All rights reserved. NARI Smart Home is a product of NARI IoT Solutions Company. Proudly Made in India."
    },

    terms: {
      title: "Terms & Conditions",
      intro: [
        "Please read these Terms & Conditions carefully before you use NARI Smart Home (the \"App\"), which is available as an Android app and as a web app. The App and the NARI smart switches are developed and owned by NARI IoT Solutions Company (\"NARI IoT Solutions\", \"we\", \"us\").",
        "By ticking the box and pressing \"Agree & Continue\", you confirm that you have read, understood and accepted these Terms and our Privacy Policy. If you do not agree, please do not use the App."
      ],
      sections: [
        {
          title: "1. What the App does",
          paras: ["The App lets you control NARI smart switches and the appliances connected to them, create scenes and automations, view estimated energy use and share access with your family. Some features depend on your phone, your Wi-Fi, the internet and third-party services."]
        },
        {
          title: "2. Electrical safety - very important",
          bullets: [
            "Mains electricity (110-240 V) can injure or kill and can cause fires. Switches must be installed, wired and tested by a qualified electrician following your local electrical rules.",
            "Never connect more load than the switch is rated for. Use the correct wire size, fuse and enclosure.",
            "Do not use the App or switches to control life-support or medical equipment, or as your only fire, gas or security safety device.",
            "Be careful with heaters, geysers, irons, motors and other high-load or heat-producing appliances. Do not leave them running unattended just because you can switch them off from the App.",
            "A command can fail or be delayed because of Wi-Fi, internet, power, phone or server problems. Never depend on the App alone where a failure could cause harm.",
            "You install and use NARI switches at your own risk."
          ]
        },
        {
          title: "3. Your data and account",
          bullets: [
            "You can use the App without logging in. In that case your setup is stored only on your own phone or browser.",
            "If you log in, your setup may be backed up to your private account space so you can restore it on another device.",
            "You are responsible for keeping your phone, your login and your family-sharing invitations secure.",
            "If you share your home with others, you choose who gets access. Home Admins are responsible for what the people they invite do in the App."
          ]
        },
        {
          title: "4. Permissions the App may ask for",
          paras: ["Permissions are optional and are used only for the features you switch on. You can turn them off at any time in your phone or browser settings."],
          bullets: [
            "Microphone: clap, whistle and voice automations. Sound is analysed on your device and is not recorded or uploaded by the App. Voice recognition may be done by your phone or browser's speech service (for example Google), which has its own terms.",
            "Location (including background location on Android): arrive and leave automations, room proximity, sunrise and sunset times, and finding switches on your Wi-Fi.",
            "Bluetooth and nearby devices: beacon presence and finding switches.",
            "Camera: scanning QR codes and face unlock.",
            "Motion and orientation sensors: shake, flick, flip, tilt and compass automations.",
            "NFC: tap-to-switch tags.",
            "Biometrics: fingerprint or face protection.",
            "Notifications: alerts such as a device going offline.",
            "Storage or files: backup and restore."
          ]
        },
        {
          title: "5. Third-party services",
          paras: ["The App relies on services we do not control, such as Google sign-in and cloud database, Google Drive, Google Assistant, a cloud message server (MQTT broker), web hosting and your phone's or browser's speech and sensor features. These may change, be unavailable or have their own terms and privacy policies. We are not responsible for them."]
        },
        {
          title: "6. Acceptable use",
          bullets: [
            "Use the App only with switches and homes you own or are allowed to control.",
            "Do not try to break into, overload, copy or damage the App, other people's devices or our servers.",
            "Do not use the App for anything illegal or unsafe."
          ]
        },
        {
          title: "7. Wireless updates (firmware)",
          paras: ["The App can send firmware updates to your switch over Wi-Fi. By starting an update you agree to it. Do not switch off the power during an update. If an update fails, the switch may need to be re-flashed over USB."]
        },
        {
          title: "8. Estimates and availability",
          bullets: [
            "Energy and cost figures are estimates only and are not billing-grade.",
            "We try to keep the App working, but we do not promise it will always be available, error-free or compatible with every phone, router or appliance.",
            "We may add, change or remove features at any time."
          ]
        },
        {
          title: "9. No warranty",
          paras: [
            "The App, the firmware and the NARI switches are provided \"as is\" and \"as available\". To the fullest extent allowed by law, we give no warranty of any kind, express or implied, including any promise that the App will be uninterrupted, error-free, secure against every attack, or suitable for a particular purpose.",
            "Any warranty on NARI hardware is limited to what is written on the product box or invoice, if anything."
          ]
        },
        {
          title: "10. Limit of liability",
          bullets: [
            "To the fullest extent allowed by law, NARI IoT Solutions Company, its owners, partners, employees, developers and suppliers are not liable for any indirect, incidental, special or consequential loss; loss of data, profit, use or goodwill; damage to appliances, wiring or property; or injury, caused by or connected with the App or the switches.",
            "This includes losses caused by wrong installation, overload, poor wiring, power surges, power or network failures, Wi-Fi or internet problems, third-party services, phone or browser problems, or a command that was delayed or did not run.",
            "Our total liability for any claim is limited to the amount you actually paid us for the App or the NARI switch involved in the 12 months before the claim arose.",
            "Nothing in these Terms excludes or limits liability that the law does not allow to be excluded or limited, such as liability for death or personal injury caused by our proven negligence, or for fraud. If any limit here is not allowed where you live, it applies only to the extent the law permits."
          ]
        },
        {
          title: "11. You accept the risk of installation and use",
          bullets: [
            "You confirm that the NARI switches will be installed and wired by a qualified electrician, and that you will not open, modify, overload or bypass the hardware or its protection parts (fuse, varistor, insulation gap).",
            "Damage or harm caused by modified, counterfeit, tampered or incorrectly wired hardware, or by unofficial firmware or software, is entirely your responsibility.",
            "You are responsible for the safety of the appliances you connect and for the people and property around them."
          ]
        },
        {
          title: "12. You protect us from claims you cause (indemnity)",
          paras: ["You agree to defend and compensate NARI IoT Solutions Company and its owners, partners, employees and developers against claims, losses, damages and reasonable legal costs that arise from your breach of these Terms, your misuse of the App or switches, your wrong installation or modification of hardware, or your giving other people access to your home or devices."]
        },
        {
          title: "13. Our rights in the App",
          bullets: [
            "The App, the NARI name and logo, the firmware, the designs and the content belong to NARI IoT Solutions Company or its licensors. You get a personal, non-exclusive, non-transferable right to use the App for your own home.",
            "You may not copy, sell, rent, reverse-engineer or create copies of the App or the NARI hardware for commercial use, except where the law clearly allows it.",
            "Any feedback or ideas you send us may be used by us freely, without payment."
          ]
        },
        {
          title: "14. Suspension and ending",
          paras: ["We may suspend or end your access to cloud features, or change or stop any part of the App, at any time - for example to protect security, stop misuse or comply with the law. You can stop using the App at any time. Sections that by their nature should continue (for example 2, 9, 10, 11, 12, 13, 17 and 18) continue after you stop using the App."]
        },
        {
          title: "15. Privacy",
          paras: ["How we handle information is explained in our Privacy Policy at https://narismarthome.com/privacy.html. The App may collect anonymous usage and diagnostic information (for example crash reports and feature-use counts) to find problems and improve the App."]
        },
        {
          title: "16. Children",
          paras: ["If you are under 18, use the App only with the knowledge and supervision of a parent or guardian. Keep children away from mains wiring and the switch hardware."]
        },
        {
          title: "17. If there is a problem - how disputes are handled",
          bullets: [
            "Talk to us first. Before starting any legal action, write to us through our website (narismarthome.com) and describe the problem. Give us 30 days to try to solve it.",
            "If we cannot agree, the dispute will be settled by arbitration by a single arbitrator under the Arbitration and Conciliation Act, 1996 of India. The seat and venue of arbitration will be the city of NARI IoT Solutions Company's registered office, the language will be English, and the decision will be final and binding.",
            "Subject to arbitration, only the courts at that same city have exclusive jurisdiction.",
            "To the extent the law allows, each person may bring claims only on their own behalf, not as part of a group or representative action.",
            "This does not stop you from using any statutory consumer-protection remedy that cannot lawfully be waived."
          ]
        },
        {
          title: "18. Governing law and general terms",
          bullets: [
            "These Terms are governed by the laws of India.",
            "If any part of these Terms is found to be invalid or unenforceable, the rest stays in force.",
            "If we do not enforce a right straight away, we have not given it up.",
            "We are not responsible for delay or failure caused by events outside our reasonable control (for example power cuts, network or cloud outages, natural events, or government action).",
            "These Terms, together with the Privacy Policy, are the whole agreement between you and NARI IoT Solutions Company about the App."
          ]
        },
        {
          title: "19. Changes to these Terms",
          paras: ["We may update these Terms. When they change in an important way, the App will show them again and ask you to accept before you continue."]
        },
        {
          title: "20. Contact us",
          paras: ["NARI IoT Solutions Company - Website: https://narismarthome.com. In the Android app you can also use the AI Support chatbot in Settings."]
        }
      ],
      footer: "\u00a9 2026 NARI IoT Solutions. Thank you for choosing NARI Smart Home."
    }
  };

  g.NARI_LEGAL_CONTENT = LEGAL;
  if (typeof module !== "undefined" && module.exports) module.exports = LEGAL;
})(typeof window !== "undefined" ? window : globalThis);

