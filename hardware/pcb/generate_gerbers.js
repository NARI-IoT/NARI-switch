/**
 * NARI Smart Switch — ESP32-C3 SuperMini 2-Relay PCB Gerber Generator
 * Generates standard RS-274X Gerber & Excellon Drill files for JLCPCB / PCBWay / LionCircuits.
 *
 * Board Dimensions: 70.0mm x 50.0mm (2-Layer FR-4, 1.6mm thickness)
 * Target Box: Standard Indian Modular Gang Box / 2-Module Concealed Switchboard
 */

const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, 'gerbers');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function fmt(n) {
  // 4.4 format in mm (scaled by 10000)
  const val = Math.round(n * 10000);
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val).toString().padStart(8, '0');
  return sign + abs;
}

function gerberHeader(layerName) {
  return [
    `G04 Layer: ${layerName}*`,
    `G04 Generator: NARI Smart Switch PCB Engine v2.2.0*`,
    `%FSLAX44Y44*%`,
    `%MOMM*%`,
    `%LPD*%`,
    `G01*`,
    `G75*`
  ].join('\n') + '\n';
}

// -------------------------------------------------------------
// Component Pin & Pad Locations (in mm)
// -------------------------------------------------------------
const pads = [];
const drills = [];
const tracksTop = [];
const tracksBottom = [];
const silksTop = [];

function addRoundPad(x, y, drillMm, padMm, net, isMains = false) {
  pads.push({ x, y, padMm, net, isMains, shape: 'round' });
  drills.push({ x, y, drillMm, net });
}

function addSquarePad(x, y, drillMm, padMm, net, isMains = false) {
  pads.push({ x, y, padMm, net, isMains, shape: 'square' });
  drills.push({ x, y, drillMm, net });
}

function addTrackTop(x1, y1, x2, y2, widthMm) {
  tracksTop.push({ x1, y1, x2, y2, widthMm });
}

function addTrackBottom(x1, y1, x2, y2, widthMm) {
  tracksBottom.push({ x1, y1, x2, y2, widthMm });
}

function addSilkLine(x1, y1, x2, y2) {
  silksTop.push({ type: 'line', x1, y1, x2, y2 });
}

function addSilkText(x, y, text) {
  silksTop.push({ type: 'text', x, y, text });
}

// 1. Board Outline: 70 x 50 mm, M3 Mounting Holes at corners
const mountingHoles = [
  { x: 4.0, y: 4.0 },
  { x: 66.0, y: 4.0 },
  { x: 4.0, y: 46.0 },
  { x: 66.0, y: 46.0 }
];
mountingHoles.forEach(h => {
  addRoundPad(h.x, h.y, 3.2, 5.5, 'MOUNT');
});

// 2. High-Voltage Section (Left)
// TB1: AC Mains 230V Input (Phase, Neutral) - 5.08mm Pitch
addSquarePad(8.0, 10.0, 1.4, 3.2, 'AC_L', true);
addRoundPad(8.0, 15.08, 1.4, 3.2, 'AC_N', true);

// F1: 1A Slow-Blow Fuse (TR5 / 5.08mm pitch)
addRoundPad(14.0, 10.0, 1.0, 2.2, 'AC_L', true);
addRoundPad(19.08, 10.0, 1.0, 2.2, 'AC_FUSED_L', true);

// MOV1: 10D471K Varistor (7.5mm pitch)
addRoundPad(19.08, 15.08, 1.0, 2.4, 'AC_N', true);
addRoundPad(19.08, 22.58, 1.0, 2.4, 'AC_FUSED_L', true);

// U2: HI-LINK HLK-5M05 Isolated AC-DC 5V Module
// AC Input Pins:
addRoundPad(8.0, 25.0, 1.2, 2.6, 'AC_FUSED_L', true);
addRoundPad(8.0, 35.0, 1.2, 2.6, 'AC_N', true);
// DC Output Pins:
addRoundPad(28.0, 25.0, 1.2, 2.6, '+5V', false);
addRoundPad(28.0, 35.0, 1.2, 2.6, 'GND', false);

