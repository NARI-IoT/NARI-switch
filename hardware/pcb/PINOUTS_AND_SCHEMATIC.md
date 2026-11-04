# NARI Smart Switch — ESP32-C3 SuperMini 2-Relay PCB Hardware Specification

Complete Pinout, Schematic, Netlist, and PCB Fabrication Guide for 2-Relay Smart Switch with IR Blaster, IR Learning Receiver, Dual Touch / Rocker Switches, Piezo Acoustic Engine, and BLE Proximity.

---

## 1. Component Pinouts & Visual Diagrams

### 1.1 ESP32-C3 SuperMini Pinout (Top View)
```text
                 +-------------------+
                 |    [ USB-C Port ] |
                 +-------------------+
            5V --| 1  (5V)    (IO5) 9 |-- GPIO 5 (Relay 1 Control - Active LOW)
           GND --| 2  (GND)   (IO6)10 |-- GPIO 6 (Relay 2 Control - Active LOW)
          3.3V --| 3  (3V3)   (IO7)11 |-- GPIO 7 (Piezo Buzzer / Speaker PWM)
        GPIO 0 --| 4  (IO0)   (IO8)12 |-- GPIO 8 (Onboard Status LED - Active LOW)
        GPIO 1 --| 5  (IO1)   (IO9)13 |-- GPIO 9 (BOOT Key / Pull-up)
     (Aux)IO 2 --| 6  (IO2)  (IO10)14 |-- GPIO 10 (Auxiliary)
        GPIO 3 --| 7  (IO3)  (IO20)15 |-- GPIO 20 (UART RX)
        GPIO 4 --| 8  (IO4)  (IO21)16 |-- GPIO 21 (UART TX)
                 +-------------------+
```
* **Pin 1 (5V / VIN):** Power input from HLK-5M05 +5V DC rail.
* **Pin 2 (GND):** Common Ground plane.
* **Pin 3 (3.3V):** Regulated 3.3V output from onboard LDO (powers Touch sensors & IR Receiver).
* **Pin 4 (GPIO 0):** Input for Touch Switch 1 / Wall Switch 1 (internal pull-up).
* **Pin 5 (GPIO 1):** Input for Touch Switch 2 / Wall Switch 2 (internal pull-up).
* **Pin 7 (GPIO 3):** Input from VS1838B 38kHz IR Receiver Data pin.
* **Pin 8 (GPIO 4):** Output to 2N2222 Base via 1kΩ resistor (drives 940nm IR Blaster LED).
* **Pin 9 (GPIO 5):** Output to Relay Module IN1 (Active LOW).
* **Pin 10 (GPIO 6):** Output to Relay Module IN2 (Active LOW).
* **Pin 11 (GPIO 7):** Output to Piezo Buzzer (+) pin.

---

### 1.2 HL-52S 2-Channel Relay Module Pinout
```text
     Low-Voltage Control Header (4-Pin)           Opto-Isolation Jumper (3-Pin)
        +-----------------------------+               +---------------+
        | [GND]  [IN1]  [IN2]  [VCC]  |               | [JD-VCC] [VCC] [GND] |
        +-----------------------------+               +---------------+
           |       |      |      |                         |       |
          GND    GPIO5  GPIO6   +5V                     (Jumper shorted for 5V single supply)

     High-Voltage AC Screw Terminals (Output)
        Relay 1: [ NO1 ]   [ COM1 ]   [ NC1 ]
        Relay 2: [ NO2 ]   [ COM2 ]   [ NC2 ]
```
* **VCC:** Connect to +5V DC Rail.
* **GND:** Connect to GND.
* **IN1:** Connect to ESP32-C3 `GPIO 5`.
* **IN2:** Connect to ESP32-C3 `GPIO 6`.
* **COM1 & COM2:** Connect to AC Mains Phase / Live wire (L_IN).
* **NO1 (Normally Open 1):** Connect to Appliance 1 Phase (Light 1 / Fan).
* **NO2 (Normally Open 2):** Connect to Appliance 2 Phase (Light 2 / Socket).

