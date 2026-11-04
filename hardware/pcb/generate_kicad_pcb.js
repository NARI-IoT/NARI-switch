/**
 * Generates an official KiCad 7 / 8 PCB file (.kicad_pcb)
 * Can be opened in KiCad, or imported into EasyEDA with 1 click (File -> Import -> KiCad).
 */

const fs = require('fs');
const path = require('path');

const pcbPath = path.join(__dirname, 'nari_smart_switch.kicad_pcb');

const kicadHeader = `(kicad_pcb (version 20221018) (generator pcbnew)

  (general
    (thickness 1.6)
  )

  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (36 "B.SilkS" user "B.Silkscreen")
    (37 "F.SilkS" user "F.Silkscreen")
    (38 "B.Mask" user)
    (39 "F.Mask" user)
    (44 "Edge.Cuts" user)
  )

  (setup
    (pad_to_mask_clearance 0.05)
    (solder_mask_min_width 0.1)
  )

  (net 0 "")
  (net 1 "GND")
  (net 2 "+5V")
  (net 3 "+3.3V")
  (net 4 "GPIO0_TOUCH1")
  (net 5 "GPIO1_TOUCH2")
  (net 6 "GPIO3_IRRECV")
  (net 7 "GPIO4_IRSEND")
  (net 8 "GPIO5_RELAY1")
  (net 9 "GPIO6_RELAY2")
  (net 10 "GPIO7_BUZZER")
  (net 11 "AC_LIVE")
  (net 12 "AC_NEUTRAL")
  (net 13 "AC_FUSED")
  (net 14 "RELAY1_OUT")
  (net 15 "RELAY2_OUT")
`;

let body = '';

// Outline: 70x50 mm with 3mm rounded corners
body += `  (gr_rect (start 0 0) (end 70 50) (stroke (width 0.15) (type solid)) (layer "Edge.Cuts"))\n`;

// High-Voltage Isolation Slot (1.5mm wide cutout)
body += `  (gr_line (start 30.5 7.0) (end 30.5 23.0) (stroke (width 1.5) (type solid)) (layer "Edge.Cuts"))\n`;
body += `  (gr_line (start 30.5 27.0) (end 30.5 43.0) (stroke (width 1.5) (type solid)) (layer "Edge.Cuts"))\n`;

// Silkscreen Text
body += `  (gr_text "NARI SMART SWITCH v2.2.0" (at 52 47) (layer "F.SilkS") (effects (font (size 1.4 1.4) (thickness 0.2))))\n`;
body += `  (gr_text "CAUTION: 230V MAINS" (at 15 3.5) (layer "F.SilkS") (effects (font (size 1.2 1.2) (thickness 0.18))))\n`;
body += `  (gr_text "HLK-5M05 (5W)" (at 18 30) (layer "F.SilkS") (effects (font (size 1.4 1.4) (thickness 0.2))))\n`;
body += `  (gr_text "ESP32-C3 SUPERMINI" (at 50 7.5) (layer "F.SilkS") (effects (font (size 1.1 1.1) (thickness 0.18))))\n`;

// Footprints (Simplified KiCad modules)
// TB1: AC Mains Screw Terminal
body += `  (footprint "TerminalBlock:TerminalBlock_Phoenix_MKDS-1,5-2-5.08" (layer "F.Cu") (at 8 11.5)
    (fp_text reference "TB1" (at 0 -4.5) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" thru_hole rect (at 0 -2.54) (size 3.0 3.0) (drill 1.4) (layers *.Cu *.Mask) (net 11 "AC_LIVE"))
    (pad "2" thru_hole circle (at 0 2.54) (size 3.0 3.0) (drill 1.4) (layers *.Cu *.Mask) (net 12 "AC_NEUTRAL"))
  )\n`;