// TB2: High-Voltage Output Screw Terminals (Appliance 1, Appliance 2, AC Live COM)
addSquarePad(8.0, 42.0, 1.4, 3.2, 'RELAY1_NO', true);
addRoundPad(13.08, 42.0, 1.4, 3.2, 'RELAY2_NO', true);
addRoundPad(18.16, 42.0, 1.4, 3.2, 'AC_FUSED_L', true);

// 3. Low-Voltage Section (Right)
// K1: HL-52S Relay Control Header (4-pin 2.54mm: GND, IN1, IN2, VCC)
addSquarePad(35.0, 8.0, 1.0, 1.9, 'GND');
addRoundPad(35.0, 10.54, 1.0, 1.9, 'GPIO5_RELAY1');
addRoundPad(35.0, 13.08, 1.0, 1.9, 'GPIO6_RELAY2');
addRoundPad(35.0, 15.62, 1.0, 1.9, '+5V');

// C1: 470uF 16V Smoothing Capacitor (P=3.5mm)
addSquarePad(35.0, 21.0, 0.9, 2.0, '+5V');
addRoundPad(35.0, 24.5, 0.9, 2.0, 'GND');

// U1: ESP32-C3 SuperMini (2x8 pin headers, row distance 15.24mm / 600mil)
// Left Row: 5V, GND, 3V3, IO0, IO1, IO2, IO3, IO4
const c3LeftY = 8.0;
const leftPins = ['+5V', 'GND', '+3.3V', 'GPIO0_TOUCH1', 'GPIO1_TOUCH2', 'IO2_AUX', 'GPIO3_IRRECV', 'GPIO4_IRSEND'];
leftPins.forEach((net, idx) => {
  const y = c3LeftY + idx * 2.54;
  if (idx === 0) addSquarePad(43.0, y, 1.0, 1.85, net);
  else addRoundPad(43.0, y, 1.0, 1.85, net);
});

// Right Row: IO5 (Relay 1), IO6 (Relay 2), IO7 (Buzzer), IO8 (LED), IO9 (Boot), IO10, IO20, IO21
const rightPins = ['GPIO5_RELAY1', 'GPIO6_RELAY2', 'GPIO7_BUZZER', 'IO8_LED', 'IO9_BOOT', 'IO10_AUX', 'IO20_RX', 'IO21_TX'];
rightPins.forEach((net, idx) => {
  const y = c3LeftY + idx * 2.54;
  addRoundPad(58.24, y, 1.0, 1.85, net);
});

// TS1: Touch Switch 1 Header (3-pin 2.54mm: VCC 3.3V, GND, IO0)
addSquarePad(36.0, 32.0, 1.0, 1.85, '+3.3V');
addRoundPad(36.0, 34.54, 1.0, 1.85, 'GND');
addRoundPad(36.0, 37.08, 1.0, 1.85, 'GPIO0_TOUCH1');

// TS2: Touch Switch 2 Header (3-pin 2.54mm: VCC 3.3V, GND, IO1)
addSquarePad(44.0, 32.0, 1.0, 1.85, '+3.3V');
addRoundPad(44.0, 34.54, 1.0, 1.85, 'GND');
addRoundPad(44.0, 37.08, 1.0, 1.85, 'GPIO1_TOUCH2');

// U3: VS1838B 38kHz IR Receiver (3-pin 2.54mm: OUT, GND, VCC)
addSquarePad(52.0, 32.0, 1.0, 1.85, 'GPIO3_IRRECV');
addRoundPad(52.0, 34.54, 1.0, 1.85, 'GND');
addRoundPad(52.0, 37.08, 1.0, 1.85, '+3.3V');

