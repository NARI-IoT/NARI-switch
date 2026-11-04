const fs = require('fs');
const path = require('path');

// Make in India mechanical gear lion SVG
// Meticulously crafted vector representation of the industrial gear-lion,
// featuring interlocking cogwheels, sprockets, and mechanical silhouette.
const lionGearSvg = `
  <g id="gear-lion" fill="currentColor">
    <!-- Tail & spine arch -->
    <path d="M 45 42 C 40 38, 38 25, 48 20 C 52 18, 55 20, 53 24 C 50 28, 48 33, 56 36 C 65 39, 72 38, 85 40 Z"/>
    
    <!-- Hindquarters / Rear Gear Assembly -->
    <circle cx="75" cy="55" r="16" fill="none" stroke="currentColor" stroke-width="3"/>
    <circle cx="75" cy="55" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
    <circle cx="75" cy="55" r="3"/>
    <!-- Rear gear cogs -->
    <path d="M 73 36 h 4 v 4 h -4 z M 73 70 h 4 v 4 h -4 z M 56 53 h 4 v 4 h -4 z M 90 53 h 4 v 4 h -4 z M 62 42 l 3 -3 l 3 3 l -3 3 z M 84 64 l 3 -3 l 3 3 l -3 3 z M 62 64 l 3 3 l 3 -3 l -3 -3 z M 84 42 l 3 3 l 3 -3 l -3 -3 z"/>
    
    <!-- Mid-body / Center Gearbox -->
    <circle cx="115" cy="56" r="20" fill="none" stroke="currentColor" stroke-width="3.5"/>
    <circle cx="115" cy="56" r="12" fill="none" stroke="currentColor" stroke-width="2.5"/>
    <circle cx="115" cy="56" r="4"/>
    <!-- Center gear cogs -->
    <path d="M 113 33 h 4 v 5 h -4 z M 113 74 h 4 v 5 h -4 z M 92 54 h 5 v 4 h -5 z M 133 54 h 5 v 4 h -5 z M 99 40 l 4 -3 l 3 4 l -4 3 z M 127 68 l 4 -3 l 3 4 l -4 3 z M 99 71 l 4 3 l 3 -4 l -4 -3 z M 127 43 l 4 3 l 3 -4 l -4 -3 z"/>

    <!-- Connecting Drive Shafts & Linkages -->
    <path d="M 75 52 L 115 52 L 115 60 L 75 60 Z"/>
    <path d="M 88 44 L 102 38 L 105 44 L 91 50 Z"/>
    <path d="M 87 65 L 102 72 L 99 77 L 84 70 Z"/>

    <!-- Forequarters / Shoulder Gear Assembly -->
    <circle cx="158" cy="52" r="18" fill="none" stroke="currentColor" stroke-width="3.5"/>
    <circle cx="158" cy="52" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
    <circle cx="158" cy="52" r="3.5"/>
    <!-- Shoulder cogs -->
    <path d="M 156 31 h 4 v 5 h -4 z M 156 68 h 4 v 5 h -4 z M 137 50 h 5 v 4 h -5 z M 174 50 h 5 v 4 h -5 z M 143 37 l 4 -3 l 3 4 l -4 3 z M 169 63 l 4 -3 l 3 4 l -4 3 z M 143 66 l 4 3 l 3 -4 l -4 -3 z M 169 40 l 4 3 l 3 -4 l -4 -3 z"/>
    <path d="M 115 53 L 158 50 L 159 56 L 115 59 Z"/>

    <!-- Mechanical Mane (Interlocking Cog Arcs & Radiating Teeth) -->
    <path d="M 152 30 C 158 18, 175 14, 188 20 C 195 24, 200 32, 198 42 C 205 44, 212 50, 210 58 C 208 65, 200 70, 192 72 L 180 72 C 172 74, 162 70, 156 65 Z" fill="none" stroke="currentColor" stroke-width="2.5"/>
    <!-- Mane gear spikes / teeth -->
    <path d="M 160 18 l 3 -6 l 5 2 l -2 6 z M 174 14 l 2 -7 l 6 1 l -1 7 z M 188 17 l 5 -5 l 5 4 l -4 5 z M 200 26 l 6 -3 l 3 5 l -6 3 z M 207 38 l 7 -1 l 2 6 l -7 1 z M 210 50 l 7 1 l 0 6 l -7 0 z M 205 62 l 6 4 l -3 5 l -6 -3 z M 194 72 l 3 6 l -5 3 l -3 -6 z"/>

    <!-- Head, Roaring Jaw & Snout -->
    <path d="M 190 32 L 214 30 L 222 36 L 220 44 L 208 44 L 214 50 L 204 53 L 196 46 Z"/>
    <!-- Eye & Ear -->
    <circle cx="204" cy="35" r="2.5" fill="#060B14"/>
    <path d="M 188 24 L 195 18 L 196 26 Z"/>

    <!-- Front Legs (Mechanical Pistons & Joints) -->
    <!-- Front Leg 1 -->
    <path d="M 154 68 L 150 94 L 158 96 L 162 70 Z"/>
    <circle cx="154" cy="95" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M 152 98 L 148 116 L 160 116 L 158 98 Z"/>
    <path d="M 144 116 L 164 116 L 164 120 L 144 120 Z"/><!-- Paw -->

    <!-- Front Leg 2 (Stepping Forward) -->
    <path d="M 168 66 L 178 90 L 185 87 L 175 64 Z"/>
    <circle cx="181" cy="89" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M 180 93 L 192 114 L 204 114 L 186 91 Z"/>
    <path d="M 188 114 L 208 114 L 208 118 L 188 118 Z"/><!-- Paw -->

    <!-- Hind Legs (Mechanical Struts & Knees) -->
    <!-- Hind Leg 1 -->
    <path d="M 72 70 L 62 92 L 69 95 L 79 72 Z"/>
    <circle cx="65" cy="94" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M 64 98 L 68 116 L 80 116 L 71 97 Z"/>
    <path d="M 66 116 L 84 116 L 84 120 L 66 120 Z"/><!-- Paw -->

    <!-- Hind Leg 2 (Trailing) -->
    <path d="M 82 68 L 88 90 L 95 88 L 88 66 Z"/>
    <circle cx="91" cy="89" r="4" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M 91 93 L 102 114 L 112 114 L 97 91 Z"/>
    <path d="M 100 114 L 116 114 L 116 118 L 100 118 Z"/><!-- Paw -->
  </g>
`;

