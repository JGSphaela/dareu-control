/**
 * Dareu TG Protocol Driver (64-byte HID Feature Reports)
 * Supports: A950 AIR TM275F TG (0x1147), A980 PRO (0x1130),
 *           A980 PRO MAX (0x1129), A980 Wired (0x1045).
 */

import { MacroCompiler, MEDIA_KEYS, POWER_KEYS } from './macro-compiler.js?v=4.1.0';

export const TG_CMD_CLASS = {
  DEVICE: 0,
  KEY: 1,
  BUTTON: 2,
  LIGHTING: 3,
  SENSOR: 4,
  PROFILE: 5,
  MACRO: 6,
  POWER: 7,
};

export const TG_POLLING_TO_CODE = {
  125: 64,
  250: 32,
  500: 16,
  1000: 8,
  2000: 4,
  4000: 2,
  8000: 1,
};

export const TG_CODE_TO_POLLING = Object.fromEntries(
  Object.entries(TG_POLLING_TO_CODE).map(([hz, code]) => [code, Number(hz)])
);

export const TG_FUNCTION_INDEX = {
  Off: 0,
  MouseButton: 1,
  DoubleClick: 2,
  TurboButton: 3,
  Wheel: 4,
  CombineKey: 6,
  PowerKeys: 7,
  MediaKeys: 8,
  MacroType1: 12,
  MacroType2: 13,
  MacroType3: 14,
  MacroType4: 15,
  DpiStageUp: 16,
  DpiStageDown: 17,
  DpiStageCycleUp: 19,
  DpiOTF2: 22,
  ProfileCycleDown: 27,
  HorizontalWheel: 34,
  PollingRateSwitch: 59,
};

const MOD_MASK_ORDER = [1, 2, 4, 8, 16, 32, 64, 128];

export class TgDevice {
  constructor(hidDevice, profile, logCallback = null) {
    this.hidDevice = hidDevice;
    this.device = hidDevice;
    this.profile = profile || {};
    this.logger = logCallback || (() => {});
    this.reportId = profile?.reportId ?? 0;
    this.reportSize = profile?.reportSize ?? 64;
    this.targetId = profile?.wireless ? 0x10 : 0x00;
    this.activeProfile = 1;
    this.sensorId = 0;
  }

  dispose() {}

  async sendFeatureReport(classId, cmdId, payload = [], profileId = this.activeProfile || 1, explicitSize = null) {
    const pkt = new Uint8Array(this.reportSize).fill(0);
    pkt[0] = this.targetId;
    pkt[1] = explicitSize !== null ? explicitSize : payload.length;
    pkt[2] = classId;
    pkt[3] = cmdId;
    pkt[4] = profileId;
    pkt[5] = 0;
    for (let i = 0; i < payload.length && 6 + i < this.reportSize; i++) {
      pkt[6 + i] = payload[i] & 0xff;
    }

    this.logger('TX', this.reportId, pkt);
    await this.hidDevice.sendFeatureReport(this.reportId, pkt);

    for (let attempt = 0; attempt < 25; attempt++) {
      await new Promise(r => setTimeout(r, 12));
      const respView = await this.hidDevice.receiveFeatureReport(this.reportId);
      const resp = new Uint8Array(respView.buffer, respView.byteOffset, respView.byteLength);
      if ((resp[0] & 0x0f) === 2) {
        this.logger('RX', this.reportId, resp);
        return resp;
      }
    }
    throw new Error(`TG HID timeout (class=${classId}, cmd=0x${cmdId.toString(16)})`);
  }

  async initDevice() {
    try {
      const attr = await this.getSensorAttribute();
      this.sensorId = attr.sensorId ?? 0;
    } catch (_) {}
    try {
      this.activeProfile = await this.getActiveProfile();
    } catch (_) {}
    return true;
  }

  // === Device Info & Battery ===

  async getFirmwareVersion() {
    const resp = await this.sendFeatureReport(TG_CMD_CLASS.DEVICE, 0x80, [], 1, 3);
    const maj = resp[6];
    const min = resp[7];
    return `v${maj.toString(16).padStart(2, '0')}.${min.toString(16).padStart(2, '0')}`;
  }

