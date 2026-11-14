# Dareu Mouse WebHID Protocol Wiki & Hardware Specification

Welcome to the **Dareu Peripheral WebHID Reverse-Engineering & Development Wiki**. This documentation covers the internal communication protocols, hardware register mappings, sensor control mechanisms, and onboard macro bytecode formats for Dareu mice (specifically the **A950 Air** and related models).

---

## Table of Contents

1. [Hardware Architecture Overview](#1-hardware-architecture-overview)
2. [Protocol Specifications](./protocols/)
   - [JieLi / JM Architecture (16-Byte Memory Mapped)](./protocols/jm-protocol.md)
   - [Telink / TG Architecture (64-Byte Command Classes)](./protocols/tg-protocol.md)
   - [Macro Bytecode & Multi-Button Chords](./protocols/macro-bytecode.md)
3. [Device Profiles](./devices/)
   - [Dareu A950 Air Specification](./devices/a950-air.md)
4. [WebHID Connection Guide](#2-webhid-connection-guide)
5. [Sensor Capabilities & Register Reference](#3-sensor-capabilities--register-reference)
6. [Why the Official Web Driver Has Limitations](#4-why-the-official-web-driver-has-limitations)

---

## 1. Hardware Architecture Overview

Dareu mice use two distinct embedded microcontroller architectures:

```
                  ┌────────────────────────────────────────┐
                  │          Host System (Browser)         │
                  │              WebHID API                │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
             ┌──────────────────────────────────────────────────┐
             │       Dareu USB / 2.4GHz Receiver (0x260D)       │
             └────────┬────────────────────────────────┬────────┘
                      │                                │
                      ▼                                ▼
       ┌──────────────────────────────┐ ┌──────────────────────────────┐
       │   JM (JieLi) Architecture    │ │   TG (Telink) Architecture   │
       │   - 16-Byte HID Reports      │ │   - 64-Byte HID Reports      │
       │   - Memory-Mapped NVRAM      │ │   - Command Class Protocol   │
       │   - e.g., A950 Air (TM275D), │ │   - e.g., A950 Air 8K/4K     │
       │     A950 Pro, A950G, CM610   │ │     (TM275F), A980, A980 Pro │
       └──────────────────────────────┘ └──────────────────────────────┘
```

---

## 2. WebHID Connection Guide

### USB Filters & Permissions
To connect via the WebHID API, Chromium browsers require matching `vendorId`, `usagePage`, and `usage`:

```javascript
const DAREU_DEVICE_FILTERS = [
  // Primary JM & TG command endpoint
  { vendorId: 0x260D, usagePage: 0xFF02, usage: 0x02 },
  // Self-developed firmware feature interface
  { vendorId: 0x260D, usagePage: 0x000C, usage: 0x01 },
  // Extended configuration endpoints
  { vendorId: 0x260D, usagePage: 0xFF01, usage: 0x00 },
  { vendorId: 0x260D, usagePage: 0xFFA0, usage: 0x01 },
  { vendorId: 0x260D, usagePage: 0xFF04, usage: 0x02 }
];

const [device] = await navigator.hid.requestDevice({ filters: DAREU_DEVICE_FILTERS });
await device.open();
```

---

## 3. Sensor Capabilities & Register Reference

| Feature | JM Buffer Address | TG Command Class | Values / Unit |
|---|---|---|---|
| **Lift-Off Distance (LOD)** | Buffer `10` | `CLASS_SENSOR` (`0x04`), Cmd `0x06` | `0` = 1.0mm, `1` = 2.0mm |
| **Angle Snapping** | Buffer `175` | `CLASS_SENSOR` (`0x04`), Cmd `0x0A` | `0` = Disabled, `1` = Enabled |
| **Motion Sync** | Buffer `171` | `CLASS_SENSOR` (`0x04`), Cmd `0x0A` | `0` = Disabled, `1` = Enabled |
| **Ripple Control** | Buffer `177` | `CLASS_SENSOR` (`0x04`), Cmd `0x0A` | `0` = Disabled, `1` = Enabled |
| **Debounce Latency** | Buffer `169` | `CLASS_BUTTON` (`0x02`), Cmd `0x02` | `1ms` to `20ms` |
| **Mode Select** | Buffer `185` | `CLASS_SENSOR` (`0x04`), Cmd `0x05` | HP / LP / Cord Mode |
| **Polling Rate** | Buffer `0` | `CLASS_DEVICE` (`0x00`), Cmd `0x02` | 125Hz to 8000Hz |
| **DPI Stages & Table** | Buffer `2` - `43` | `CLASS_SENSOR` (`0x04`), Cmd `0x03` | 1-8 stages, X/Y split |
| **Onboard Macros** | Buffer `768` + `384*idx` | `CLASS_MACRO` (`0x06`), Cmd `0x05` | Up to 16 hardware macros |

---

## 4. Hardware Macro Engine & Loop Modes

The Dareu JieLi MCU contains an onboard event interpreter that executes discrete bytecode tokens (`Make`, `Break`, `Delay`, `Wheel`) stored in Flash memory.

### Loop Mode Opcodes (Button NVRAM `0x0060`)

When a physical button is bound to an onboard macro (`0x06`), **Byte 2** of the button record sets the loop behavior:

| Opcode | Mode Name | Behavior & Termination Condition | Typical Use Case |
|---|---|---|---|
| **`255`** (`0xFF`) | **Toggle Loop (Same Key)** | Starts repeating when clicked. Loops continuously until the **exact same button** is clicked a second time. | Traditional Toggle on/off |
| **`254`** (`0xFE`) | **Hold Loop** | Repeats continuously **only while the physical button switch remains depressed**. Stops immediately upon release. | Auto-fire / Spam while holding |
| **`253`** (`0xFD`) | **Loop Until Interrupt (Any Key)** | Starts repeating when clicked. Loops continuously until **ANY other mouse button or keyboard key is pressed**. | Interruptible Auto-Run / Farming |
| **`1`–`250`** | **Fixed Repeat Count** | Executes the macro sequence exactly $N$ times upon a single button click, then stops. | Burst firing (e.g. 3-round burst) |

---

## 5. Physical Button Topology vs 8 Macro Slots

```
     8 ONBOARD MEMORY SLOTS                    5 PHYSICAL MOUSE SWITCHES
(Macro Storage Library in EEPROM)                 (Under Your Fingers)

┌───────────────────────────────┐
│ Slot 1: [ Rapid Fire (10 CPS) ] │                ┌──────────────────┐
├───────────────────────────────┤                │ Button 1 (Left)  │
│ Slot 2: [ Ctrl + C (Copy)     ] │                ├──────────────────┤
├───────────────────────────────┤                │ Button 2 (Right) │
│ Slot 3: [ Custom Middle Macro ] │ ─────────────► │ Button 3 (Wheel) │
├───────────────────────────────┤                ├──────────────────┤
│ Slot 4: [ Ctrl + V (Paste)    ] │ ─────────────► │ Button 4 (Back)  │
├───────────────────────────────┤                ├──────────────────┤
│ Slot 5: [ Shift + Left Click  ] │                │ Button 5 (Fwd)   │
├───────────────────────────────┤                └──────────────────┘
│ Slot 6: [ Enter / Confirm     ] │
├───────────────────────────────┤
│ Slot 7: [ F5 (Refresh)        ] │
├───────────────────────────────┤
│ Slot 8: [ Alt + Tab           ] │
└───────────────────────────────┘
```

1. **5 Physical Buttons on A950 AIR**: Left (1), Right (2), Middle (3), Back (4), Forward (5).
   > *Note*: The ultralight A950 AIR chassis removes the top DPI button behind the scroll wheel to minimize weight (~47g) and prevent accidental clicks during gaming.
2. **8 Macro Slots**: 8 independent 384-byte Flash partitions (`0x0300`–`0x0D80`) that store a library of macro sequences. Physical buttons act as pointers to any of these 8 slots.

---

## 6. Chording & Hotkey Shift-Layers (Hypershift)

A common requirement is **Chording / Shift-Layers** (e.g., holding Backward turns Left Click into a secondary macro).

### Embedded Firmware Constraint:
The Dareu MCU firmware evaluates switches through a **flat 1-to-1 lookup table**. It does not feature an onboard conditional layer engine (it cannot evaluate *"if Switch 4 is held, divert Switch 1"*).

### Recommended Solutions:
* **Hardware Modifier Remap**: In Button Remapping, bind **Button 4 (Backward)** to `Keyboard -> Left Shift` (or `Left Ctrl` / `F13–F24`). When held, clicking Left Click sends a native `Shift + Click` hotkey combo to the host OS.
* **Client-Side Interception**: Run a lightweight AutoHotkey script to intercept dual-button combinations with zero latency:
  ```autohotkey
  XButton1 & LButton::Send("^c") ; Backward + Left Click -> Copy
  XButton1::Send("{XButton1}")    ; Normal click -> Back
  ```

---

## 7. Complete NVRAM Memory Map & Register Layout

The Dareu JieLi JM MCU exposes a contiguous memory-mapped Flash/EEPROM storage array structured as follows:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       DAREU JM MCU NVRAM MEMORY MAP                         │
├───────────────┬──────────────┬──────────────┬───────────────────────────────┤
│ Offset (Hex)  │ Offset (Dec) │ Size (Bytes) │ Memory Region Description     │
├───────────────┼──────────────┼──────────────┼───────────────────────────────┤
│ 0x0000–0x004B │ 0–75         │ 76 B         │ Polling Rate, DPI Stages 1–8, │
│               │              │              │ X/Y Multipliers, RGB Colors   │
│ 0x004C–0x005F │ 76–95        │ 20 B         │ DPI LED & Lighting Config     │
│               │              │              │ (Effect 76, Bright 78, Speed) │
│ 0x0060–0x009F │ 96–159       │ 64 B         │ Physical Button Action Tables │
│               │              │              │ (Buttons 1–6, 4B per button)  │
│ 0x00A0–0x00FF │ 160–255      │ 96 B         │ Sensor & Performance Tuning:  │
│               │              │              │ Chassis LED (160), LOD (10),  │
│               │              │              │ Debounce (169), Sync (171),   │
│               │              │              │ Angle Snap (175), Ripple(177),│
│               │              │              │ Auto-Sleep (181), Standby(183)│
│ 0x0100–0x01DF │ 256–479      │ 224 B        │ Extended Button Combine Chords│
│               │              │              │ & Media/Shortcuts (32B/Button)│
│               │              │              │ • Btn 1: 0x0100 (256)         │
│               │              │              │ • Btn 2: 0x0120 (288)         │
│               │              │              │ • Btn 3: 0x0140 (320)         │
│               │              │              │ • Btn 4: 0x0160 (352)         │
│               │              │              │ • Btn 5: 0x0180 (384)         │
│               │              │              │ • Btn 6: 0x01A0 (416)         │
│ 0x01E0–0x02FF │ 480–767      │ 288 B        │ Reserved / Alignment Padding  │
│ 0x0300–0x047F │ 768–1151     │ 384 B        │ Macro Slot 1 (30B name + 350B)│
│ 0x0480–0x05FF │ 1152–1535    │ 384 B        │ Macro Slot 2 (30B name + 350B)│
│ 0x0600–0x077F │ 1536–1919    │ 384 B        │ Macro Slot 3 (30B name + 350B)│
│ 0x0780–0x08FF │ 1920–2303    │ 384 B        │ Macro Slot 4 (30B name + 350B)│
│ 0x0900–0x0A7F │ 2304–2687    │ 384 B        │ Macro Slot 5 (30B name + 350B)│
│ 0x0A80–0x0BFF │ 2688–3071    │ 384 B        │ Macro Slot 6 (30B name + 350B)│
│ 0x0C00–0x0D7F │ 3072–3455    │ 384 B        │ Macro Slot 7 (30B name + 350B)│
│ 0x0D80–0x0EFF │ 3456–3839    │ 384 B        │ Macro Slot 8 (30B name + 350B)│
│ 0x1B00–0x1B1E │ 6912–6942    │ 30 B         │ PAW3950/3955 Extended Hi-Res  │
│               │              │              │ 6-Byte DPI Multiplier Table   │
└───────────────┴──────────────┴──────────────┴───────────────────────────────┘
```

### Macro Slot Partition Layout (384 Bytes per Slot):
- **Bytes 0–29 (30 B)**: UTF-8 / ASCII Name label string header (`\0` terminated).
- **Byte 30 (1 B)**: Reserved / Header checksum.
- **Byte 31 (1 B)**: Recorded Action Count ($N \le 70$).
- **Bytes 32–381 (350 B)**: 5-Byte Bytecode Token stream:
  - `Byte 0`: Opcode (`0x81` Make, `0x41` Break, `0x84` Mouse Down, `0x44` Mouse Up, `0x02` Wheel, `0x80`/`0x40` Modifiers).
  - `Byte 1`: Keycode (USB HID Usage ID) or Mouse Button Bitmask (`1`=Left, `2`=Right, `4`=Middle, `8`=Back, `16`=Forward).
  - `Byte 2`: Reserved / Parameter alignment (`0x00`).
  - `Bytes 3–4`: 16-bit unsigned little-endian delay duration (ms).

---

## 8. Why the Official Web Driver Has Limitations

1. **Missing Sensor Options**: The official `dr.dareu.com` UI strictly hides Angle Snapping, LOD, and Debounce controls unless static product JSON definitions contain specific flags. In reality, the mouse firmware registers already exist and function.
2. **Limited Macro System**: The official web interface only records simple sequential keystrokes. However, the hardware macro interpreter processes discrete Key Down (`0x81`), Key Up (`0x41`), Mouse Down (`0x84`), and Mouse Up (`0x44`) opcodes, allowing full support for **concurrent button chords** (such as Backward + Left Click).
3. **Loop Mode Omission**: The official driver does not expose granular repeat count parameters ($N=1..250$) or explain the operational difference between `253` (interrupt on any key) and `255` (toggle on same key).

---

## 9. Multi-Model Driver Database & Physical Topology Reference

The control center incorporates a dynamic multi-model hardware engine (`js/models.js`) reverse-engineered from 171 official Dareu product firmware descriptors across Togran (TG), JiangMeng (JM), and HaiSi (Hisilicon) architectures:

| Model | Hardware PID | Internal Model Code | Sensor IC | Max DPI / Polling | Physical Keys | Top DPI Button Present? | Authentic Render Asset |
|---|---|---|---|---|---|---|---|
| **Dareu A950 AIR** | `0x1193` | `TM275D` | PixArt PAW3395 / AIM-750U | 26,000 DPI / 1000Hz | **5 Buttons** | ❌ **No (Bottom HW Switch)** | `assets/models/a950_air.png` |
| **Dareu A950 PRO** | `0x1112` | `TM265` | PixArt PAW3395 | 26,000 DPI / 4000Hz | **6 Buttons** | ✅ **Yes (Pin 6 above wheel)** | `assets/models/a950_pro.png` |
| **Dareu A950 PRO Mg** | `0x1117` | `TM271F` | PixArt PAW3395 / AIM-750U | 26,000 DPI / 8000Hz | **6 Buttons** | ✅ **Yes (Pin 6 above wheel)** | `assets/models/a950_pro_mg.png` |
| **Dareu A980 PRO** | `0x1130` | `TM270` | PixArt PAW3395 / AIM-750U | 30,000 DPI / 8000Hz | **6 Buttons** | ✅ **Yes (KBS 3.0 Optical Triggers)** | `assets/models/a980_pro.png` |
| **Dareu A980 PRO MAX** | `0x1129` | `TM270LCD` | PixArt AIM-750U | 30,000 DPI / 8000Hz | **6 Buttons** | ✅ **Yes (0.96" TFT Color Display)** | `assets/models/a980_pro_max.png` |
| **Dareu A950 Ultra** | `0x1217` | `TM283` | PixArt AIM-750U | 30,000 DPI / 8000Hz | **6 Buttons** | ✅ **Yes (Extended Hi-Res NVRAM)** | `assets/models/a950_ultra.png` |

### Pin Overlay & Alignment Coordinates

Each model in `DAREU_MODELS` defines exact coordinates $(pinX\%, pinY\%)$ and callout leader alignments (`callout-left` / `callout-right`) for responsive 4K and 1080p rendering:

```javascript
// A950 AIR Topology (5 Keys strictly mapped with exact flank alignment):
buttons: [
  { id: 1, name: 'Left Button', defaultAction: 'Left Click', pinX: 41.5, pinY: 19.5, calloutSide: 'left' },
  { id: 2, name: 'Right Button', defaultAction: 'Right Click', pinX: 58.5, pinY: 19.5, calloutSide: 'right' },
  { id: 3, name: 'Middle Button', defaultAction: 'Middle Click', pinX: 51.5, pinY: 23.5, calloutSide: 'left' },
  { id: 5, name: 'Forward Button', defaultAction: 'Forward (Mouse 5)', pinX: 29.5, pinY: 40.5, calloutSide: 'left' },
  { id: 4, name: 'Backward Button', defaultAction: 'Backward (Mouse 4)', pinX: 30.0, pinY: 51.0, calloutSide: 'left' }
]
```


