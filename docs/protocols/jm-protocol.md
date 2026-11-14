# Dareu JM (JieLi) 16-Byte Memory-Mapped Protocol

The **JM (JieLi / 匠盟)** architecture is used in many Dareu wireless/wired mice, including the **Dareu A950 Air (TM275D/TM275F JM variants)**, **A950 Pro**, **A950G**, and **CM610 Pro**.

---

## 1. Physical & HID Framing

* **Report ID**: `8` (`0x08`)
* **Report Size**: 16 bytes payload (17 bytes including Report ID prefix in raw HID transports).
* **Direction**:
  * **Outbound (Host -> Device)**: Sent via `device.sendReport(8, payload)`.
  * **Inbound (Device -> Host)**: Received via `device.oninputreport` where `reportId == 8`.

### Checksum Algorithm
Every packet sent or received has its 16th byte (`offset 15` in 0-indexed payload, or `offset 16` in 17-byte buffer) computed as:

```javascript
function calculateChecksum(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length - 1; i++) {
    sum += buffer[i];
  }
  return sum < 55 ? (85 - sum) : (341 - sum);
}
```

---

## 2. Command Opcodes

| Opcode | Name | Purpose | Request Structure (16 bytes) | Response Structure |
|---|---|---|---|---|
| `0x01` (`1`) | `CMD_DEVICE_INFO` | Query device ID (CID/MID/JmType) | `[1, 0, 0, 0, 0, 8, RND, RND, RND, RND, 0, 0, 0, 0, 0, CS]` | `[1, status, ..., CID, MID, JmType, ..., CS]` |
| `0x02` (`2`) | `CMD_SET_DRIVER_MODE`| Enable/disable driver mode | `[2, 0, 0, 0, 0, 1, mode (0/1), 0, ..., CS]` | `[2, status, ..., CS]` |
| `0x03` (`3`) | `CMD_CHECK_ACTIVE` | Check device connectivity | `[3, 0, ..., CS]` | `[3, status, ..., CS]` (`resp[5] == 1`) |
| `0x04` (`4`) | `CMD_BATTERY_STATUS` | Query battery level & state | `[4, 0, ..., CS]` | `[4, status, ..., Level%, State, ..., CS]` |
| `0x07` (`7`) | `CMD_WRITE_BUFFER` | Write to NVRAM memory buffer | `[7, 0, AddrHi, AddrLo, Len, Data0..Data9, CS]` | `[7, status, ..., CS]` |
| `0x08` (`8`) | `CMD_READ_BUFFER` | Read from NVRAM memory buffer | `[8, 0, AddrHi, AddrLo, Len, 0..0, CS]` | `[8, status, AddrHi, AddrLo, Len, Data0..Data9, CS]` |
| `0x09` (`9`) | `CMD_FACTORY_RESET` | Restore factory defaults | `[9, 0, ..., CS]` | `[9, status, ..., CS]` |
| `0x0E` (`14`)| `CMD_GET_ACTIVE_PFL` | Query active profile ID | `[14, 0, ..., CS]` | `[14, status, ..., ProfileIdx, ..., CS]` |
| `0x0F` (`15`)| `CMD_SET_ACTIVE_PFL` | Switch active profile | `[15, 0, 0, 0, 0, 1, ProfileIdx-1, ..., CS]` | `[15, status, ..., CS]` |
| `0x12` (`18`)| `CMD_GET_FW_VER` | Query firmware version | `[18, 0, ..., CS]` | `[18, status, ..., FwVerHi, FwVerLo, ..., CS]` |
| `0x1D` (`29`)| `CMD_GET_DONGLE_VER` | Query 2.4G dongle version | `[29, 0, ..., CS]` | `[29, status, ..., VerHi, VerLo, ..., CS]` |

---

## 3. NVRAM Register Buffer Map

The mouse maintains an internal memory map for settings that persist across power cycles:

```
Address Range     Description
─────────────────────────────────────────────────────────────
0x0000 - 0x0001   Polling Rate Configuration (ID 0..6)
0x0002 - 0x0003   DPI Stage Count (1-8)
0x0004 - 0x0005   Active DPI Stage Index (0-based)
0x000A - 0x000B   Lift-Off Distance (LOD) Register
0x000C - 0x002B   Legacy DPI Table (X/Y for stages 1-8)
0x0060 - 0x009F   Button Function Mapping (Buttons 1-16)
0x00A0 - 0x00A5   RGB Lighting Configuration (Mode, Colors, Brightness)
0x00A9            Debounce / Click Response Time (in ms: 1-20)
0x00AB            Motion Sync (0 = Off, 1 = On)
0x00AF            Angle Snapping / Straight Line Correction (0 = Off, 1 = On)
0x00B1            Ripple Control / Smoothing (0 = Off, 1 = On)
0x00B5            Sleep Timeout Multiplier (x10 seconds)
0x00B9            Sensor Mode (High-Performance / Low-Power / Cord)
0x0100 - 0x02FF   Extended Key & Combo Sequence Table
0x0300 - 0x1B00   Onboard Hardware Macro Storage (16 slots x 384 bytes)
0x1B00 - 0x1B3F   Extended DPI Table (JM Extended Protocol)
```

---

## 4. Register Details

### Buffer 0: Polling Rate
* `125 Hz`: `0x08` (or index map value)
* `250 Hz`: `0x04`
* `500 Hz`: `0x02`
* `1000 Hz`: `0x01`
* `2000 Hz`: `0x10` (16)
* `4000 Hz`: `0x20` (32)
* `8000 Hz`: `0x40` (64)

### Buffer 10: Lift-Off Distance (LOD)
* `0x00` / `0x01`: 1.0mm (Low)
* `0x02`: 2.0mm (High)

### Buffer 169: Button Debounce Latency
* Value in milliseconds: `1` to `20` ms. (Lower values reduce click latency for competitive gaming).

### Buffer 171: Motion Sync
* `0x00`: Disabled (Lowest tracking latency)
* `0x01`: Enabled (Synchronizes optical frames with USB polling intervals)

### Buffer 175: Angle Snapping (Straight Line Correction)
* `0x00`: Disabled (Raw linear 1:1 sensor input)
* `0x01`: Enabled (Assists straight horizontal / vertical cursor movements)

### Buffer 177: Ripple Control (Smoothing)
* `0x00`: Disabled (Raw unsmoothed input)
* `0x01`: Enabled (Reduces sensor jitter at ultra-high DPI > 10,000)

### Buffer 185: Mode Select
* `0x00`: Standard / Balanced Mode
* `0x01`: High-Performance / Esports Mode
* `0x02`: Cord / Wired Boost Mode
* `0x03`: Low-Power / Eco Mode