---

### 1.3 HI-LINK HLK-5M05 AC-to-DC Isolated Power Supply
```text
           AC MAINS INPUT (High Voltage)
             +-----------------------+
             | [AC/L]         [AC/N] |
             |                       |
             |       HLK-5M05        |
             |      (Isolated)       |
             |                       |
             | [-Vo/GND]   [+Vo/+5V] |
             +-----------------------+
            DC REGULATED OUTPUT (Low Voltage)
```
* **AC / L (Live):** 230V / 110V AC input via 1A Slow-Blow Fuse (F1) and 10D471K Varistor (MOV1).
* **AC / N (Neutral):** Mains Neutral line.
* **-Vo (GND):** DC 0V Common Ground.
* **+Vo (+5V):** DC +5V Regulated output (1000mA / 5W max).
  * Filter with 470µF 16V electrolytic capacitor + 100nF ceramic capacitor across +5V and GND.

---

### 1.4 TTP223 Capacitive Touch Switch Modules (TS1 & TS2)
```text
           +---------------+
           |     TTP223    |
           | [VCC][GND][IO]|
           +---------------+
              |    |    |
            3.3V  GND  GPIO 0 (TS1) or GPIO 1 (TS2)
```
* **VCC:** Connect to ESP32-C3 **3.3V** pin.
* **GND:** Connect to Common GND.
* **IO / OUT:**
  * Touch 1 `IO` $\rightarrow$ ESP32-C3 `GPIO 0`
  * Touch 2 `IO` $\rightarrow$ ESP32-C3 `GPIO 1`
* **Jumper Settings:** Leave A and B open (Momentary, Active HIGH output).
*(If using standard Indian mechanical rocker switches instead, connect one terminal of the switch to GND and the other terminal to GPIO 0 / GPIO 1).*

---

### 1.5 940nm IR Blaster with 2N2222 NPN Transistor
```text
               +5V DC Rail
                    |
                 [R2: 39Ω - 47Ω, 1/2W]
                    |
                 (Anode / + Long Leg)
                [ 940nm IR LED ]
                (Cathode / - Short Leg Flat)
                    |
                    +---- Collector (Pin 3)
                            |
   GPIO 4 ---[ R1: 1kΩ ]-- Base (Pin 2)  [ 2N2222 NPN ]
                            |
                         Emitter (Pin 1)
                            |
                           GND
```
* **2N2222 Pinout (TO-92 Package, Flat face facing you):**
  * Pin 1 (Left): **Emitter (E)** $\rightarrow$ GND
  * Pin 2 (Middle): **Base (B)** $\rightarrow$ 1kΩ Resistor $\rightarrow$ ESP32-C3 `GPIO 4`
  * Pin 3 (Right): **Collector (C)** $\rightarrow$ IR LED Cathode (-)
* Peak Pulse Current: $\approx 85\text{ mA}$ at 38 kHz carrier frequency (provides 7–10 meters range).

---

### 1.6 VS1838B 38kHz IR Receiver (Remote Learning Sensor)
```text
                 [Metal Shield / Dome Face]
                 +------------------------+
                 |        VS1838B         |
                 +------------------------+
                     |        |        |
                   Pin 1    Pin 2    Pin 3
                   (OUT)    (GND)    (VCC)
                     |        |        |
                  GPIO 3     GND    [R3: 100Ω] --- 3.3V Rail
                              |        |
                              +---[C2: 10µF + C3: 100nF]---+
```
* **Pin 1 (Left):** `OUT` (Signal) $\rightarrow$ ESP32-C3 `GPIO 3`
* **Pin 2 (Middle):** `GND` $\rightarrow$ Common GND
* **Pin 3 (Right):** `VCC` $\rightarrow$ 100Ω Resistor $\rightarrow$ 3.3V Rail (with 10µF smoothing cap to GND to isolate sensor from Wi-Fi RF noise).

---

