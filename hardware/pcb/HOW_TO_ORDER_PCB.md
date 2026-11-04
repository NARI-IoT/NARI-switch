# How to Order Your NARI Smart Switch PCB

Follow this quick guide to manufacture your custom PCB on **JLCPCB**, **PCBWay**, or **LionCircuits** (India).

---

## 1. Ready-to-Order Gerber Package

You do **not** need to generate anything manually. The production Gerber ZIP file is ready in this workspace:

📁 **File path:** [`e:\NARI-switch\hardware\pcb\NARI_ESP32C3_2RELAY_GERBER.zip`](file:///e:/NARI-switch/hardware/pcb/NARI_ESP32C3_2RELAY_GERBER.zip)

This ZIP contains all 7 industry-standard manufacturing files:
* `Gerber_TopCopper.gtl` (Top signal layer: 3.3V, GPIOs, IR driver)
* `Gerber_BottomCopper.gbl` (Bottom layer: heavy 2.5mm AC 230V mains traces + DC 5V ground bus)
* `Gerber_TopSolderMask.gts` (Top solder mask openings)
* `Gerber_BottomSolderMask.gbs` (Bottom solder mask + exposed tinning windows for AC high-current reinforcement)
* `Gerber_TopSilkscreen.gto` (Top component labels, pin names, and high-voltage warnings)
* `Gerber_BoardOutline.gko` (Board perimeter: 70mm × 50mm with 1.5mm high-voltage isolation routed slot)
* `Drill_PlatedThroughHole.drl` (Excellon NC drill file for all header pins, terminals, and M3 mounting holes)

---

## 2. Step-by-Step Order Instructions (JLCPCB Example)

1. Open **[jlcpcb.com](https://jlcpcb.com)** (or **[lioncircuits.com](https://www.lioncircuits.com)** for fast domestic delivery within India).
2. Click **"Add Gerber file"** and select `NARI_ESP32C3_2RELAY_GERBER.zip`.
3. The online Gerber viewer will automatically detect the board:
   * **Dimensions:** `70.0 mm × 50.0 mm`
   * **Layers:** `2 Layers`
4. Set the following fabrication parameters:
   * **Base Material:** FR-4 Standard
   * **PCB Thickness:** `1.6 mm`
   * **PCB Color / Solder Mask:** Blue (Matches NARI theme), Matte Black, or Green
   * **Surface Finish:** `HASL with lead` (Cheapest & easiest to hand solder) or `Lead Free HASL`
   * **Copper Weight:** `1 oz` (Standard) or `2 oz` (Recommended if continuously powering 10A heavy appliances like geysers/heaters)
   * **Gold Fingers / Castellated Holes:** No
   * **Remove Order Number:** Specify "Yes" if you prefer a clean board without factory tracking text
5. Click **Save to Cart** and proceed to checkout ($2 for 5 boards on JLCPCB).

---

## 3. High-Voltage Electrical Safety Notice

> [!IMPORTANT]
> * **Isolation Air Gap:** This PCB includes a physical **1.5mm routed air gap** separating the 230V AC mains side from the low-voltage ESP32-C3 microcontroller.
> * **Mains Reinforcement:** On the bottom side of the PCB, the 230V copper traces have solder-mask windows opened. Before mounting in a wall box, apply a bead of solder along these copper tracks to increase their current capacity up to 10A.
> * **Protection Components:** Always install the 1A slow-blow fuse (`F1`) and the 10D471K varistor (`MOV1`) across Live and Neutral.