// BZ1: Piezo Buzzer (5.0mm pitch)
addSquarePad(62.0, 32.0, 1.0, 2.0, 'GPIO7_BUZZER');
addRoundPad(62.0, 37.0, 1.0, 2.0, 'GND');

// IR Blaster: Q1 2N2222 (TO-92, 1=E, 2=B, 3=C), D1 940nm IR LED, R1 (1k), R2 (47R)
// R1 (1k)
addRoundPad(62.0, 10.0, 0.9, 1.8, 'GPIO4_IRSEND');
addRoundPad(62.0, 15.0, 0.9, 1.8, 'Q1_BASE');
// Q1 (2N2222)
addRoundPad(65.0, 13.0, 0.9, 1.8, 'GND'); // Emitter
addRoundPad(65.0, 15.0, 0.9, 1.8, 'Q1_BASE'); // Base
addRoundPad(65.0, 17.0, 0.9, 1.8, 'IR_COLLECTOR'); // Collector
// D1 (940nm IR LED)
addSquarePad(65.0, 22.0, 0.9, 1.9, 'IR_ANODE'); // Anode (+)
addRoundPad(65.0, 24.54, 0.9, 1.9, 'IR_COLLECTOR'); // Cathode (-)
// R2 (47R 1/2W)
addRoundPad(62.0, 22.0, 0.9, 1.8, '+5V');
addRoundPad(62.0, 27.0, 0.9, 1.8, 'IR_ANODE');

// -------------------------------------------------------------
// Copper Routing (Traces)
// -------------------------------------------------------------
// Bottom Layer: AC Mains 2.5mm heavy tracks
addTrackBottom(8.0, 10.0, 14.0, 10.0, 2.5); // AC_L to Fuse F1
addTrackBottom(19.08, 10.0, 19.08, 22.58, 2.5); // Fused AC_L to MOV1
addTrackBottom(19.08, 10.0, 8.0, 25.0, 2.5); // Fused AC_L to HLK-5M05
addTrackBottom(8.0, 25.0, 18.16, 42.0, 2.5); // Fused AC_L to Relay COM
addTrackBottom(8.0, 15.08, 19.08, 15.08, 2.5); // AC_N to MOV1
addTrackBottom(19.08, 15.08, 8.0, 35.0, 2.5); // AC_N to HLK-5M05

// Bottom Layer: DC 5V Rail & GND Bus (1.2mm)
addTrackBottom(28.0, 25.0, 35.0, 21.0, 1.2); // HLK +5V to C1
addTrackBottom(35.0, 21.0, 43.0, 8.0, 1.2);  // C1 +5V to ESP32 Pin 1
addTrackBottom(35.0, 21.0, 35.0, 15.62, 1.2);// +5V to K1 Relay VCC
addTrackBottom(28.0, 35.0, 35.0, 24.5, 1.2); // HLK GND to C1
addTrackBottom(35.0, 24.5, 43.0, 10.54, 1.2);// C1 GND to ESP32 Pin 2
addTrackBottom(43.0, 10.54, 35.0, 8.0, 1.2); // GND to K1 GND

// Top Layer: Low-Voltage Signals (0.35mm)
addTrackTop(58.24, 8.0, 35.0, 10.54, 0.4); // GPIO 5 to Relay IN1
addTrackTop(58.24, 10.54, 35.0, 13.08, 0.4);// GPIO 6 to Relay IN2
addTrackTop(43.0, 15.62, 36.0, 37.08, 0.35);// GPIO 0 to TS1
addTrackTop(43.0, 18.16, 44.0, 37.08, 0.35);// GPIO 1 to TS2
addTrackTop(43.0, 23.24, 52.0, 32.0, 0.35); // GPIO 3 to VS1838B OUT
addTrackTop(43.0, 25.78, 62.0, 10.0, 0.35); // GPIO 4 to R1 (IR Base)
addTrackTop(58.24, 13.08, 62.0, 32.0, 0.4); // GPIO 7 to Buzzer (+)