### 1.7 Piezo Buzzer / Speaker (GPIO 7)
```text
   ESP32-C3 GPIO 7 ----(+) [ Piezo Buzzer ] (-)---- GND
```
* Generates non-blocking acoustic feedback chimes for relay toggles, pairing, remote code confirmation, and timer expiry.

---

## 2. Complete Net-by-Net Wiring Table

| Net Name | From (Source Pin) | To (Destination Pins) | Function / Notes |
| :--- | :--- | :--- | :--- |
| **AC_LIVE_IN** | Screw Terminal TB1 (L) | Fuse F1 $\rightarrow$ MOV1 (Pin 1), Relay COM1, Relay COM2, HLK-5M05 (AC-L) | 230V AC Phase |
| **AC_NEUT_IN** | Screw Terminal TB1 (N) | MOV1 (Pin 2), HLK-5M05 (AC-N) | 230V AC Neutral |
| **RELAY1_OUT** | HL-52S NO1 | Screw Terminal TB2 (L1) | Switched 230V to Appliance 1 |
| **RELAY2_OUT** | HL-52S NO2 | Screw Terminal TB2 (L2) | Switched 230V to Appliance 2 |
| **+5V_DC** | HLK-5M05 (+Vo) | C1 (+), ESP32-C3 (Pin 1 / 5V), HL-52S (VCC & JD-VCC), R2 (IR Blaster) | Main 5V DC Power Rail |
| **GND** | HLK-5M05 (-Vo) | C1 (-), C2 (-), C3 (-), C4 (-), ESP32-C3 (Pin 2 / GND), HL-52S (GND), TS1 (GND), TS2 (GND), VS1838B (Pin 2), 2N2222 (Pin 1 / E), Buzzer (-) | Master Ground Plane |
| **+3.3V_DC** | ESP32-C3 (Pin 3 / 3V3) | TS1 (VCC), TS2 (VCC), R3 (VS1838B Filter), C4 (+) | Regulated 3.3V Rail |
| **TOUCH1_NET** | ESP32-C3 (Pin 4 / GPIO 0) | TS1 (IO / OUT) | Channel 1 Touch / Rocker |
| **TOUCH2_NET** | ESP32-C3 (Pin 5 / GPIO 1) | TS2 (IO / OUT) | Channel 2 Touch / Rocker |
| **IR_RECV_NET** | ESP32-C3 (Pin 7 / GPIO 3) | VS1838B (Pin 1 / OUT) | 38kHz Photoreceiver Demodulator |
| **IR_SEND_NET** | ESP32-C3 (Pin 8 / GPIO 4) | R1 (1kΩ) $\rightarrow$ 2N2222 (Pin 2 / Base) | 940nm High-Power IR Driver |
| **RELAY1_TRIG** | ESP32-C3 (Pin 9 / GPIO 5) | HL-52S (IN1) | Active LOW Relay 1 Trigger |
| **RELAY2_TRIG** | ESP32-C3 (Pin 10 / GPIO 6) | HL-52S (IN2) | Active LOW Relay 2 Trigger |
| **BUZZER_NET** | ESP32-C3 (Pin 11 / GPIO 7) | Piezo Buzzer (+) | Acoustic Feedback Chime |

---

## 3. High-Voltage AC Mains Safety & PCB Layout Rules

> [!CAUTION]
> **AC Mains Safety Distance (Creepage & Clearance):**
> * Maintain a minimum of **6.0 mm creepage distance** between the 230V AC traces (Live & Neutral) and the low-voltage DC traces (5V, 3.3V, GND, GPIOs).
> * **Isolation Milling Slot:** Place a routed air slot (**1.5mm to 2.0mm wide**) on the PCB between the high-voltage AC side of the HLK-5M05 / Relays and the low-voltage microcontroller circuitry.
> * **Trace Width for Relays:** High-voltage traces carrying up to 10A must be at least **2.5mm to 3.0mm wide** (with top and bottom solder-mask windows opened for manual solder tinning to increase current capacity and minimize heat).
> * **Fuse & MOV:** The 1A slow-blow fuse (F1) and 10D471K MOV (MOV1) are mandatory to prevent fire during power surges or short circuits.

