import assert from 'node:assert/strict';
import { DAREU_DEVICES } from '../js/devices.js';
import { DAREU_MODELS, getModelByPid } from '../js/models.js';
import {
  MacroCompiler,
  MACRO_EVENT_TYPE,
  MEDIA_KEYS,
  POWER_KEYS,
  jmChecksum,
} from '../js/protocol/macro-compiler.js';
import { JmDevice, JM_POLLING_TO_CODE } from '../js/protocol/jm-device.js';
import { TgDevice, TG_FUNCTION_INDEX, TG_POLLING_TO_CODE } from '../js/protocol/tg-device.js';

// Reference CheckSum parity check for JM 16-byte NVRAM protocol
function refCheckSum(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length - 1; i++) sum += buf[i];
  return (sum < 55 ? 85 - sum : 341 - sum) & 0xff;
}

// 1. Registry & Model checks
assert.equal(DAREU_DEVICES[0x1154].isDongle, true);
assert.equal(DAREU_DEVICES[0x1154].fwType, 2);
assert.equal(DAREU_DEVICES[0x1217].maxDpi, 30000);
assert.equal(DAREU_DEVICES[0x1217].sensor, 'AIM-750U');
assert.equal(DAREU_MODELS.A950_AIR.buttons.length, 5);
assert.deepEqual(DAREU_MODELS.A950_AIR.extraNvramSlots, [6]);
assert.equal(getModelByPid(0x1154).id, 'A950_AIR');
assert.equal(getModelByPid(0x1185).maxPolling, 8000);
assert.equal(getModelByPid(0x1130).fwType, 1);

