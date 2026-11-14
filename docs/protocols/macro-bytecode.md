# Dareu Hardware Macro Bytecode & Chord Specification

This document details the internal bytecode instruction format used by Dareu mice for onboard hardware macro playback, specifically explaining how to construct **multi-key chords** and **concurrent mouse button combinations** (such as Backward Click + Left Click, or holding Shift while clicking).

---

## 1. Bytecode Instruction Architecture

The mouse MCU contains an onboard event state machine. Macro sequences are stored as a stream of discrete event tokens:

```
[Event_1 (Type + Payload)] -> [Optional Delay] -> [Event_2] -> ... -> [End]
```

### Event Opcodes

| Opcode (Hex) | Opcode (Dec) | Action Name | Payload Bytes | Description |
|---|---|---|---|---|
| `0x81` | `129` | `KEY_MAKE` | `[HID_KeyCode, 0, 0, 0]` | Key Down event for standard keyboard key |
| `0x41` | `65` | `KEY_BREAK` | `[HID_KeyCode, 0, 0, 0]` | Key Up event for standard keyboard key |
| `0x80` | `128` | `MODIFIER_MAKE` | `[ModifierMask, 0, 0, 0]` | Key Down for Modifier keys (Ctrl/Shift/Alt/Win) |
| `0x40` | `64` | `MODIFIER_BREAK` | `[ModifierMask, 0, 0, 0]` | Key Up for Modifier keys |
| `0x84` | `132` | `MOUSE_MAKE` | `[ButtonMask, 0, 0, 0]` | Mouse Button Down event |
| `0x44` | `68` | `MOUSE_BREAK` | `[ButtonMask, 0, 0, 0]` | Mouse Button Up event |
| `0x82` | `130` | `MEDIA_MAKE` | `[UsageHi, UsageLo, 0, 0]` | Consumer/Media Key Down |
| `0x42` | `66` | `MEDIA_BREAK` | `[UsageHi, UsageLo, 0, 0]` | Consumer/Media Key Up |
| `0x0A` | `10` | `DELAY_1` | `[DelayMs]` | Millisecond delay (0–255 ms) |
| `0x0B` | `11` | `DELAY_2` | `[DelayHi, DelayLo]` | Millisecond delay (0–65,535 ms) |
| `0x0D` | `13` | `DELAY_RANDOM`| `[MinHi, MinLo, MaxHi, MaxLo]` | Randomized jitter delay |
| `0xFE` | `254` | `MACRO_END` | None | End of macro sequence |

---

## 2. Bitmasks

### Mouse Button Bitmask (`MOUSE_MAKE` / `MOUSE_BREAK`)
* **Left Click**: `0x01` (`1`)
* **Right Click**: `0x02` (`2`)
* **Middle Click**: `0x04` (`4`)
* **Backward Button (Mouse 4)**: `0x08` (`8`)
* **Forward Button (Mouse 5)**: `0x10` (`16`)

### Modifier Key Bitmask (`MODIFIER_MAKE` / `MODIFIER_BREAK`)
* **Left Ctrl**: `0x01` (`1`)
* **Left Shift**: `0x02` (`2`)
* **Left Alt**: `0x04` (`4`)
* **Left Windows**: `0x08` (`8`)
* **Right Ctrl**: `0x10` (`16`)
* **Right Shift**: `0x20` (`32`)
* **Right Alt**: `0x40` (`64`)
* **Right Windows**: `0x80` (`128`)

---

## 3. Constructing Concurrent Multi-Button Combinations

Because **Press (Make)** and **Release (Break)** are distinct events, we can interleave operations to create true simultaneous combinations.

### Example 1: Backward Button + Left Click Combination
Goal: Press and hold Backward button, press Left Click, wait 50ms, release both.

```
Step 1: Mouse Down (Backward)    -> [132, 0x08, 0, 0, 0]
Step 2: Mouse Down (Left Click)  -> [132, 0x01, 0, 0, 0]
Step 3: Delay 50ms               -> [10, 50]
Step 4: Mouse Up (Left Click)    -> [68,  0x01, 0, 0, 0]
Step 5: Mouse Up (Backward)      -> [68,  0x08, 0, 0, 0]
```

### Example 2: Hold Shift + Right Click (Sniper Scope with Stabilizer)
Goal: Hold Shift, click Right Mouse Button, release.

```
Step 1: Modifier Down (Left Shift) -> [128, 0x02, 0, 0, 0]
Step 2: Mouse Down (Right Click)   -> [132, 0x02, 0, 0, 0]
Step 3: Delay 30ms                 -> [10, 30]
Step 4: Mouse Up (Right Click)     -> [68,  0x02, 0, 0, 0]
Step 5: Modifier Up (Left Shift)   -> [64,  0x02, 0, 0, 0]
```