// TB2: AC Outputs Screw Terminal (L1, L2, COM)
body += `  (footprint "TerminalBlock:TerminalBlock_Phoenix_MKDS-1,5-3-5.08" (layer "F.Cu") (at 13.08 44)
    (fp_text reference "TB2" (at 0 4.5) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" thru_hole rect (at -5.08 0) (size 3.0 3.0) (drill 1.4) (layers *.Cu *.Mask) (net 14 "RELAY1_OUT"))
    (pad "2" thru_hole circle (at 0 0) (size 3.0 3.0) (drill 1.4) (layers *.Cu *.Mask) (net 15 "RELAY2_OUT"))
    (pad "3" thru_hole circle (at 5.08 0) (size 3.0 3.0) (drill 1.4) (layers *.Cu *.Mask) (net 13 "AC_FUSED"))
  )\n`;

// HLK-5M05 Module
body += `  (footprint "Converter_ACDC:Converter_ACDC_HiLink_HLK-5Mxx" (layer "F.Cu") (at 18 30)
    (fp_text reference "U2" (at 0 -11) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (fp_rect (start -12.5 -9) (end 12.5 9) (stroke (width 0.15) (type solid)) (layer "F.SilkS"))
    (pad "1" thru_hole circle (at -10 -6) (size 2.5 2.5) (drill 1.2) (layers *.Cu *.Mask) (net 13 "AC_FUSED"))
    (pad "2" thru_hole circle (at -10 6) (size 2.5 2.5) (drill 1.2) (layers *.Cu *.Mask) (net 12 "AC_NEUTRAL"))
    (pad "3" thru_hole circle (at 10 6) (size 2.5 2.5) (drill 1.2) (layers *.Cu *.Mask) (net 1 "GND"))
    (pad "4" thru_hole rect (at 10 -6) (size 2.5 2.5) (drill 1.2) (layers *.Cu *.Mask) (net 2 "+5V"))
  )\n`;

// ESP32-C3 SuperMini Socket (2x8 2.54mm headers)
body += `  (footprint "Module:ESP32-C3-SuperMini" (layer "F.Cu") (at 49.62 17.89)
    (fp_text reference "U1" (at 0 -10.5) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (fp_rect (start -9.12 -8.89) (end 9.12 10.5) (stroke (width 0.15) (type solid)) (layer "F.SilkS"))
`;

const leftPinNets = [2, 1, 3, 4, 5, 0, 6, 7];
for (let i = 0; i < 8; i++) {
  const y = -8.89 + i * 2.54;
  const netId = leftPinNets[i];
  body += `    (pad "${i+1}" thru_hole ${i===0?'rect':'circle'} (at -7.62 ${y.toFixed(2)}) (size 1.85 1.85) (drill 1.0) (layers *.Cu *.Mask) (net ${netId}))\n`;
}

const rightPinNets = [8, 9, 10, 0, 0, 0, 0, 0];
for (let i = 0; i < 8; i++) {
  const y = -8.89 + i * 2.54;
  const netId = rightPinNets[i];
  body += `    (pad "${i+9}" thru_hole circle (at 7.62 ${y.toFixed(2)}) (size 1.85 1.85) (drill 1.0) (layers *.Cu *.Mask) (net ${netId}))\n`;
}
body += `  )\n`;

// Relay Module Header (K1)
body += `  (footprint "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" (layer "F.Cu") (at 34 35.81)
    (fp_text reference "K1" (at -2 0 90) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" thru_hole rect (at 0 -3.81) (size 1.85 1.85) (drill 1.0) (layers *.Cu *.Mask) (net 1 "GND"))
    (pad "2" thru_hole circle (at 0 -1.27) (size 1.85 1.85) (drill 1.0) (layers *.Cu *.Mask) (net 8 "GPIO5_RELAY1"))
    (pad "3" thru_hole circle (at 0 1.27) (size 1.85 1.85) (drill 1.0) (layers *.Cu *.Mask) (net 9 "GPIO6_RELAY2"))
    (pad "4" thru_hole circle (at 0 3.81) (size 1.85 1.85) (drill 1.0) (layers *.Cu *.Mask) (net 2 "+5V"))
  )\n`;