addTrackTop(43.0, 13.08, 36.0, 32.0, 0.5);  // 3.3V to TS1 VCC
addTrackTop(36.0, 32.0, 44.0, 32.0, 0.5);   // 3.3V to TS2 VCC
addTrackTop(44.0, 32.0, 52.0, 37.08, 0.5);  // 3.3V to VS1838B VCC

addTrackTop(62.0, 15.0, 65.0, 15.0, 0.35);  // R1 to 2N2222 Base
addTrackTop(65.0, 17.0, 65.0, 24.54, 0.5);  // 2N2222 Collector to IR LED Cathode
addTrackTop(62.0, 27.0, 65.0, 22.0, 0.5);   // R2 to IR LED Anode
addTrackTop(35.0, 15.62, 62.0, 22.0, 0.8);  // +5V to R2

// Silkscreen Graphics (Top)
// Board borders:
addSilkLine(1.0, 1.0, 69.0, 1.0);
addSilkLine(69.0, 1.0, 69.0, 49.0);
addSilkLine(69.0, 49.0, 1.0, 49.0);
addSilkLine(1.0, 49.0, 1.0, 1.0);

// High-Voltage Barrier Line:
addSilkLine(30.0, 1.5, 30.0, 48.5);

// Component Silkscreen Boxes
addSilkLine(5.0, 21.0, 30.0, 21.0); // HLK Box
addSilkLine(5.0, 39.0, 30.0, 39.0);
addSilkLine(5.0, 21.0, 5.0, 39.0);
addSilkLine(30.0, 21.0, 30.0, 39.0);

addSilkLine(41.0, 6.0, 60.0, 6.0);   // ESP32 Box
addSilkLine(41.0, 30.0, 60.0, 30.0);
addSilkLine(41.0, 6.0, 41.0, 30.0);
addSilkLine(60.0, 6.0, 60.0, 30.0);

// Text labels:
addSilkText(7.0, 4.0, "AC 230V IN");
addSilkText(7.0, 46.0, "OUT: L1 L2 COM");
addSilkText(9.0, 23.0, "HLK-5M05 5W");
addSilkText(32.5, 3.0, "HIGH VOLTAGE ISOLATION");
addSilkText(43.5, 4.0, "ESP32-C3 SUPERMINI");
addSilkText(34.0, 41.0, "TS1");
addSilkText(42.0, 41.0, "TS2");
addSilkText(50.0, 41.0, "IR-RX");
addSilkText(59.0, 41.0, "BUZZER");
addSilkText(61.0, 28.5, "940nm IR");
addSilkText(33.0, 18.0, "RELAY-HDR");
addSilkText(38.0, 47.0, "NARI SMART SWITCH v2.2");

// -------------------------------------------------------------
// Gerber File Writers
// -------------------------------------------------------------
// 1. Edge Cuts / Mechanical Outline (GKO)
function generateGKO() {
  let gko = gerberHeader('Edge.Cuts (Board Outline & Slots)');
  gko += `%ADD10C,0.150000*%\n`;
  gko += `D10*\n`;
  // Outer 70x50 outline
  gko += `X${fmt(0)}Y${fmt(0)}D02*\n`;
  gko += `X${fmt(70)}Y${fmt(0)}D01*\n`;
  gko += `X${fmt(70)}Y${fmt(50)}D01*\n`;
  gko += `X${fmt(0)}Y${fmt(50)}D01*\n`;
  gko += `X${fmt(0)}Y${fmt(0)}D01*\n`;

  // Creepage Isolation Slot: 1.5mm wide routed slot between AC and DC sides (X=30.5mm, Y=5mm to 45mm)
  gko += `%ADD11C,1.500000*%\n`;
  gko += `D11*\n`;
  gko += `X${fmt(30.5)}Y${fmt(6.0)}D02*\n`;
  gko += `X${fmt(30.5)}Y${fmt(23.0)}D01*\n`;
  gko += `X${fmt(30.5)}Y${fmt(27.0)}D02*\n`;
  gko += `X${fmt(30.5)}Y${fmt(44.0)}D01*\n`;

  gko += `M02*\n`;
  return gko;
}