  async getBatteryStatus() {
    const resp = await this.sendFeatureReport(TG_CMD_CLASS.POWER, 0x80, [], 1, 2);
    return {
      level: resp[6],
      charging: resp[7] === 1,
    };
  }

  async getPollingRate() {
    const resp = await this.sendFeatureReport(TG_CMD_CLASS.DEVICE, 0x84, [], this.activeProfile, 2);
    const rateCode = resp[7];
    return TG_CODE_TO_POLLING[rateCode] || 1000;
  }

  async setPollingRate(hz) {
    const code = TG_POLLING_TO_CODE[Number(hz)] ?? 8;
    await this.sendFeatureReport(TG_CMD_CLASS.DEVICE, 0x04, [0, code], this.activeProfile, 2);
    return true;
  }

  // === Profiles ===

  async getActiveProfile() {
    const resp = await this.sendFeatureReport(TG_CMD_CLASS.PROFILE, 0x83, [], 0, 0);
    const pid = Math.max(1, Math.min(4, resp[4] || 1));
    this.activeProfile = pid;
    return pid;
  }

  async setActiveProfile(profileId) {
    const pid = Math.max(1, Math.min(4, Number(profileId) || 1));
    await this.sendFeatureReport(TG_CMD_CLASS.PROFILE, 0x03, [], pid, 0);
    this.activeProfile = pid;
    return pid;
  }

  // === Sensor & Tuning ===

  async getSensorAttribute() {
    const resp = await this.sendFeatureReport(TG_CMD_CLASS.SENSOR, 0x80, [], 1, 8);
    return {
      sensorId: resp[6],
      model: resp[7],
      dpiMax: (resp[8] << 8) | resp[9],
      dpiStep: resp[10] || 50,
      liftedSupport: resp[11] === 1,
    };
  }

  async getSensorSettings() {
    const settings = {
      lod: 1,
      debounceMs: 4,
      motionSync: true,
      angleSnapping: false,
      rippleControl: false,
      sleepEnabled: true,
      sleepTimeoutSec: 300,
      sensorMode: 0,
    };

    try {
      const lodResp = await this.sendFeatureReport(TG_CMD_CLASS.SENSOR, 0x86, [], this.activeProfile, 1);
      settings.lod = lodResp[6] === 2 ? 2 : 1;
    } catch (_) {}

    try {
      const debResp = await this.sendFeatureReport(TG_CMD_CLASS.BUTTON, 0x82, [], this.activeProfile, 1);
      if (debResp[6] > 0 && debResp[6] <= 30) settings.debounceMs = debResp[6];
    } catch (_) {}

    try {
      const feat = await this.sendFeatureReport(TG_CMD_CLASS.SENSOR, 0x8a, [0], this.activeProfile, 2);
      settings.angleSnapping = feat[7] === 1;
    } catch (_) {}

    try {
      const pwr = await this.sendFeatureReport(TG_CMD_CLASS.POWER, 0x82, [], 1, 3);
      settings.sleepEnabled = pwr[6] === 1;
      const secs = (pwr[7] << 8) | pwr[8];
      if (secs > 0) settings.sleepTimeoutSec = secs;
    } catch (_) {}

    return settings;
  }

  async setAngleSnapping(enable) {
    await this.sendFeatureReport(TG_CMD_CLASS.SENSOR, 0x0a, [0, enable ? 1 : 0], this.activeProfile, 2);
    return true;
  }

  async setLiftOffDistance(is2mm) {
    await this.sendFeatureReport(TG_CMD_CLASS.SENSOR, 0x06, [is2mm ? 2 : 1], this.activeProfile, 1);
    return true;
  }

  async setMotionSync(enable) {
    await this.sendFeatureReport(TG_CMD_CLASS.SENSOR, 0x0a, [1, enable ? 1 : 0], this.activeProfile, 2);
    return true;
  }

  async setRippleControl(enable) {
    await this.sendFeatureReport(TG_CMD_CLASS.SENSOR, 0x0a, [2, enable ? 1 : 0], this.activeProfile, 2);
    return true;
  }

  async setSensorMode(mode) {
    await this.sendFeatureReport(TG_CMD_CLASS.SENSOR, 0x05, [Number(mode) || 0], this.activeProfile, 1);
    return true;
  }