// 2. Checksum parity
for (const sample of [
  [0, 0],
  [1, 0],
  [8, 18, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [5, 0, 0, 0],
  [4, 20, 0, 0],
  [2, 130, 4, 0, 10, 0, 2, 4, 0, 20, 0, 0],
]) {
  assert.equal(jmChecksum(sample), refCheckSum(sample), `Checksum mismatch on ${sample}`);
}
assert.equal(jmChecksum([2, 0x82, 0x04, 0x00, 0x0a, 0x00, 0x02, 0x04, 0x00, 0x14, 0x00, 0]), 169);

// 3. Macro compiler & 70-action guard
const sampleEvents = [
  { type: MACRO_EVENT_TYPE.KEY_DOWN, keycode: 4, keyName: 'A' },
  { type: MACRO_EVENT_TYPE.DELAY, ms: 10 },
  { type: MACRO_EVENT_TYPE.KEY_UP, keycode: 4, keyName: 'A' },
  { type: MACRO_EVENT_TYPE.DELAY, ms: 20 },
];
const compiled = MacroCompiler.compile(sampleEvents);
assert.equal(compiled.actionCount, 2);
assert.equal(compiled.truncated, false);
assert.deepEqual(Array.from(compiled.bytecode), [0x82, 4, 0, 10, 0, 0x02, 4, 0, 20, 0]);
const decompiled = MacroCompiler.decompile(compiled.bytecode);
assert.equal(decompiled.length, 4);
assert.equal(decompiled[0].type, MACRO_EVENT_TYPE.KEY_DOWN);
assert.equal(decompiled[1].ms, 10);

// 75 key events -> truncated cleanly at 70
const tooMany = [];
for (let i = 0; i < 75; i++) tooMany.push({ type: MACRO_EVENT_TYPE.KEY_DOWN, keycode: 4 });
const truncRes = MacroCompiler.compile(tooMany);
assert.equal(truncRes.actionCount, 70);
assert.equal(truncRes.truncated, true);
assert.equal(truncRes.bytecode.length, 350);

// 4. Chord, Media & Power buffers
const chord = MacroCompiler.encodeKeyChordBuffer(1 | 2, [6]); // Ctrl+Shift+C
assert.equal(chord.length, 20);
assert.equal(chord[0], 6);
assert.deepEqual(Array.from(chord.slice(1, 10)), [128, 1, 0, 128, 2, 0, 129, 6, 0]);
assert.equal(chord[19], refCheckSum(chord));
const decodedChord = MacroCompiler.decodeKeyChordBuffer(chord);
assert.equal(decodedChord.kind, 'keyboard');
assert.equal(decodedChord.modifiersMask, 3);
assert.deepEqual(decodedChord.keyCodes, [6]);

const mediaPlay = MacroCompiler.encodeMediaBuffer('play_pause');
assert.deepEqual(Array.from(mediaPlay), [2, 130, 205, 0, 66, 205, 0, 245]);
assert.equal(MacroCompiler.decodeKeyChordBuffer(mediaPlay).mediaId, 'play_pause');

const powerSleep = MacroCompiler.encodePowerBuffer('sleep');
assert.deepEqual(Array.from(powerSleep), [2, 131, 130, 0, 67, 130, 0, 137]);
assert.equal(MacroCompiler.decodeKeyChordBuffer(powerSleep).powerId, 'sleep');

// 5. Mock JmDevice NVRAM round-trip tests (Standard + High-DPI + Buttons + Macro + Profile + LD)
class MockJmHid {
  constructor() {
    this.mem = new Uint8Array(0x7000).fill(0xff);
    this.mem.fill(0, 0, 192);
    this.listeners = new Set();
    this.profile = 1;
    this.longDistance = 0;
  }
  addEventListener(type, fn) { if (type === 'inputreport') this.listeners.add(fn); }
  removeEventListener(type, fn) { this.listeners.delete(fn); }
  async sendReport(reportId, payload) {
    assert.equal(reportId, 8);
    assert.equal(payload.length, 16);
    // verify command checksum on full [8, ...payload]
    const full = new Uint8Array([8, ...payload]);
    assert.equal(payload[15], refCheckSum(full), `Bad outgoing cmd checksum for op=${payload[0]}`);

    const op = payload[0];
    const addr = (payload[2] << 8) | payload[3];
    const len = payload[4];
    const resp = new Uint8Array(16).fill(0);
    resp[0] = op;
    resp[1] = 0;
    resp[2] = payload[2];
    resp[3] = payload[3];
    resp[4] = len;

    if (op === 8) {
      resp.set(this.mem.slice(addr, addr + len), 5);
    } else if (op === 7) {
      this.mem.set(payload.slice(5, 5 + len), addr);
    } else if (op === 18) {
      resp[5] = 0x03; resp[6] = 0x00;
    } else if (op === 4) {
      resp[5] = 95; resp[6] = 1;
    } else if (op === 14) {
      resp[5] = this.profile - 1;
    } else if (op === 15) {
      this.profile = (payload[5] ?? 0) + 1;
    } else if (op === 22) {
      this.longDistance = payload[5];
    } else if (op === 23) {
      resp[5] = this.longDistance;
    } else if (op === 3) {
      resp[5] = 1;
    } else if (op === 1) {
      resp[9] = 4; resp[10] = 9; resp[11] = 2;
    }

    queueMicrotask(() => {
      for (const fn of this.listeners) {
        fn({ reportId: 8, data: new DataView(resp.buffer) });
      }
    });
  }
}

const mockJm = new MockJmHid();
const jmDriver = new JmDevice(mockJm, DAREU_DEVICES[0x1185]);
await jmDriver.initDevice();
assert.equal(await jmDriver.getFirmwareVersion(), 'v03.00');
assert.deepEqual(await jmDriver.getBatteryStatus(), { level: 95, charging: true });

await jmDriver.setLongDistanceMode(true);
assert.equal((await jmDriver.getLongDistanceMode()).enabled, true);

await jmDriver.setPollingRate(8000);
assert.equal(mockJm.mem[0], 64);
assert.equal(await jmDriver.getPollingRate(), 8000);

await jmDriver.setSensorMode(3);
assert.equal(mockJm.mem[185], 3);
await jmDriver.setLiftOffDistance(true);
await jmDriver.setDebounceTime(2);
await jmDriver.setSleepTimeout(600);
const sSettings = await jmDriver.getSensorSettings();
assert.equal(sSettings.lod, 2);
assert.equal(sSettings.debounceMs, 2);
assert.equal(sSettings.sleepTimeoutSec, 600);
assert.equal(sSettings.sensorMode, 3);

// DPI up to 30000 + Asymmetric 16000 X / 800 Y
await jmDriver.setDpiStages([
  { dpiX: 16000, dpiY: 800, color: '#ea5413' },
  { dpiX: 26000, dpiY: 26000, color: '#3b82f6' },
  { dpiX: 30000, dpiY: 30000, color: '#22c55e' },
], 2);
const dpiOut = await jmDriver.getDpiStages();
assert.equal(dpiOut.activeStage, 2);
assert.equal(dpiOut.stageCount, 3);
assert.equal(dpiOut.stages[0].dpiX, 16000);
assert.equal(dpiOut.stages[0].dpiY, 800);
assert.equal(dpiOut.stages[1].dpiX, 26000);
assert.equal(dpiOut.stages[2].dpiX, 30000);
assert.equal(dpiOut.stages[0].color, '#ea5413');

// Button assignments (Turbo, Sniper 800, Chord, Media, Hardware Switches, Macro Toggle)
await jmDriver.setButtonAssignment(1, 'turbo', 20);
await jmDriver.setButtonAssignment(2, 'sniper', 800);
await jmDriver.setButtonAssignment(3, 'keyboard', { modifiersMask: 3, keyCodes: [6] });
await jmDriver.setButtonAssignment(4, 'media', 'play_pause');
await jmDriver.setButtonAssignment(5, 'profile_cycle', 1);
await jmDriver.setButtonAssignment(6, 'macro', 1, 'toggle');

const btns = await jmDriver.getButtonAssignments(6);
assert.equal(btns[1].category, 'turbo');
assert.equal(btns[1].value, 20);
assert.equal(btns[2].category, 'sniper');
assert.equal(btns[2].value, 800);
assert.equal(btns[3].category, 'keyboard');
assert.deepEqual(btns[3].value.keyCodes, [6]);
assert.equal(btns[3].value.modifiersMask, 3);
assert.equal(btns[4].category, 'media');
assert.equal(btns[4].value, 'play_pause');
assert.equal(btns[5].category, 'profile_cycle');
assert.equal(btns[6].category, 'macro');
assert.equal(btns[6].value, 1);
assert.equal(btns[6].loopMode, 'toggle');

// Macro write + checksum + delete
await jmDriver.setMacro(1, 'TestMacro', sampleEvents);
assert.equal(mockJm.mem[768 + 31], 2);
assert.equal(mockJm.mem[768 + 32 + 10], 169); // checksum byte
const macrosRead = await jmDriver.getAllMacros(2);
assert.equal(macrosRead[1].name, 'TestMacro');
assert.equal(macrosRead[1].actionCount, 2);

await jmDriver.deleteMacro(1);
assert.equal(mockJm.mem[768], 0);
assert.equal(mockJm.mem[768 + 31], 0);
assert.equal(mockJm.mem[768 + 32], 0x55);

// 6. Mock TgDevice Feature Report frame checks
class MockTgHid {
  constructor() {
    this.sent = [];
    this.lastResp = new Uint8Array(64).fill(0);
  }
  async sendFeatureReport(reportId, pkt) {
    this.sent.push(Array.from(pkt));
    const resp = new Uint8Array(pkt);
    resp[0] = (pkt[0] & 0xf0) | 0x02; // READY status nibble
    if (pkt[2] === 0 && pkt[3] === 0x84) resp[7] = TG_POLLING_TO_CODE[4000];
    if (pkt[2] === 4 && pkt[3] === 0x80) { resp[6] = 1; resp[8] = 26000 >> 8; resp[9] = 26000 & 0xff; }
    if (pkt[2] === 5 && pkt[3] === 0x83) resp[4] = 2;
    this.lastResp = resp;
  }
  async receiveFeatureReport() {
    return new DataView(this.lastResp.buffer);
  }
}

const mockTg = new MockTgHid();
const tgDriver = new TgDevice(mockTg, DAREU_DEVICES[0x1130]);
assert.equal(await tgDriver.getPollingRate(), 4000);
await tgDriver.setPollingRate(8000);
const lastPollPkt = mockTg.sent[mockTg.sent.length - 1];
assert.equal(lastPollPkt[2], 0);
assert.equal(lastPollPkt[3], 4);
assert.equal(lastPollPkt[7], 1); // 8000 Hz TG code

assert.equal(await tgDriver.getActiveProfile(), 2);
await tgDriver.setButtonAssignment(6, 'sniper', 800);
const lastBtnPkt = mockTg.sent[mockTg.sent.length - 1];
assert.equal(lastBtnPkt[2], 2);
assert.equal(lastBtnPkt[3], 3);
assert.equal(lastBtnPkt[8], TG_FUNCTION_INDEX.DpiOTF2);
assert.equal((lastBtnPkt[9] << 8) | lastBtnPkt[10], 800);

console.log('ALL_PROTOCOL_TESTS_PASSED');