// 1. Full Badge SVG with Lion, Indian Flag Accent, "MAKE IN INDIA", and "Developed by NARI IoT Solutions Company"
const fullBadgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 140" width="100%" height="100%">
  <defs>
    <linearGradient id="miiBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0F172A"/>
      <stop offset="100%" stop-color="#060B14"/>
    </linearGradient>
    <linearGradient id="miiBorder" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FF9933"/>
      <stop offset="50%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#138808"/>
    </linearGradient>
    <linearGradient id="lionGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FDBA74"/>
      <stop offset="50%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#86EFAC"/>
    </linearGradient>
  </defs>

  <!-- Container Box with Glass Effect -->
  <rect x="2" y="2" width="516" height="136" rx="16" fill="url(#miiBg)" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>

  <!-- Top Tricolor Ribbon -->
  <path d="M 18 2 L 502 2" stroke="url(#miiBorder)" stroke-width="3.5" stroke-linecap="round"/>

  <!-- Mechanical Gear Lion Emblem -->
  <g transform="translate(14, 5) scale(0.95)" color="#E2E8F0">
    ${lionGearSvg}
  </g>

  <!-- Typography: MAKE IN INDIA -->
  <g transform="translate(235, 20)">
    <!-- Main Title -->
    <text x="0" y="32" font-family="'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="28" letter-spacing="3" fill="#FFFFFF">
      MAKE IN INDIA
    </text>

    <!-- Tricolor underline bar -->
    <g transform="translate(2, 42)">
      <rect x="0" y="0" width="85" height="4" rx="2" fill="#FF9933"/>
      <rect x="88" y="0" width="85" height="4" rx="2" fill="#FFFFFF"/>
      <rect x="176" y="0" width="85" height="4" rx="2" fill="#138808"/>
      <!-- Ashoka blue dot / wheel in center -->
      <circle cx="130.5" cy="2" r="3.5" fill="#000080" stroke="#FFFFFF" stroke-width="1"/>
    </g>

    <!-- Subtitle / Developer Info -->
    <text x="0" y="66" font-family="'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700" font-size="13" letter-spacing="0.5" fill="#38BDF8">
      DEVELOPED BY NARI IOT SOLUTIONS COMPANY
    </text>

    <!-- Capabilities / Heritage -->
    <text x="0" y="86" font-family="'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="500" font-size="11.5" fill="#94A3B8">
      Hardware PCB • Embedded Firmware • Mobile &amp; Cloud Platform
    </text>
    <text x="0" y="103" font-family="'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="500" font-size="11" fill="#64748B">
      Engineered &amp; Manufactured in India for Global Reliability
    </text>
  </g>
</svg>`;

// 2. Compact Make in India Emblem SVG (for headers and pills)
const compactBadgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 130" width="100%" height="100%">
  <g color="#F8FAFC">
    ${lionGearSvg}
  </g>
</svg>`;

// Write to icons/make-in-india-badge.svg and icons/make-in-india.svg
const iconsDir = path.resolve(__dirname, '../icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

fs.writeFileSync(path.join(iconsDir, 'make-in-india-badge.svg'), fullBadgeSvg.trim(), 'utf8');
fs.writeFileSync(path.join(iconsDir, 'make-in-india-lion.svg'), compactBadgeSvg.trim(), 'utf8');

console.log('Saved icons/make-in-india-badge.svg and icons/make-in-india-lion.svg');