// 2. Copper Layers (GTL & GBL)
function generateCopper(isTop) {
  let gbr = gerberHeader(isTop ? 'Top Copper (F.Cu)' : 'Bottom Copper (B.Cu)');
  gbr += `%ADD10C,0.350000*%\n`; // Normal signal
  gbr += `%ADD11C,0.500000*%\n`; // Medium power
  gbr += `%ADD12C,1.200000*%\n`; // DC bus
  gbr += `%ADD13C,2.500000*%\n`; // High-voltage mains
  gbr += `%ADD20C,1.850000*%\n`; // Standard round pad
  gbr += `%ADD21R,1.850000X1.850000*%\n`; // Square pin 1 pad
  gbr += `%ADD22C,2.600000*%\n`; // HLK pad
  gbr += `%ADD23C,3.200000*%\n`; // Screw terminal pad round
  gbr += `%ADD24R,3.200000X3.200000*%\n`; // Screw terminal pad square
  gbr += `%ADD25C,5.500000*%\n`; // Mount hole pad

  // Flash pads
  pads.forEach(p => {
    let ap = 'D20';
    if (p.shape === 'square') {
      ap = p.padMm >= 3.0 ? 'D24' : 'D21';
    } else {
      if (p.padMm >= 5.0) ap = 'D25';
      else if (p.padMm >= 3.0) ap = 'D23';
      else if (p.padMm >= 2.4) ap = 'D22';
      else ap = 'D20';
    }
    gbr += `${ap}*\n`;
    gbr += `X${fmt(p.x)}Y${fmt(p.y)}D03*\n`;
  });

  // Draw traces
  const tracks = isTop ? tracksTop : tracksBottom;
  tracks.forEach(t => {
    let ap = 'D10';
    if (t.widthMm >= 2.0) ap = 'D13';
    else if (t.widthMm >= 1.0) ap = 'D12';
    else if (t.widthMm >= 0.45) ap = 'D11';
    gbr += `${ap}*\n`;
    gbr += `X${fmt(t.x1)}Y${fmt(t.y1)}D02*\n`;
    gbr += `X${fmt(t.x2)}Y${fmt(t.y2)}D01*\n`;
  });

  gbr += `M02*\n`;
  return gbr;
}

// 3. Solder Mask (GTS & GBS)
function generateMask(isTop) {
  let gbr = gerberHeader(isTop ? 'Top Solder Mask (F.Mask)' : 'Bottom Solder Mask (B.Mask)');
  gbr += `%ADD20C,2.050000*%\n`; // +0.2mm mask clearance
  gbr += `%ADD21R,2.050000X2.050000*%\n`;
  gbr += `%ADD22C,2.800000*%\n`;
  gbr += `%ADD23C,3.400000*%\n`;
  gbr += `%ADD24R,3.400000X3.400000*%\n`;
  gbr += `%ADD25C,5.800000*%\n`;
  gbr += `%ADD26C,2.500000*%\n`; // AC Track window opening for solder tinning

  pads.forEach(p => {
    let ap = 'D20';
    if (p.shape === 'square') {
      ap = p.padMm >= 3.0 ? 'D24' : 'D21';
    } else {
      if (p.padMm >= 5.0) ap = 'D25';
      else if (p.padMm >= 3.0) ap = 'D23';
      else if (p.padMm >= 2.4) ap = 'D22';
      else ap = 'D20';
    }
    gbr += `${ap}*\n`;
    gbr += `X${fmt(p.x)}Y${fmt(p.y)}D03*\n`;
  });

  // On bottom mask, open windows over the 230V AC lines for manual solder tinning
  if (!isTop) {
    gbr += `D26*\n`;
    gbr += `X${fmt(8.0)}Y${fmt(10.0)}D02*\n`;
    gbr += `X${fmt(14.0)}Y${fmt(10.0)}D01*\n`;
    gbr += `X${fmt(8.0)}Y${fmt(25.0)}D02*\n`;
    gbr += `X${fmt(18.16)}Y${fmt(42.0)}D01*\n`;
  }

  gbr += `M02*\n`;
  return gbr;
}