  async setDebounceTime(ms) {
    await this.sendFeatureReport(TG_CMD_CLASS.BUTTON, 0x02, [Math.max(1, Math.min(30, Number(ms) || 4))], this.activeProfile, 1);
    return true;
  }

  async setSleepEnabled(enable) {
    await this.sendFeatureReport(TG_CMD_CLASS.POWER, 0x02, [enable ? 1 : 0, 0x01, 0x2c], 1, 3);
    return true;
  }

  async setSleepTimeout(seconds) {
    const s = Math.max(30, Math.min(3600, Number(seconds) || 300));
    await this.sendFeatureReport(TG_CMD_CLASS.POWER, 0x02, [1, (s >> 8) & 0xff, s & 0xff], 1, 3);
    return true;
  }

  // === DPI Engine ===

  async getDpiStages() {
    const resp = await this.sendFeatureReport(TG_CMD_CLASS.SENSOR, 0x83, [this.sensorId], this.activeProfile, 0);
    const stageCount = Math.max(1, Math.min(8, resp[7] || 4));
    const activeStage = Math.max(1, Math.min(stageCount, (resp[8] ?? 0) + 1));
    const stages = [];
    for (let i = 0; i < stageCount; i++) {
      const base = 9 + 4 * i;
      const dpiX = (resp[base] << 8) | resp[base + 1];
      const dpiY = (resp[base + 2] << 8) | resp[base + 3];
      stages.push({ dpiX: dpiX || 800, dpiY: dpiY || 800 });
    }
    return { activeStage, stageCount, stages };
  }

  async setDpiStages(stages, activeStage = 1) {
    const count = Math.max(1, Math.min(8, stages.length));
    const clampedActive = Math.max(0, Math.min(count - 1, (Number(activeStage) || 1) - 1));
    const payload = new Uint8Array(3 + 32).fill(0);
    payload[0] = this.sensorId;
    payload[1] = count;
    payload[2] = clampedActive;
    for (let i = 0; i < count; i++) {
      const dx = Math.max(50, Math.round(stages[i].dpiX));
      const dy = Math.max(50, Math.round(stages[i].dpiY));
      const off = 3 + 4 * i;
      payload[off] = (dx >> 8) & 0xff;
      payload[off + 1] = dx & 0xff;
      payload[off + 2] = (dy >> 8) & 0xff;
      payload[off + 3] = dy & 0xff;
    }
    await this.sendFeatureReport(TG_CMD_CLASS.SENSOR, 0x03, payload, this.activeProfile, 29);
    return true;
  }

  async setActiveDpiStage(stageNum) {
    const current = await this.getDpiStages();
    return this.setDpiStages(current.stages, stageNum);
  }

  // === Buttons ===

