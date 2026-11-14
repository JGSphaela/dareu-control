# Dareu A950 Air Specification & Hardware Profile

The **Dareu A950 Air** is a lightweight wireless/wired gaming mouse featuring high-speed polling, an ultra-precise optical sensor (PAW3395 or AIM-750U depending on revision), and dual-mode wireless connectivity.

---

## 1. Known Model Variations & USB Product IDs

| Product ID (Hex) | Product ID (Dec) | Model Code | Architecture | Sensor Model | Max DPI | Max Polling Rate |
|---|---|---|---|---|---|---|
| `0x1193` | `4499` | `TM275D` | **JM (JieLi)** | PAW3395 / AIM | 26,000 | 1000 Hz |
| `0x1185` | `4485` | `TM275D` | **JM (JieLi)** | AIM-750U / 3950 | 30,000 | 8000 Hz USB / 8000 Hz Wireless |
| `0x1174` | `4468` | `TM275F` | **JM (JieLi)** | PAW3395 | 26,000 | 1000 Hz |
| `0x1147` | `4423` | `TM275F` | **TG (Telink)** | PAW3395 | 26,000 | 8000 Hz USB / 4000 Hz Wireless |
| `0x1169` | `4457` | `TM275F` | **TG (Telink)** | PAW3395 | 26,000 | 8000 Hz USB / 4000 Hz Wireless |

---

## 2. Physical Button Layout & Ergonomics

The **A950 AIR** is an ultralight esports mouse engineered with **5 physical buttons** + tactile scroll encoder:

```
                  ┌─────────┬─────────┐
                  │ Button1 │ Button2 │
                  │  (Left) │ (Right) │
                  │         │         │
                  ├─────────┼─────────┤
                  │    Button3 (Mid)  │
                  │    Button10/11    │
                  │   (Scroll Up/Dn)  │
                  ├─────────┴─────────┤
                  │                   │
   ┌───────────┐  │                   │
   │  Button5  │  │                   │
   │ (Forward) │  │     Dareu A950    │
   ├───────────┤  │        Air        │
   │  Button4  │  │   (Ultralight)    │
   │  (Back)   │  │                   │
   └───────────┘  │                   │
                  └───────────────────┘
```

> **Chassis Design Note (No Top DPI Button)**:  
> While standard Dareu mice (like the heavier A950 standard) have a 6th button on the top shell behind the scroll wheel for DPI cycling, the **A950 AIR removes the top DPI button** entirely to reduce chassis weight down to ~47g and avoid accidental DPI shifts during competitive play. DPI cycling is instead performed via software or the underside mode switch.

### Default Button Index Mapping

| Button ID | Physical Location | Default Function ID | Default Action |
|---|---|---|---|
| `1` | Left Click | `1` (`MouseButton`) | Mouse Button 1 (Left) |
| `2` | Right Click | `1` (`MouseButton`) | Mouse Button 2 (Right) |
| `3` | Middle Click | `1` (`MouseButton`) | Mouse Button 3 (Middle) |
| `4` | Side Back Button | `1` (`MouseButton`) | Mouse Button 4 (Backward) |
| `5` | Side Forward Button | `1` (`MouseButton`) | Mouse Button 5 (Forward) |
| `9` | Underside Switch | `19` (`DpiStageCycleUp`)| Cycle DPI Stages |
| `10`| Scroll Wheel Up | `4` (`Wheel`) | Scroll Up |
| `11`| Scroll Wheel Down | `4` (`Wheel`) | Scroll Down |

### 8 Onboard Macro Slots vs 5 Physical Buttons
* The mouse MCU Flash memory allocates **8 distinct Macro Slots** (Slot 1 to Slot 8 at addresses `0x0300`, `0x0480`, `0x0600`, `0x0780`, `0x0900`, `0x0A80`, `0x0C00`, `0x0D80`).
* These 8 slots act as an onboard macro library. Any of the 5 physical buttons (Buttons 1–5) can be configured to execute any of the 8 macro slots with custom loop behaviors (`255` Toggle, `254` Hold, `253` Interruptible, or `1..250` Fixed Repeat).

---

## 3. Optical Sensor Capabilities

* **DPI Range**: 100 to 26,000 (or 30,000) DPI in 50 DPI increments.
* **Default DPI Stages**:
  * Stage 1: `400 DPI` (Red)
  * Stage 2: `800 DPI` (Blue)
  * Stage 3: `1200 DPI` (Green)
  * Stage 4: `1600 DPI` (Yellow - Active Default)
  * Stage 5: `2000 DPI` (Cyan)
* **Lift-Off Distance (LOD)**: Configurable between 1.0mm (Low) and 2.0mm (High).
* **Angle Snapping**: Hardware-level straight-line prediction toggle.
* **Motion Sync**: Optical frame timing alignment with USB poll requests.
* **Ripple Control**: High-DPI noise jitter elimination filter.
* **Debounce Delay**: Adjustable from 1ms to 20ms for click responsiveness.