// Touch 1 Header (TS1)
body += `  (footprint "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical" (layer "F.Cu") (at 42 37.54)
    (fp_text reference "TS1" (at 0 -3) (layer "F.SilkS") (effects (font (size 0.9 0.9) (thickness 0.15))))
    (pad "1" thru_hole rect (at 0 -2.54) (size 1.85 1.85) (drill 1.0) (layers *.Cu *.Mask) (net 3 "+3.3V"))
    (pad "2" thru_hole circle (at 0 0) (size 1.85 1.85) (drill 1.0) (layers *.Cu *.Mask) (net 1 "GND"))
    (pad "3" thru_hole circle (at 0 2.54) (size 1.85 1.85) (drill 1.0) (layers *.Cu *.Mask) (net 4 "GPIO0_TOUCH1"))
  )\n`;

// Touch 2 Header (TS2)
body += `  (footprint "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical" (layer "F.Cu") (at 48 37.54)
    (fp_text reference "TS2" (at 0 -3) (layer "F.SilkS") (effects (font (size 0.9 0.9) (thickness 0.15))))
    (pad "1" thru_hole rect (at 0 -2.54) (size 1.85 1.85) (drill 1.0) (layers *.Cu *.Mask) (net 3 "+3.3V"))
    (pad "2" thru_hole circle (at 0 0) (size 1.85 1.85) (drill 1.0) (layers *.Cu *.Mask) (net 1 "GND"))
    (pad "3" thru_hole circle (at 0 2.54) (size 1.85 1.85) (drill 1.0) (layers *.Cu *.Mask) (net 5 "GPIO1_TOUCH2"))
  )\n`;

// IR Receiver (U3)
body += `  (footprint "OptoDevice:IRReceiver_Vishay_CAST-3pin" (layer "F.Cu") (at 54 37.54)
    (fp_text reference "U3" (at 0 -3) (layer "F.SilkS") (effects (font (size 0.9 0.9) (thickness 0.15))))
    (pad "1" thru_hole rect (at 0 -2.54) (size 1.85 1.85) (drill 1.0) (layers *.Cu *.Mask) (net 6 "GPIO3_IRRECV"))
    (pad "2" thru_hole circle (at 0 0) (size 1.85 1.85) (drill 1.0) (layers *.Cu *.Mask) (net 1 "GND"))
    (pad "3" thru_hole circle (at 0 2.54) (size 1.85 1.85) (drill 1.0) (layers *.Cu *.Mask) (net 3 "+3.3V"))
  )\n`;

// Buzzer (BZ1)
body += `  (footprint "Buzzer_Beeper:Buzzer_12x9.5RM7.6" (layer "F.Cu") (at 62 37.5)
    (fp_text reference "BZ1" (at 0 -4) (layer "F.SilkS") (effects (font (size 0.9 0.9) (thickness 0.15))))
    (pad "1" thru_hole rect (at 0 -2.5) (size 2.0 2.0) (drill 1.0) (layers *.Cu *.Mask) (net 10 "GPIO7_BUZZER"))
    (pad "2" thru_hole circle (at 0 2.5) (size 2.0 2.0) (drill 1.0) (layers *.Cu *.Mask) (net 1 "GND"))
  )\n`;

// 4 Corner M3 Mounting Holes
const holes = [[3.5, 3.5], [66.5, 3.5], [3.5, 46.5], [66.5, 46.5]];
holes.forEach(([hx, hy], idx) => {
  body += `  (footprint "MountingHole:MountingHole_3.2mm_M3_Pad" (layer "F.Cu") (at ${hx} ${hy})
    (pad "1" thru_hole circle (at 0 0) (size 5.0 5.0) (drill 3.2) (layers *.Cu *.Mask))
  )\n`;
});

const fullKicad = kicadHeader + body + `)\n`;
fs.writeFileSync(pcbPath, fullKicad);
console.log('Successfully generated KiCad PCB:', pcbPath);