  async getButtonAssignments(keyCount = 6) {
    const mappings = {};
    for (let btnId = 1; btnId <= keyCount; btnId++) {
      const resp = await this.sendFeatureReport(TG_CMD_CLASS.BUTTON, 0x83, [btnId, 0], this.activeProfile, 8);
      const funcId = resp[8];
      const fd = resp.slice(9, 14);
      let category = 'disabled';
      let value = null;
      let loopMode = 1;

      if (funcId === TG_FUNCTION_INDEX.MouseButton) {
        category = 'mouse';
        value = fd[0] || 1;
      } else if (funcId === TG_FUNCTION_INDEX.DoubleClick) {
        category = 'double_click';
        value = 1;
      } else if (funcId === TG_FUNCTION_INDEX.TurboButton) {
        category = 'turbo';
        value = (fd[1] << 8) | fd[2] || 20;
      } else if (funcId === TG_FUNCTION_INDEX.Wheel) {
        category = 'wheel';
        value = fd[0] === 255 ? 'scroll_down' : 'scroll_up';
      } else if (funcId === TG_FUNCTION_INDEX.HorizontalWheel) {
        category = 'hwheel';
        value = fd[0] === 255 ? 'scroll_left' : 'scroll_right';
      } else if (funcId === TG_FUNCTION_INDEX.CombineKey) {
        category = 'keyboard';
        value = {
          modifiersMask: fd[0],
          keyCodes: [fd[1], fd[2]].filter(c => c > 0),
          label: MacroCompiler.formatChordSummary(fd[0], [fd[1], fd[2]].filter(c => c > 0)),
        };
      } else if (funcId === TG_FUNCTION_INDEX.PowerKeys) {
        category = 'power';
        const match = Object.values(POWER_KEYS).find(p => p.code === fd[0]);
        value = match ? match.id : 'power';
      } else if (funcId === TG_FUNCTION_INDEX.MediaKeys) {
        category = 'media';
        const match = Object.values(MEDIA_KEYS).find(m => m.tg[0] === fd[0] && m.tg[1] === fd[1]);
        value = match ? match.id : 'play_pause';
      } else if (funcId === TG_FUNCTION_INDEX.DpiStageCycleUp) {
        category = 'dpi';
        value = 'dpi_cycle';
      } else if (funcId === TG_FUNCTION_INDEX.DpiStageUp) {
        category = 'dpi';
        value = 'dpi_up';
      } else if (funcId === TG_FUNCTION_INDEX.DpiStageDown) {
        category = 'dpi';
        value = 'dpi_down';
      } else if (funcId === TG_FUNCTION_INDEX.DpiOTF2) {
        category = 'sniper';
        value = (fd[0] << 8) | fd[1] || 400;
      } else if (funcId === TG_FUNCTION_INDEX.ProfileCycleDown) {
        category = 'profile_cycle';
        value = 1;
      } else if (funcId === TG_FUNCTION_INDEX.PollingRateSwitch) {
        category = 'polling_switch';
        value = 1;
      } else if (funcId >= TG_FUNCTION_INDEX.MacroType1 && funcId <= TG_FUNCTION_INDEX.MacroType4) {
        category = 'macro';
        value = fd[0] || 1;
        if (funcId === TG_FUNCTION_INDEX.MacroType2) loopMode = 'hold';
        else if (funcId === TG_FUNCTION_INDEX.MacroType3) loopMode = 'until_next';
        else if (funcId === TG_FUNCTION_INDEX.MacroType4) loopMode = 'toggle';
        else loopMode = (fd[1] << 8) | fd[2] || 1;
      }

      mappings[btnId] = { btnId, category, value, loopMode };
    }
    return mappings;
  }

  async setButtonAssignment(btnId, category, value, loopMode = 1) {
    let funcId = TG_FUNCTION_INDEX.Off;
    const fd = [0, 0, 0, 0, 0];

    if (category === 'mouse') {
      funcId = TG_FUNCTION_INDEX.MouseButton;
      fd[0] = Number(value) || 1;
    } else if (category === 'double_click') {
      funcId = TG_FUNCTION_INDEX.DoubleClick;
      fd[0] = 1;
    } else if (category === 'turbo') {
      funcId = TG_FUNCTION_INDEX.TurboButton;
      const ms = Math.max(5, Math.min(255, Number(value) || 20));
      fd[0] = 1;
      fd[1] = (ms >> 8) & 0xff;
      fd[2] = ms & 0xff;
    } else if (category === 'wheel') {
      funcId = TG_FUNCTION_INDEX.Wheel;
      fd[0] = value === 'scroll_down' ? 255 : 1;
    } else if (category === 'hwheel') {
      funcId = TG_FUNCTION_INDEX.HorizontalWheel;
      fd[0] = value === 'scroll_left' ? 255 : 1;
    } else if (category === 'dpi') {
      funcId =
        value === 'dpi_up'
          ? TG_FUNCTION_INDEX.DpiStageUp
          : value === 'dpi_down'
          ? TG_FUNCTION_INDEX.DpiStageDown
          : TG_FUNCTION_INDEX.DpiStageCycleUp;
    } else if (category === 'keyboard') {
      funcId = TG_FUNCTION_INDEX.CombineKey;
      if (typeof value === 'number') {
        fd[1] = value & 0xff;
      } else if (value && typeof value === 'object') {
        fd[0] = (value.modifiersMask || 0) & 0xff;
        const codes = Array.isArray(value.keyCodes) ? value.keyCodes : value.key ? [value.key] : [];
        fd[1] = (codes[0] || 0) & 0xff;
        fd[2] = (codes[1] || 0) & 0xff;
      }
    } else if (category === 'media') {
      funcId = TG_FUNCTION_INDEX.MediaKeys;
      const entry = MEDIA_KEYS[value] || MEDIA_KEYS.play_pause;
      fd[0] = entry.tg[0];
      fd[1] = entry.tg[1];
    } else if (category === 'power') {
      funcId = TG_FUNCTION_INDEX.PowerKeys;
      const entry = POWER_KEYS[value] || POWER_KEYS.power;
      fd[0] = entry.code;
    } else if (category === 'sniper') {
      funcId = TG_FUNCTION_INDEX.DpiOTF2;
      const dpi = Math.max(50, Math.round(Number(value) || 400));
      fd[0] = (dpi >> 8) & 0xff;
      fd[1] = dpi & 0xff;
    } else if (category === 'profile_cycle') {
      funcId = TG_FUNCTION_INDEX.ProfileCycleDown;
    } else if (category === 'polling_switch') {
      funcId = TG_FUNCTION_INDEX.PollingRateSwitch;
    } else if (category === 'macro') {
      fd[0] = Number(value) || 1;
      if (loopMode === 'toggle' || loopMode === 255) funcId = TG_FUNCTION_INDEX.MacroType4;
      else if (loopMode === 'hold' || loopMode === 254) funcId = TG_FUNCTION_INDEX.MacroType2;
      else if (loopMode === 'until_next' || loopMode === 253) funcId = TG_FUNCTION_INDEX.MacroType3;
      else {
        funcId = TG_FUNCTION_INDEX.MacroType1;
        const n = Math.max(1, Math.min(250, Number(loopMode) || 1));
        fd[1] = (n >> 8) & 0xff;
        fd[2] = n & 0xff;
      }
    }

    await this.sendFeatureReport(
      TG_CMD_CLASS.BUTTON,
      0x03,
      [btnId, 0, funcId, ...fd],
      this.activeProfile,
      8
    );
    return true;
  }

