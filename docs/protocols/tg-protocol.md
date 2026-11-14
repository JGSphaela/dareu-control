# Dareu TG (Telink / Self-Developed) 64-Byte Command Protocol

The **TG (Telink / Self-Developed)** protocol is used for high-polling-rate mice and keyboards, such as the **Dareu A980**, **A980 Pro / Pro Max**, and **A950 Air 8K/4K (TM275F variants)**.

---

## 1. Physical & HID Framing

* **Report ID**: `0` (`0x00`), `7` (`0x07`), or `10` (`0x0A`) depending on interface and wireless state.
* **Report Size**: 64 bytes fixed payload.
* **Transport**: Feature Reports via `device.sendFeatureReport(reportId, buffer)` and `device.receiveFeatureReport(reportId)`.

### Header Structure (Bytes 0–4)

```
Byte Offset   Field Name      Description
─────────────────────────────────────────────────────────────
0             HDR_STATUS      Target ID / Device routing (0x00, 0x10, etc.)
1             HDR_SIZE        Payload data length
2             HDR_CLASS       Command Class identifier
3             HDR_COMMAND     Command Opcode (combined with GET 0x80 or SET 0x00)
4             HDR_PROFILE     Profile Index (0-based or 1-based)
5..63         PAYLOAD         Command-specific argument / data bytes
```

### Command Flags
* **GET Command**: `HDR_COMMAND = Opcode | 0x80`
* **SET Command**: `HDR_COMMAND = Opcode | 0x00`

---

## 2. Command Classes (`HDR_CLASS`)

| Class ID | Identifier | Subsystem |
|---|---|---|
| `0x00` (`0`) | `CLASS_DEVICE` | Firmware version, serial number, wireless pairing, reset |
| `0x01` (`1`) | `CLASS_KEY` | Keyboard matrix, debounce, actuation points |
| `0x02` (`2`) | `CLASS_BUTTON` | Mouse button assignments & debounce |
| `0x03` (`3`) | `CLASS_LIGHTING` | RGB LED modes, colors, brightness, frame rates |
| `0x04` (`4`) | `CLASS_SENSOR` | Optical sensor DPI, LOD, Angle Snapping, Motion Sync |
| `0x05` (`5`) | `CLASS_PROFILE` | Onboard profile switching, creation, deletion |
| `0x06` (`6`) | `CLASS_MACRO` | Hardware macro creation, bytecode streaming |
| `0x07` (`7`) | `CLASS_POWER` | Battery level, sleep timers, charging status |

---

## 3. Sensor Commands (`CLASS_SENSOR = 0x04`)

| Opcode | Identifier | Description |
|---|---|---|
| `0x00` (`0`) | `SNR_CMD_ATTRIBUTE` | Query sensor model, DPI min/max, step size, feature flags |
| `0x01` (`1`) | `SNR_CMD_STATUS` | Query real-time tracking sensor status |
| `0x03` (`3`) | `SNR_CMD_DPI_CFG` | Read/write full DPI stages (count, active stage, X/Y pairs) |
| `0x04` (`4`) | `SNR_CMD_DPI_ACTIVE`| Set active stage DPI in real time |
| `0x05` (`5`) | `SNR_CMD_MODE` | High-performance vs Low-power mode toggle |
| `0x06` (`6`) | `SNR_CMD_LIFTED_SETTING` | Configure Lift-Off Distance (LOD) |
| `0x08` (`8`) | `SNR_CMD_LIFTED_SETTING_V2` | Extended multi-level LOD calibration |
| `0x0A` (`10`)| `SNR_CMD_FEATURE_CTRL` | Toggle Angle Snapping, Motion Sync, Ripple Control |

---

## 4. Multi-Packet Command Streaming

For data larger than 48 payload bytes (such as large macro bytecodes or LED matrix tables):

1. **Host sends Header** specifying total byte count:
   `HDR_SIZE = 1`, `PAYLOAD[0] = TotalBytes >> 8`, `PAYLOAD[1] = TotalBytes & 0xFF`.
2. **Data chunks** are streamed in blocks of up to 48 bytes per report with block offset counters.
