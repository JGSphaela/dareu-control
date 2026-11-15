/**
 * Dareu JM Protocol Driver (Vendor Specific Report ID 8, 16-byte NVRAM pages)
 * Supports: A950 AIR (0x1193/0x1185/0x1174), A950 PRO (0x1112), A950 PRO Mg (0x1117),
 *           A950 Ultra (0x1217), and TM275 2.4G Receiver (0x1154).
 */

import {
  MacroCompiler,
  MEDIA_KEYS,
  POWER_KEYS,
  jmChecksum,
} from './macro-compiler.js?v=4.1.0';

export const JM_POLLING_TO_CODE = {
  125: 8,
  250: 4,
  500: 2,
  1000: 1,
  2000: 16,
  4000: 32,
  8000: 64,
};

export const JM_CODE_TO_POLLING = Object.fromEntries(
  Object.entries(JM_POLLING_TO_CODE).map(([hz, code]) => [code, Number(hz)])
);

const DEFAULT_STAGE_COLORS = [
  '#ea5413',
  '#3b82f6',
  '#22c55e',
  '#eab308',
  '#a855f7',
  '#06b6d4',
  '#f43f5e',
  '#ededed',
];

function rgbToHex(r, g, b) {
  const clamp = v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0');
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

function hexToRgb(hex) {
  const clean = String(hex || '#ea5413').replace('#', '');
  if (clean.length !== 6) return [234, 84, 19];
  const n = parseInt(clean, 16);
  if (Number.isNaN(n)) return [234, 84, 19];
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export class JmDevice {
  constructor(hidDevice, profile, logCallback = null) {
    this.hidDevice = hidDevice;
    this.device = hidDevice;
    this.profile = profile || {};
    this.logger = logCallback || (() => {});
    this.reportId = 8;
    this.pendingRequests = [];
    this.activeProfile = 1;
    this.deviceInfo = null;
    this.longDistanceStatus = null;

    this._onInputReport = this._handleInputReport.bind(this);
    if (this.hidDevice && typeof this.hidDevice.addEventListener === 'function') {
      this.hidDevice.addEventListener('inputreport', this._onInputReport);
    }
  }

  dispose() {
    if (this.hidDevice && typeof this.hidDevice.removeEventListener === 'function') {
      this.hidDevice.removeEventListener('inputreport', this._onInputReport);
    }
    while (this.pendingRequests.length > 0) {
      const req = this.pendingRequests.shift();
      clearTimeout(req.timer);
      req.reject(new Error('Driver disposed'));
    }
  }

  _handleInputReport(event) {
    if (event.reportId !== this.reportId) return;
    const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    this.logger('RX', event.reportId, data);

    const opcode = data[0];
    const idx = this.pendingRequests.findIndex(req => req.opcode === opcode);
    if (idx !== -1) {
      const [req] = this.pendingRequests.splice(idx, 1);
      clearTimeout(req.timer);
      req.resolve(data);
    }
  }

  calculateChecksum(buf) {
    return jmChecksum(buf);
  }

  async sendCommand(opcode, addr = 0, len = 0, data = [], timeoutMs = 1500) {
    const full = new Uint8Array(17).fill(0);
    full[0] = this.reportId;
    full[1] = opcode & 0xff;
    full[2] = 0;
    full[3] = (addr >> 8) & 0xff;
    full[4] = addr & 0xff;
    full[5] = len & 0xff;
    const copyLen = Math.min(data.length, 10);
    for (let i = 0; i < copyLen; i++) {
      full[6 + i] = data[i] & 0xff;
    }
    full[16] = this.calculateChecksum(full);

    const payload = full.subarray(1, 17);
    this.logger('TX', this.reportId, payload);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.pendingRequests.findIndex(r => r.resolve === resolve);
        if (idx !== -1) this.pendingRequests.splice(idx, 1);
        reject(new Error(`JM HID timeout on opcode 0x${opcode.toString(16)} addr 0x${addr.toString(16)}`));
      }, timeoutMs);

      this.pendingRequests.push({ opcode: opcode & 0xff, resolve, reject, timer });

      this.hidDevice.sendReport(this.reportId, payload).catch(err => {
        clearTimeout(timer);
        const idx = this.pendingRequests.findIndex(r => r.resolve === resolve);
        if (idx !== -1) this.pendingRequests.splice(idx, 1);
        reject(err);
      });
    });
  }

  async getBuffer(addr, len) {
    const out = new Uint8Array(len);
    let offset = 0;
    while (offset < len) {
      const chunkLen = Math.min(10, len - offset);
      const resp = await this.sendCommand(8, addr + offset, chunkLen);
      out.set(resp.slice(5, 5 + chunkLen), offset);
      offset += chunkLen;
    }
    return out;
  }

  async setBuffer(addr, data) {
    const arr = data instanceof Uint8Array ? data : Uint8Array.from(data);
    let offset = 0;
    while (offset < arr.length) {
      const chunkLen = Math.min(10, arr.length - offset);
      const chunk = arr.slice(offset, offset + chunkLen);
      await this.sendCommand(7, addr + offset, chunkLen, chunk);
      offset += chunkLen;
    }
    return true;
  }

  async getRawMemory(startAddr, length) {
    return this.getBuffer(startAddr, length);
  }

  async _writeCheckedByte(addr, value) {
    const buf = new Uint8Array([value & 0xff, 0]);
    buf[1] = this.calculateChecksum(buf);
    await this.setBuffer(addr, buf);
    return true;
  }

  // === Lifecycle, Device Info & Transceiver ===

  async checkActive() {
    try {
      const resp = await this.sendCommand(3, 0, 0, [], 800);
      return resp[5] === 1;
    } catch (_) {
      return false;
    }
  }

  async getDeviceInfo() {
    const rand = Array.from({ length: 4 }, () => Math.floor(Math.random() * 256));
    const resp = await this.sendCommand(1, 0, 8, rand);
    this.deviceInfo = {
      cid: resp[9],
      mid: resp[10],
      jmType: resp[11],
    };
    return this.deviceInfo;
  }

  async initDevice() {
    const active = await this.checkActive();
    if (!active && this.profile?.isDongle) {
      this.logger('WARN', 0, '2.4G receiver idle (mouse may be asleep; move mouse to wake)');
    }
    try {
      await this.getDeviceInfo();
    } catch (_) {}
    try {
      this.activeProfile = await this.getActiveProfile();
    } catch (_) {}
    try {
      this.longDistanceStatus = await this.getLongDistanceMode();
    } catch (_) {}
    return active;
  }

  async getFirmwareVersion() {
    const resp = await this.sendCommand(18, 0, 0);
    const maj = resp[5];
    const min = resp[6];
    return `v${maj.toString(16).padStart(2, '0')}.${min.toString(16).padStart(2, '0')}`;
  }

  async getDongleFirmwareVersion() {
    const resp = await this.sendCommand(29, 0, 0);
    const maj = resp[5];
    const min = resp[6];
    return `v${maj.toString(16).padStart(2, '0')}.${min.toString(16).padStart(2, '0')}`;
  }

  async getBatteryStatus() {
    const resp = await this.sendCommand(4, 0, 0);
    return {
      level: resp[5],
      charging: resp[6] === 1,
    };
  }

  async getLongDistanceMode() {
    const resp = await this.sendCommand(23, 0, 0);
    const supported = resp[1] === 0;
    const enabled = resp[5] === 1;
    this.longDistanceStatus = { supported, enabled };
    return this.longDistanceStatus;
  }

  async setLongDistanceMode(enable) {
    await this.sendCommand(22, 0, 10, [enable ? 1 : 0]);
    this.longDistanceStatus = { supported: true, enabled: Boolean(enable) };
    return true;
  }

  // === Hardware Profiles (4 banks @ 0x0000, 0x1B00, 0x3600, 0x5100) ===

  async getActiveProfile() {
    const resp = await this.sendCommand(14, 0, 0);
    const id = Math.max(1, Math.min(4, (resp[5] ?? 0) + 1));
    this.activeProfile = id;
    return id;
  }

  async setActiveProfile(profileId) {
    const clamped = Math.max(1, Math.min(4, Number(profileId) || 1));
    await this.sendCommand(15, 0, 1, [clamped - 1]);
    await new Promise(r => setTimeout(r, 350));
    this.activeProfile = clamped;
    return clamped;
  }

  // === Polling Rate ===

  async getPollingRate() {
    const buf = await this.getBuffer(0, 2);
    return JM_CODE_TO_POLLING[buf[0]] || 1000;
  }

  async setPollingRate(hz) {
    const code = JM_POLLING_TO_CODE[Number(hz)] ?? 1;
    return this._writeCheckedByte(0, code);
  }

  // === Sensor & Power Settings ===

  async getSensorSettings() {
    const lodBuf = await this.getBuffer(10, 2);
    const tail = await this.getBuffer(169, 18); // 169..186
    return {
      lod: lodBuf[0] === 2 ? 2 : 1,
      debounceMs: tail[0] > 0 && tail[0] <= 20 ? tail[0] : 4,
      motionSync: tail[2] === 1,
      ledSleepSec: (tail[4] || 30) * 10,
      angleSnapping: tail[6] === 1,
      rippleControl: tail[8] === 1,
      sleepEnabled: tail[12] === 1,
      sleepTimeoutSec: (tail[14] || 30) * 10,
      sensorMode: tail[16] ?? 0,
    };
  }

  async setDebounceTime(ms) {
    const clamped = Math.max(1, Math.min(20, Number(ms) || 4));
    return this._writeCheckedByte(169, clamped);
  }

  async setMotionSync(enable) {
    return this._writeCheckedByte(171, enable ? 1 : 0);
  }

  async setLiftOffDistance(is2mm) {
    return this._writeCheckedByte(10, is2mm ? 2 : 1);
  }

  async setAngleSnapping(enable) {
    return this._writeCheckedByte(175, enable ? 1 : 0);
  }

  async setRippleControl(enable) {
    return this._writeCheckedByte(177, enable ? 1 : 0);
  }

  async setSleepEnabled(enable) {
    return this._writeCheckedByte(181, enable ? 1 : 0);
  }

  async setSleepTimeout(seconds) {
    const steps = Math.max(1, Math.min(255, Math.round((Number(seconds) || 300) / 10)));
    await this._writeCheckedByte(181, 1);
    return this._writeCheckedByte(183, steps);
  }

  async setSensorMode(mode) {
    const val = Math.max(0, Math.min(255, Number(mode) || 0));
    return this._writeCheckedByte(185, val);
  }

  // === DPI Engine, Asymmetric X/Y & Per-Stage Indicator Colors ===

  _encodeStandardDpiIndex(dpi) {
    const maxDpi = this.profile?.maxDpi || 30000;
    const minDpi = this.profile?.dpiMin || 50;
    const step = this.profile?.dpiStep || 50;
    const clamped = Math.max(minDpi, Math.min(maxDpi, Number(dpi) || 800));
    const idx = Math.round(clamped / step) - 1;
    const lo = idx & 0xff;
    const hi = (idx >> 8) & 0x03;
    return { lo, hi };
  }

  _decodeStandardDpiIndex(lo, hiBits) {
    const step = this.profile?.dpiStep || 50;
    const idx = ((hiBits & 0x03) << 8) | (lo & 0xff);
    return (idx + 1) * step;
  }

  async getDpiStages() {
    const header = await this.getBuffer(2, 4); // [2]=count, [4]=activeIdx
    const stageCount = Math.max(1, Math.min(8, header[0] || 4));
    const activeStage = Math.max(1, Math.min(stageCount, (header[2] ?? 0) + 1));
    const colorBuf = await this.getBuffer(44, 32); // 8 * [R, G, B, cs]

    const stages = [];
    if (this.profile?.jmNewProto) {
      const dpiBuf = await this.getBuffer(6912, 48);
      for (let i = 0; i < stageCount; i++) {
        const off = i * 6;
        const cOff = i * 4;
        const dpiX = ((dpiBuf[off + 1] << 8) | dpiBuf[off]) + 1;
        const dpiY = ((dpiBuf[off + 3] << 8) | dpiBuf[off + 2]) + 1;
        stages.push({
          dpiX,
          dpiY,
          color: rgbToHex(colorBuf[cOff], colorBuf[cOff + 1], colorBuf[cOff + 2]),
        });
      }
    } else {
      const dpiBuf = await this.getBuffer(12, 32);
      for (let i = 0; i < stageCount; i++) {
        const off = i * 4;
        const cOff = i * 4;
        const hiMask = dpiBuf[off + 2];
        // Dareu JM packs hi nibbles as 0x44 (hi=1) and 0x88 (hi=2): bits [3:2] & [7:6].
        // Accept bits [1:0] / [5:4] fallback if older firmwares omit upper nibble shifts.
        let hiX = (hiMask >> 2) & 0x03;
        let hiY = (hiMask >> 6) & 0x03;
        if (hiX === 0 && hiY === 0 && (hiMask & 0x03) !== 0) {
          hiX = hiMask & 0x03;
          hiY = (hiMask >> 4) & 0x03;
        }
        const dpiX = this._decodeStandardDpiIndex(dpiBuf[off], hiX);
        const dpiY = this._decodeStandardDpiIndex(dpiBuf[off + 1], hiY);
        const hasValidColor =
          colorBuf[cOff] + colorBuf[cOff + 1] + colorBuf[cOff + 2] > 0 ||
          colorBuf[cOff + 3] === this.calculateChecksum(colorBuf.slice(cOff, cOff + 4));
        const color = hasValidColor
          ? rgbToHex(colorBuf[cOff], colorBuf[cOff + 1], colorBuf[cOff + 2])
          : DEFAULT_STAGE_COLORS[i % DEFAULT_STAGE_COLORS.length];
        stages.push({ dpiX, dpiY, color });
      }
    }

    return { activeStage, stageCount, stages };
  }

  async setDpiStages(stages, activeStage = 1) {
    const count = Math.max(1, Math.min(8, stages.length));
    const clampedActive = Math.max(1, Math.min(count, Number(activeStage) || 1));

    await this._writeCheckedByte(2, count);
    await this._writeCheckedByte(4, clampedActive - 1);

    if (this.profile?.jmNewProto) {
      const payload = new Uint8Array(count * 6);
      for (let i = 0; i < count; i++) {
        const xVal = Math.max(50, Math.round(stages[i].dpiX)) - 1;
        const yVal = Math.max(50, Math.round(stages[i].dpiY)) - 1;
        const entry = new Uint8Array([
          xVal & 0xff,
          (xVal >> 8) & 0xff,
          yVal & 0xff,
          (yVal >> 8) & 0xff,
          0,
          0,
        ]);
        entry[5] = this.calculateChecksum(entry);
        payload.set(entry, i * 6);
      }
      await this.setBuffer(6912, payload);
    } else {
      const payload = new Uint8Array(count * 4);
      for (let i = 0; i < count; i++) {
        const x = this._encodeStandardDpiIndex(stages[i].dpiX);
        const y = this._encodeStandardDpiIndex(stages[i].dpiY);
        // Official JM encoding uses 0x44 (hi=1 -> bits 2 & 6) and 0x88 (hi=2 -> bits 3 & 7)
        const hiMask = ((y.hi & 0x03) << 6) | ((x.hi & 0x03) << 2);
        const entry = new Uint8Array([x.lo, y.lo, hiMask, 0]);
        entry[3] = this.calculateChecksum(entry);
        payload.set(entry, i * 4);
      }
      await this.setBuffer(12, payload);
    }

    // Write per-stage RGB colors (addr 44..75) when present
    if (stages.some(s => Boolean(s.color))) {
      await this.setDpiColors(stages.map((s, idx) => s.color || DEFAULT_STAGE_COLORS[idx % 8]));
    }
    return true;
  }

  async setActiveDpiStage(stageNum) {
    return this._writeCheckedByte(4, Math.max(0, (Number(stageNum) || 1) - 1));
  }

  async getDpiColors() {
    const buf = await this.getBuffer(44, 32);
    const colors = [];
    for (let i = 0; i < 8; i++) {
      const off = i * 4;
      colors.push(rgbToHex(buf[off], buf[off + 1], buf[off + 2]));
    }
    return colors;
  }

  async setDpiColors(colors) {
    const count = Math.min(8, colors.length);
    const payload = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
      const [r, g, b] = hexToRgb(colors[i]);
      const entry = new Uint8Array([r, g, b, 0]);
      entry[3] = this.calculateChecksum(entry);
      payload.set(entry, i * 4);
    }
    return this.setBuffer(44, payload);
  }

  async getDpiLedConfig() {
    const buf = await this.getBuffer(76, 8); // 76:effect, 78:brightness, 80:speed, 82:status
    const sleepBuf = await this.getBuffer(173, 2);
    return {
      effect: buf[0],
      brightness: buf[2],
      speed: buf[4],
      enabled: buf[6] === 1,
      sleepSec: (sleepBuf[0] || 30) * 10,
    };
  }

  async setDpiLedConfig({ enabled = true, effect = 1, brightness = 255, speed = 2, sleepSec = null }) {
    await this._writeCheckedByte(82, enabled ? 1 : 0);
    await this._writeCheckedByte(76, effect);
    await this._writeCheckedByte(78, brightness);
    await this._writeCheckedByte(80, speed);
    if (sleepSec !== null) {
      await this._writeCheckedByte(173, Math.max(1, Math.min(255, Math.round(sleepSec / 10))));
    }
    return true;
  }

  // === Complete Button Assignments (96..127 & 256..479) ===

  async getButtonAssignments(keyCount = 6) {
    const slotCount = Math.max(6, Math.min(8, keyCount));
    const btnBuf = await this.getBuffer(96, slotCount * 4);
    const chordBuf = await this.getBuffer(256, slotCount * 32);
    const mappings = {};

    for (let i = 0; i < slotCount; i++) {
      const btnId = i + 1;
      const off = i * 4;
      const funcType = btnBuf[off];
      const arg1 = btnBuf[off + 1];
      const arg2 = btnBuf[off + 2];
      const ext = chordBuf.slice(i * 32, (i + 1) * 32);

      let category = 'disabled';
      let value = null;
      let loopMode = 1;
      let detail = null;

      if (funcType === 1) {
        category = 'mouse';
        value = Math.round(Math.log2(arg1 || 1)) + 1;
      } else if (funcType === 2) {
        category = 'dpi';
        value = arg1 === 2 ? 'dpi_up' : arg1 === 3 ? 'dpi_down' : 'dpi_cycle';
      } else if (funcType === 3) {
        category = 'hwheel';
        value = arg1 === 1 ? 'scroll_left' : 'scroll_right';
      } else if (funcType === 4) {
        if (arg2 === 2) {
          category = 'double_click';
          value = 1;
        } else {
          category = 'turbo';
          value = arg1 || 20;
        }
      } else if (funcType === 5) {
        const decoded = MacroCompiler.decodeKeyChordBuffer(ext);
        if (decoded.kind === 'media') {
          category = 'media';
          value = decoded.mediaId;
        } else if (decoded.kind === 'power') {
          category = 'power';
          value = decoded.powerId;
        } else {
          category = 'keyboard';
          value = {
            modifiersMask: decoded.modifiersMask,
            keyCodes: decoded.keyCodes,
            label: decoded.label,
          };
        }
        detail = decoded;
      } else if (funcType === 6) {
        category = 'macro';
        value = arg1 + 1;
        if (arg2 === 255) loopMode = 'toggle';
        else if (arg2 === 254) loopMode = 'hold';
        else if (arg2 === 253) loopMode = 'until_next';
        else loopMode = arg2 || 1;
      } else if (funcType === 7) {
        category = 'polling_switch';
        value = 1;
      } else if (funcType === 8) {
        category = 'lighting_switch';
        value = 1;
      } else if (funcType === 9) {
        category = 'profile_cycle';
        value = 1;
      } else if (funcType === 10) {
        category = 'sniper';
        value = this.profile?.jmNewProto
          ? ((arg2 << 8) | arg1) + 1
          : 100 + Math.max(0, arg1 - 1) * 50;
      } else if (funcType === 11) {
        category = 'wheel';
        value = arg1 === 2 ? 'scroll_down' : 'scroll_up';
      }

      mappings[btnId] = { btnId, category, value, loopMode, detail, raw: [funcType, arg1, arg2, btnBuf[off + 3]] };
    }

    return mappings;
  }

  async setButtonAssignment(btnId, category, value, loopMode = 1) {
    const slot = new Uint8Array(4).fill(0);
    let extData = null;

    if (category === 'mouse') {
      slot[0] = 1;
      slot[1] = 1 << Math.max(0, (Number(value) || 1) - 1);
    } else if (category === 'double_click') {
      slot[0] = 4;
      slot[1] = 10;
      slot[2] = 2;
    } else if (category === 'turbo') {
      slot[0] = 4;
      slot[1] = Math.max(5, Math.min(255, Number(value) || 20));
      slot[2] = 0;
    } else if (category === 'dpi') {
      slot[0] = 2;
      slot[1] = value === 'dpi_up' ? 2 : value === 'dpi_down' ? 3 : 1;
    } else if (category === 'hwheel') {
      slot[0] = 3;
      slot[1] = value === 'scroll_left' ? 1 : 2;
    } else if (category === 'wheel') {
      slot[0] = 11;
      slot[1] = value === 'scroll_down' ? 2 : 1;
    } else if (category === 'keyboard') {
      slot[0] = 5;
      if (typeof value === 'number') {
        extData = MacroCompiler.encodeKeyChordBuffer(0, [value]);
      } else if (value && typeof value === 'object') {
        extData = MacroCompiler.encodeKeyChordBuffer(
          value.modifiersMask || 0,
          Array.isArray(value.keyCodes) ? value.keyCodes : value.key ? [value.key] : []
        );
      }
      if (!extData) throw new Error('Keyboard assignment requires at least one key or modifier.');
    } else if (category === 'media') {
      slot[0] = 5;
      extData = MacroCompiler.encodeMediaBuffer(MEDIA_KEYS[value] ? value : 'play_pause');
    } else if (category === 'power') {
      slot[0] = 5;
      extData = MacroCompiler.encodePowerBuffer(POWER_KEYS[value] ? value : 'power');
    } else if (category === 'macro') {
      slot[0] = 6;
      slot[1] = Math.max(0, (Number(value) || 1) - 1) & 0xff;
      if (loopMode === 'toggle' || loopMode === 255) slot[2] = 255;
      else if (loopMode === 'hold' || loopMode === 254) slot[2] = 254;
      else if (loopMode === 'until_next' || loopMode === 253) slot[2] = 253;
      else slot[2] = Math.max(1, Math.min(250, Number(loopMode) || 1));
    } else if (category === 'polling_switch') {
      slot[0] = 7;
    } else if (category === 'lighting_switch') {
      slot[0] = 8;
      slot[1] = 4;
    } else if (category === 'profile_cycle') {
      slot[0] = 9;
    } else if (category === 'sniper') {
      const targetDpi = Math.max(50, Math.min(this.profile?.maxDpi || 30000, Number(value) || 400));
      slot[0] = 10;
      if (this.profile?.jmNewProto) {
        const enc = targetDpi - 1;
        slot[1] = enc & 0xff;
        slot[2] = (enc >> 8) & 0xff;
      } else {
        slot[1] = Math.max(0, Math.round((targetDpi - 100) / 50) + 1) & 0xff;
      }
    } else {
      // disabled
      slot[0] = 0;
    }

    slot[3] = this.calculateChecksum(slot);
    await this.setBuffer(96 + 4 * (btnId - 1), slot);

    if (extData) {
      await this.setBuffer(256 + 32 * (btnId - 1), extData);
    }
    return true;
  }

  // === Macro Flash Slots (768 + 384 * (slot - 1)) ===

  async getAllMacros(slots = 8) {
    const out = {};
    for (let slot = 1; slot <= slots; slot++) {
      const base = 768 + 384 * (slot - 1);
      const header = await this.getBuffer(base, 32);
      const nameLen = header[0];
      const actionCount = header[31];

      let name = `Macro ${slot}`;
      if (nameLen > 0 && nameLen <= 30) {
        name = String.fromCharCode(...header.slice(1, 1 + nameLen));
      }

      if (actionCount > 0 && actionCount <= MacroCompiler.MAX_ACTIONS) {
        const dataLen = actionCount * 5;
        const body = await this.getBuffer(base + 32, dataLen);
        out[slot] = {
          name,
          events: MacroCompiler.decompile(body),
          actionCount,
        };
      } else {
        out[slot] = {
          name,
          events: [],
          actionCount: 0,
        };
      }
    }
    return out;
  }

  async setMacro(macroSlot, name, events) {
    const { bytecode, actionCount } = MacroCompiler.compile(events || []);
    const base = 768 + 384 * (macroSlot - 1);

    if (actionCount === 0) {
      return this.deleteMacro(macroSlot);
    }

    const ascii = String(name || `Macro ${macroSlot}`).slice(0, 30);
    // Construct [actionCount, ...bytecode, 0] to match official JM CheckSum(e)
    const e = new Uint8Array(2 + bytecode.length);
    e[0] = actionCount;
    e.set(bytecode, 1);
    e[e.length - 1] = 0;
    e[e.length - 1] = this.calculateChecksum(e);

    const payload = new Uint8Array(31 + e.length).fill(0xff);
    payload[0] = ascii.length;
    for (let i = 0; i < ascii.length; i++) {
      payload[1 + i] = ascii.charCodeAt(i) & 0x7f;
    }
    payload.set(e, 31);

    await this.setBuffer(base, payload);
    return { actionCount, bytesWritten: payload.length };
  }

  async deleteMacro(macroSlot) {
    // Full 33B slot-start write guarantees MCU commits ActionCount=0 (verified on live 0x1193)
    const base = 768 + 384 * (macroSlot - 1);
    const cleared = new Uint8Array(33).fill(0xff);
    cleared[0] = 0;
    cleared[31] = 0;
    cleared[32] = 0x55;
    await this.setBuffer(base, cleared);
    return true;
  }

  // === Full NVRAM Snapshot Backup / Restore ===

  async dumpFullProfileSnapshot() {
    const activeProfile = await this.getActiveProfile().catch(() => this.activeProfile || 1);
    const nvramCore = await this.getBuffer(0, 192);
    const nvramButtonsExt = await this.getBuffer(256, 224); // slots 1..7 * 32B
    const macros = await this.getAllMacros(8);
    return {
      schema: 'dareu-nvram-v1',
      pid: this.profile?.pid || 0x1193,
      model: this.profile?.name || 'Dareu A950',
      activeProfile,
      nvram_0_191: Array.from(nvramCore),
      nvram_256_479: Array.from(nvramButtonsExt),
      macros,
    };
  }

  async restoreProfileSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.nvram_0_191) || snapshot.nvram_0_191.length !== 192) {
      throw new Error('Invalid NVRAM snapshot payload (expected 192 bytes in nvram_0_191).');
    }
    await this.setBuffer(0, Uint8Array.from(snapshot.nvram_0_191));
    if (Array.isArray(snapshot.nvram_256_479) && snapshot.nvram_256_479.length > 0) {
      await this.setBuffer(256, Uint8Array.from(snapshot.nvram_256_479.slice(0, 224)));
    }
    return true;
  }

  async setFactoryReset() {
    await this.sendCommand(9, 0, 0, []);
    await new Promise(r => setTimeout(r, 400));
    return true;
  }
}