  // === Macros (CLASS_MACRO = 6) ===

  async getAllMacros(slots = 8) {
    const out = {};
    for (let s = 1; s <= slots; s++) {
      out[s] = { name: `Macro ${s}`, events: [], actionCount: 0 };
    }
    try {
      const idResp = await this.sendFeatureReport(TG_CMD_CLASS.MACRO, 0x81, [], 1, 0);
      const count = idResp[6] || 0;
      for (let i = 0; i < count; i++) {
        const slotId = idResp[7 + i];
        if (!slotId || slotId > slots) continue;
        const nameResp = await this.sendFeatureReport(TG_CMD_CLASS.MACRO, 0x84, [slotId], 1, 1);
        const nameLen = nameResp[7] || 0;
        const name =
          nameLen > 0 && nameLen <= 30
            ? String.fromCharCode(...nameResp.slice(8, 8 + nameLen))
            : `Macro ${slotId}`;
        out[slotId] = { name, events: [], actionCount: 0 };
      }
    } catch (_) {}
    return out;
  }

  async setMacro(macroSlot, name, events) {
    const { bytecode, actionCount } = MacroCompiler.compile(events || []);
    if (actionCount === 0) return this.deleteMacro(macroSlot);

    const ascii = String(name || `Macro ${macroSlot}`).slice(0, 30);
    await this.sendFeatureReport(
      TG_CMD_CLASS.MACRO,
      0x02,
      [macroSlot, (bytecode.length >> 8) & 0xff, bytecode.length & 0xff],
      1,
      3
    );
    const nameBytes = Array.from(ascii, c => c.charCodeAt(0) & 0x7f);
    await this.sendFeatureReport(TG_CMD_CLASS.MACRO, 0x04, [macroSlot, ascii.length, ...nameBytes], 1, 2 + ascii.length);

    let offset = 0;
    while (offset < bytecode.length) {
      const chunk = bytecode.slice(offset, offset + 48);
      await this.sendFeatureReport(
        TG_CMD_CLASS.MACRO,
        0x05,
        [macroSlot, (offset >> 8) & 0xff, offset & 0xff, chunk.length, ...chunk],
        1,
        4 + chunk.length
      );
      offset += chunk.length;
    }
    return { actionCount, bytesWritten: bytecode.length };
  }

  async deleteMacro(macroSlot) {
    await this.sendFeatureReport(TG_CMD_CLASS.MACRO, 0x03, [macroSlot], 1, 1);
    return true;
  }

  async setFactoryReset() {
    await this.sendFeatureReport(TG_CMD_CLASS.DEVICE, 0x08, [1], 1, 1);
    return true;
  }
}