### Example 3: Rapid Double-Action Combo (Ctrl + C then Left Click)
```
Step 1: Modifier Down (Ctrl)       -> [128, 0x01, 0, 0, 0]
Step 2: Key Down ('C' = 0x06)      -> [129, 0x06, 0, 0, 0]
Step 3: Delay 20ms                 -> [10, 20]
Step 4: Key Up ('C')               -> [65,  0x06, 0, 0, 0]
Step 5: Modifier Up (Ctrl)         -> [64,  0x01, 0, 0, 0]
Step 6: Delay 50ms                 -> [10, 50]
Step 7: Mouse Down (Left Click)    -> [132, 0x01, 0, 0, 0]
Step 8: Delay 20ms                 -> [10, 20]
Step 9: Mouse Up (Left Click)      -> [68,  0x01, 0, 0, 0]
```

---

## 4. Hardware Storage Structure (JM Architecture)

On JM devices, each macro slot is stored in a dedicated 384-byte Flash partition starting at `0x0300 + 384 * (MacroIndex - 1)` (slots 1 to 8):
* **Byte 0**: Macro name length ($L \le 30$).
* **Bytes 1..30**: ASCII Macro name (padded with `0xFF`).
* **Byte 31**: Total number of 5-byte action items ($N \le 70$).
* **Bytes 32..32+5*N**: Sequence of 5-byte event blocks `[Opcode, Arg0, Arg1, DelayHi, DelayLo]`.
* **Byte 32+5*N**: JieLi 8-bit checksum calculated over the payload.

---

## 5. Loop Mode Opcodes & Execution Semantics

When a physical mouse button is mapped to execute a Macro (`FunctionType = 6` in the button lookup table at `0x0060`), **Byte 2** of the 4-byte button record defines the **Hardware Loop Mode**:

| Loop Opcode | Constant in Firmware | Mode Name | Execution Semantic | User Experience |
|---|---|---|---|---|
| **`255`** (`0xFF`) | `MacroType4` | **Toggle Loop (Same Key)** | Starts repeating when the button is clicked. Loops continuously until the **exact same button** is pressed a second time. | Classic Toggle On/Off |
| **`254`** (`0xFE`) | `MacroType2` | **Hold Loop** | Repeats continuously **only while the physical button switch remains depressed**. Terminates immediately upon button release. | Fire-while-held |
| **`253`** (`0xFD`) | `MacroType3` | **Loop Until Any Key / Interrupt** | Starts repeating when clicked. Loops continuously until **ANY other button or keyboard key is pressed**. | Interruptible Auto-Run |
| **`1`–`250`** | `MacroType1` | **Fixed Repeat Count** | Executes the macro sequence exactly $N$ times upon a single button click, then stops. | Burst (e.g. 3-Round Burst) |

### Key Difference Between `253` and `255`:
* **`255` (Toggle On/Off)**: Only pressing the *trigger button again* will stop the macro. Other mouse clicks or movements will not interrupt the loop.
* **`253` (Loop Until Interrupt)**: Pressing *any* button on the mouse (e.g. Left Click, Right Click, or Side Button) immediately halts the loop, making it ideal for auto-run or repetitive spam actions where you want to break out instantly when aiming or firing.

---

## 6. Onboard Macro Slots vs Physical Buttons

There is a fundamental architectural distinction between **Macro Storage Slots** and **Physical Mouse Buttons**:

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

1. **8 Macro Slots (Storage Library)**: The JieLi MCU EEPROM contains 8 discrete 384-byte partitions (`0x0300`, `0x0480`, `0x0600`, `0x0780`, `0x0900`, `0x0A80`, `0x0C00`, `0x0D80`). These act as an onboard macro library.
2. **Physical Buttons (5 switches on A950 Air)**: The button mapping table (`0x0060`) stores 4-byte pointers that point each physical switch to one of the 8 slots and assign a loop mode.
3. Having 8 slots allows maintaining an onboard library of 8 pre-recorded scripts, which can be dynamically assigned to any button without re-recording.

---

## 7. Dual-Button Chording & Shift-Layers (Hypershift)

A common user requirement is **Chording / Shift-Layers** (e.g., holding the Backward button turns Left Click into a secondary macro, but clicking Left Click normally remains standard Left Click).

### Embedded Firmware Limitation:
The Dareu JieLi MCU firmware uses a **flat 1-to-1 switch lookup table**. It does not contain an onboard conditional state machine (i.e. it cannot evaluate *"If Switch 4 is depressed, redirect Switch 1 to Macro Slot 3"*).

### Recommended Solutions:
1. **Hardware Modifier Remapping (Pure Hardware)**:
   - Rebind **Button 4 (Backward)** to `Keyboard -> Left Shift` (or `Left Ctrl` / `F13–F24`).
   - Holding Button 4 physically sends `Shift` to the host OS, making `Button 4 + Left Click` trigger native `Shift + Click` combos in all games and applications.
2. **Client-Side Interception (AutoHotkey / Software Layer)**:
   - Intercept mouse button combinations via a lightweight script:
   ```autohotkey
   XButton1 & LButton::Send("^c") ; Backward + Left Click -> Copy
   XButton1::Send("{XButton1}")    ; Normal click -> Back
   ```