// 4. Silkscreen (GTO)
function generateSilkscreen() {
  let gbr = gerberHeader('Top Silkscreen (F.SilkS)');
  gbr += `%ADD10C,0.180000*%\n`;
  gbr += `D10*\n`;

  silksTop.forEach(s => {
    if (s.type === 'line') {
      gbr += `X${fmt(s.x1)}Y${fmt(s.y1)}D02*\n`;
      gbr += `X${fmt(s.x2)}Y${fmt(s.y2)}D01*\n`;
    } else if (s.type === 'text') {
      // Stroke minimal text indicator box / underline
      const len = s.text.length * 1.5;
      gbr += `X${fmt(s.x)}Y${fmt(s.y)}D02*\n`;
      gbr += `X${fmt(s.x + len)}Y${fmt(s.y)}D01*\n`;
    }
  });

  gbr += `M02*\n`;
  return gbr;
}

// 5. Excellon Drill File (.DRL)
function generateDrill() {
  let drl = [
    'M48',
    'METRIC,TZ',
    'FMAT,2',
    'T01C0.900', // Small passives & transistors
    'T02C1.000', // Standard 2.54mm pin headers
    'T03C1.200', // HLK-5M05 pins
    'T04C1.400', // 5.08mm Screw terminals
    'T05C3.200', // M3 mounting holes
    '%'
  ].join('\n') + '\n';

  const groups = { '0.9': [], '1.0': [], '1.2': [], '1.4': [], '3.2': [] };
  drills.forEach(d => {
    let key = '1.0';
    if (d.drillMm <= 0.95) key = '0.9';
    else if (d.drillMm <= 1.1) key = '1.0';
    else if (d.drillMm <= 1.3) key = '1.2';
    else if (d.drillMm <= 1.6) key = '1.4';
    else key = '3.2';
    groups[key].push(d);
  });

  const toolMap = { '0.9': 'T01', '1.0': 'T02', '1.2': 'T03', '1.4': 'T04', '3.2': 'T05' };
  for (const [dia, pts] of Object.entries(groups)) {
    if (pts.length > 0) {
      drl += `${toolMap[dia]}*\n`;
      pts.forEach(p => {
        const xStr = Math.round(p.x * 100).toString().padStart(6, '0');
        const yStr = Math.round(p.y * 100).toString().padStart(6, '0');
        drl += `X${xStr}Y${yStr}\n`;
      });
    }
  }
  drl += 'M30\n';
  return drl;
}

// Write files with standard Protel / JLCPCB naming conventions
fs.writeFileSync(path.join(outDir, 'Gerber_TopCopper.gtl'), generateCopper(true));
fs.writeFileSync(path.join(outDir, 'Gerber_BottomCopper.gbl'), generateCopper(false));
fs.writeFileSync(path.join(outDir, 'Gerber_TopSolderMask.gts'), generateMask(true));
fs.writeFileSync(path.join(outDir, 'Gerber_BottomSolderMask.gbs'), generateMask(false));
fs.writeFileSync(path.join(outDir, 'Gerber_TopSilkscreen.gto'), generateSilkscreen());
fs.writeFileSync(path.join(outDir, 'Gerber_BoardOutline.gko'), generateGKO());
fs.writeFileSync(path.join(outDir, 'Drill_PlatedThroughHole.drl'), generateDrill());

console.log('Successfully generated all 7 RS-274X Gerber & Excellon Drill files in:', outDir);

