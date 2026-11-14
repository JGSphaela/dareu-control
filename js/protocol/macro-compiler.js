/**
 * Dareu Macro, Chord, Media & Power HID Compiler / Decompiler
 * Matches JM 5-byte macro actions and 32-byte key-chord NVRAM layout (addr 256 + 32*idx).
 */

export const MACRO_EVENT_TYPE = {
  KEY_DOWN: 'key_down',
  KEY_UP: 'key_up',
  MOUSE_DOWN: 'mouse_down',
  MOUSE_UP: 'mouse_up',
  WHEEL_UP: 'wheel_up',
  WHEEL_DOWN: 'wheel_down',
  DELAY: 'delay',
};

export const MOUSE_BUTTONS = {
  LEFT: { bit: 1, name: 'Left Click' },
  RIGHT: { bit: 2, name: 'Right Click' },
  MIDDLE: { bit: 4, name: 'Middle Click' },
  BACKWARD: { bit: 8, name: 'Backward (Mouse 4)' },
  FORWARD: { bit: 16, name: 'Forward (Mouse 5)' },
};

export const MODIFIER_KEYS = {
  LEFT_CTRL: { bit: 1, label: 'Ctrl', name: 'Left Ctrl' },
  LEFT_SHIFT: { bit: 2, label: 'Shift', name: 'Left Shift' },
  LEFT_ALT: { bit: 4, label: 'Alt', name: 'Left Alt' },
  LEFT_GUI: { bit: 8, label: 'Win', name: 'Left Win / Cmd' },
  RIGHT_CTRL: { bit: 16, label: 'R-Ctrl', name: 'Right Ctrl' },
  RIGHT_SHIFT: { bit: 32, label: 'R-Shift', name: 'Right Shift' },
  RIGHT_ALT: { bit: 64, label: 'R-Alt', name: 'Right Alt' },
  RIGHT_GUI: { bit: 128, label: 'R-Win', name: 'Right Win / Cmd' },
};

export const MEDIA_KEYS = {
  play_pause: { id: 'play_pause', label: 'Play / Pause', lo: 205, hi: 0, tg: [0, 205] },
  vol_up: { id: 'vol_up', label: 'Volume Up', lo: 233, hi: 0, tg: [0, 233] },
  vol_down: { id: 'vol_down', label: 'Volume Down', lo: 234, hi: 0, tg: [0, 234] },
  mute: { id: 'mute', label: 'Mute Audio', lo: 226, hi: 0, tg: [0, 226] },
  next_track: { id: 'next_track', label: 'Next Track', lo: 181, hi: 0, tg: [0, 181] },
  prev_track: { id: 'prev_track', label: 'Previous Track', lo: 182, hi: 0, tg: [0, 182] },
  stop_media: { id: 'stop_media', label: 'Stop Media', lo: 183, hi: 0, tg: [0, 183] },
  media_player: { id: 'media_player', label: 'Media Player', lo: 131, hi: 1, tg: [1, 131] },
  email: { id: 'email', label: 'Mail Client', lo: 138, hi: 1, tg: [1, 138] },
  calculator: { id: 'calculator', label: 'Calculator', lo: 146, hi: 1, tg: [1, 146] },
  my_computer: { id: 'my_computer', label: 'File Explorer', lo: 148, hi: 1, tg: [1, 148] },
  browser_home: { id: 'browser_home', label: 'Browser Home', lo: 35, hi: 2, tg: [2, 35] },
  browser_search: { id: 'browser_search', label: 'Browser Search', lo: 33, hi: 2, tg: [2, 33] },
  browser_refresh: { id: 'browser_refresh', label: 'Browser Refresh', lo: 39, hi: 2, tg: [2, 39] },
  browser_bookmarks: { id: 'browser_bookmarks', label: 'Bookmarks', lo: 42, hi: 2, tg: [2, 42] },
  browser_stop: { id: 'browser_stop', label: 'Browser Stop', lo: 38, hi: 2, tg: [2, 38] },
  browser_forward: { id: 'browser_forward', label: 'Browser Forward', lo: 37, hi: 2, tg: [2, 37] },
  browser_back: { id: 'browser_back', label: 'Browser Back', lo: 36, hi: 2, tg: [2, 36] },
};

export const POWER_KEYS = {
  power: { id: 'power', label: 'System Power', code: 129 },
  sleep: { id: 'sleep', label: 'Sleep Mode', code: 130 },
  wake: { id: 'wake', label: 'Wake System', code: 131 },
};

export const USB_HID_KEYMAP = {
  4: 'A', 5: 'B', 6: 'C', 7: 'D', 8: 'E', 9: 'F', 10: 'G', 11: 'H', 12: 'I', 13: 'J',
  14: 'K', 15: 'L', 16: 'M', 17: 'N', 18: 'O', 19: 'P', 20: 'Q', 21: 'R', 22: 'S', 23: 'T',
  24: 'U', 25: 'V', 26: 'W', 27: 'X', 28: 'Y', 29: 'Z',
  30: '1', 31: '2', 32: '3', 33: '4', 34: '5', 35: '6', 36: '7', 37: '8', 38: '9', 39: '0',
  40: 'Enter', 41: 'Escape', 42: 'Backspace', 43: 'Tab', 44: 'Space',
  45: '-', 46: '=', 47: '[', 48: ']', 49: '\\', 51: ';', 52: "'", 53: '`', 54: ',', 55: '.', 56: '/',
  57: 'Caps Lock',
  58: 'F1', 59: 'F2', 60: 'F3', 61: 'F4', 62: 'F5', 63: 'F6', 64: 'F7', 65: 'F8', 66: 'F9', 67: 'F10', 68: 'F11', 69: 'F12',
  70: 'PrintScreen', 71: 'ScrollLock', 72: 'Pause', 73: 'Insert', 74: 'Home', 75: 'PageUp', 76: 'Delete', 77: 'End', 78: 'PageDown',
  79: 'Right', 80: 'Left', 81: 'Down', 82: 'Up',
  83: 'NumLock', 84: 'Num /', 85: 'Num *', 86: 'Num -', 87: 'Num +', 88: 'Num Enter',
  89: 'Num 1', 90: 'Num 2', 91: 'Num 3', 92: 'Num 4', 93: 'Num 5', 94: 'Num 6', 95: 'Num 7', 96: 'Num 8', 97: 'Num 9', 98: 'Num 0', 99: 'Num .',
  224: 'Left Ctrl', 225: 'Left Shift', 226: 'Left Alt', 227: 'Left Win',
  228: 'Right Ctrl', 229: 'Right Shift', 230: 'Right Alt', 231: 'Right Win',
};

export const CODE_TO_HID = {
  KeyA: 4, KeyB: 5, KeyC: 6, KeyD: 7, KeyE: 8, KeyF: 9, KeyG: 10, KeyH: 11, KeyI: 12, KeyJ: 13,
  KeyK: 14, KeyL: 15, KeyM: 16, KeyN: 17, KeyO: 18, KeyP: 19, KeyQ: 20, KeyR: 21, KeyS: 22, KeyT: 23,
  KeyU: 24, KeyV: 25, KeyW: 26, KeyX: 27, KeyY: 28, KeyZ: 29,
  Digit1: 30, Digit2: 31, Digit3: 32, Digit4: 33, Digit5: 34, Digit6: 35, Digit7: 36, Digit8: 37, Digit9: 38, Digit0: 39,
  Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44,
  Minus: 45, Equal: 46, BracketLeft: 47, BracketRight: 48, Backslash: 49, Semicolon: 51, Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56,
  CapsLock: 57,
  F1: 58, F2: 59, F3: 60, F4: 61, F5: 62, F6: 63, F7: 64, F8: 65, F9: 66, F10: 67, F11: 68, F12: 69,
  PrintScreen: 70, ScrollLock: 71, Pause: 72, Insert: 73, Home: 74, PageUp: 75, Delete: 76, End: 77, PageDown: 78,
  ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82,
  NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85, NumpadSubtract: 86, NumpadAdd: 87, NumpadEnter: 88,
  Numpad1: 89, Numpad2: 90, Numpad3: 91, Numpad4: 92, Numpad5: 93, Numpad6: 94, Numpad7: 95, Numpad8: 96, Numpad9: 97, Numpad0: 98, NumpadDecimal: 99,
  ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227,
  ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231,
};

export const JS_KEY_TO_HID = {
  65: 4, 66: 5, 67: 6, 68: 7, 69: 8, 70: 9, 71: 10, 72: 11, 73: 12, 74: 13, 75: 14, 76: 15, 77: 16, 78: 17, 79: 18, 80: 19, 81: 20, 82: 21, 83: 22, 84: 23, 85: 24, 86: 25, 87: 26, 88: 27, 89: 28, 90: 29,
  49: 30, 50: 31, 51: 32, 52: 33, 53: 34, 54: 35, 55: 36, 56: 37, 57: 38, 48: 39,
  13: 40, 27: 41, 8: 42, 9: 43, 32: 44,
  189: 45, 187: 46, 219: 47, 221: 48, 220: 49, 186: 51, 222: 52, 192: 53, 188: 54, 190: 55, 191: 56, 20: 57,
  112: 58, 113: 59, 114: 60, 115: 61, 116: 62, 117: 63, 118: 64, 119: 65, 120: 66, 121: 67, 122: 68, 123: 69,
  44: 70, 145: 71, 19: 72, 45: 73, 36: 74, 33: 75, 46: 76, 35: 77, 34: 78,
  39: 79, 37: 80, 40: 81, 38: 82,
  16: 225, 17: 224, 18: 226, 91: 227,
};

export function jmChecksum(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length - 1; i++) {
    sum += buf[i];
  }
  return (sum < 55 ? 85 - sum : 341 - sum) & 0xff;
}

export class MacroCompiler {
  static MAX_ACTIONS = 70; // 70 * 5B = 350B (+33B header/trailer <= 384B JM macro slot stride)

  static getKeyName(hidCode) {
    return USB_HID_KEYMAP[hidCode] || `HID #${hidCode}`;
  }

  static domEventToHid(event) {
    if (!event) return 0;
    if (event.code && CODE_TO_HID[event.code]) return CODE_TO_HID[event.code];
    if (event.keyCode && JS_KEY_TO_HID[event.keyCode]) return JS_KEY_TO_HID[event.keyCode];
    return 0;
  }

  static isModifierHid(hidCode) {
    return hidCode >= 224 && hidCode <= 231;
  }

  static modifierBitFromEvent(event) {
    if (!event) return 0;
    let mask = 0;
    if (event.ctrlKey || event.code === 'ControlLeft') mask |= 1;
    if (event.shiftKey || event.code === 'ShiftLeft') mask |= 2;
    if (event.altKey || event.code === 'AltLeft') mask |= 4;
    if (event.metaKey || event.code === 'MetaLeft') mask |= 8;
    if (event.code === 'ControlRight') mask |= 16;
    if (event.code === 'ShiftRight') mask |= 32;
    if (event.code === 'AltRight') mask |= 64;
    if (event.code === 'MetaRight') mask |= 128;
    return mask;
  }

  static formatChordSummary(modifiersMask = 0, keyCodes = []) {
    const parts = [];
    if (modifiersMask & (1 | 16)) parts.push('Ctrl');
    if (modifiersMask & (2 | 32)) parts.push('Shift');
    if (modifiersMask & (4 | 64)) parts.push('Alt');
    if (modifiersMask & (8 | 128)) parts.push('Win');
    for (const code of keyCodes) {
      if (code > 0 && !this.isModifierHid(code)) {
        parts.push(this.getKeyName(code));
      }
    }
    return parts.join(' + ') || 'Unassigned Key';
  }

  /**
   * Build the 32B-aligned JM Make+Break buffer stored at addr 256 + 32*(btnId-1).
   * Matches dareu_src/device/jmdevice.js lines 98-107 (up to 3 simultaneous items).
   */
  static encodeKeyChordBuffer(modifiersMask = 0, keyCodes = []) {
    const items = [];
    const modBits = [
      [1, 1],
      [2, 2],
      [4, 4],
      [8, 8],
      [16, 1],
      [32, 2],
      [64, 4],
      [128, 8],
    ];
    for (const [maskBit, jmBit] of modBits) {
      if ((modifiersMask & maskBit) && items.length < 3) {
        items.push({ type: 128, code: jmBit });
      }
    }
    for (const keyCode of keyCodes) {
      if (items.length >= 3) break;
      if (keyCode > 0 && !this.isModifierHid(keyCode)) {
        items.push({ type: 129, code: keyCode & 0xff });
      }
    }
    if (items.length === 0) return null;

    const totalLen = 6 * items.length + 2;
    const buf = new Uint8Array(totalLen).fill(0);
    buf[0] = 2 * items.length;
    for (let i = 0; i < items.length; i++) {
      // Make sequence (forward)
      buf[3 * i + 1] = items[i].type;
      buf[3 * i + 2] = items[i].code;
      // Break sequence (reverse order)
      const breakIdx = totalLen - 3 * (i + 1) - 1;
      buf[breakIdx] = (items[i].type & 15) | 64;
      buf[breakIdx + 1] = items[i].code;
    }
    buf[totalLen - 1] = jmChecksum(buf);
    return buf;
  }

  static encodeMediaBuffer(mediaId) {
    const entry = MEDIA_KEYS[mediaId] || MEDIA_KEYS.play_pause;
    const buf = new Uint8Array([2, 130, entry.lo, entry.hi, 66, entry.lo, entry.hi, 0]);
    buf[7] = jmChecksum(buf);
    return buf;
  }

  static encodePowerBuffer(powerId) {
    const entry = POWER_KEYS[powerId] || POWER_KEYS.power;
    const buf = new Uint8Array([2, 131, entry.code, 0, 67, entry.code, 0, 0]);
    buf[7] = jmChecksum(buf);
    return buf;
  }

  /**
   * Decode the 32-byte key-chord/media/power block from NVRAM 256 + 32*(btnId-1).
   */
  static decodeKeyChordBuffer(buf) {
    if (!buf || buf.length < 8) {
      return { kind: 'keyboard', modifiersMask: 0, keyCodes: [], label: 'Keyboard Key' };
    }
    const lenField = buf[0];
    if (lenField !== 2 && lenField !== 4 && lenField !== 6) {
      return { kind: 'keyboard', modifiersMask: 0, keyCodes: [], label: 'Keyboard Key' };
    }
    const count = lenField / 2;
    const firstType = buf[1];

    if (firstType === 130) {
      const lo = buf[2];
      const hi = buf[3];
      const media = Object.values(MEDIA_KEYS).find(m => m.lo === lo && m.hi === hi);
      return {
        kind: 'media',
        mediaId: media ? media.id : 'play_pause',
        label: media ? media.label : `Media (0x${((hi << 8) | lo).toString(16)})`,
      };
    }

    if (firstType === 131) {
      const code = buf[2];
      const power = Object.values(POWER_KEYS).find(p => p.code === code);
      return {
        kind: 'power',
        powerId: power ? power.id : 'power',
        label: power ? power.label : `Power (${code})`,
      };
    }

    let modifiersMask = 0;
    const keyCodes = [];
    for (let i = 0; i < count; i++) {
      const t = buf[1 + 3 * i];
      const c = buf[2 + 3 * i];
      if (t === 128) modifiersMask |= c;
      else if (t === 129 && c > 0) keyCodes.push(c);
    }

    return {
      kind: 'keyboard',
      modifiersMask,
      keyCodes,
      label: this.formatChordSummary(modifiersMask, keyCodes),
    };
  }

  /**
   * Compile timeline events into JM 5-byte macro instructions (max 70 actions).
   */
  static compile(events) {
    const actions = [];
    let pendingDelay = 0;
    let truncated = false;

    const pushAction = (dirByte, code, delay) => {
      if (actions.length >= this.MAX_ACTIONS) {
        truncated = true;
        return;
      }
      const clampedDelay = Math.min(65535, Math.max(0, Math.round(delay)));
      actions.push([dirByte & 0xff, code & 0xff, (clampedDelay >> 8) & 0xff, clampedDelay & 0xff, 0]);
    };

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === MACRO_EVENT_TYPE.DELAY) {
        pendingDelay += Math.max(1, Math.round(Number(ev.ms) || 10));
        continue;
      }

      let lookaheadDelay = pendingDelay;
      pendingDelay = 0;
      if (i + 1 < events.length && events[i + 1].type === MACRO_EVENT_TYPE.DELAY) {
        lookaheadDelay += Math.max(1, Math.round(Number(events[i + 1].ms) || 10));
        i++;
      }

      if (ev.type === MACRO_EVENT_TYPE.KEY_DOWN || ev.type === MACRO_EVENT_TYPE.KEY_UP) {
        const isDown = ev.type === MACRO_EVENT_TYPE.KEY_DOWN;
        const code = ev.keycode ?? ev.code ?? 0x04;
        pushAction(isDown ? 0x82 : 0x02, code, lookaheadDelay);
      } else if (ev.type === MACRO_EVENT_TYPE.MOUSE_DOWN || ev.type === MACRO_EVENT_TYPE.MOUSE_UP) {
        const isDown = ev.type === MACRO_EVENT_TYPE.MOUSE_DOWN;
        const btnInfo = MOUSE_BUTTONS[ev.button] || { bit: 1 };
        pushAction(isDown ? 0x81 : 0x01, btnInfo.bit, lookaheadDelay);
      } else if (ev.type === MACRO_EVENT_TYPE.WHEEL_UP || ev.type === MACRO_EVENT_TYPE.WHEEL_DOWN) {
        const isUp = ev.type === MACRO_EVENT_TYPE.WHEEL_UP;
        pushAction(0x83, isUp ? 1 : 0xff, lookaheadDelay);
      }
    }

    const buf = new Uint8Array(actions.length * 5);
    actions.forEach((a, idx) => buf.set(a, idx * 5));
    return { bytecode: buf, actionCount: actions.length, truncated };
  }

  /**
   * Decompile JM 5-byte macro instructions back into UI timeline events.
   */
  static decompile(bytes) {
    const events = [];
    if (!bytes || bytes.length < 5) return events;

    const count = Math.floor(bytes.length / 5);
    for (let i = 0; i < count; i++) {
      const offset = i * 5;
      const dirByte = bytes[offset];
      const code = bytes[offset + 1];
      const delayMs = (bytes[offset + 2] << 8) | bytes[offset + 3];

      const isDown = (dirByte & 0x80) !== 0;
      const typeFlag = dirByte & 0x0f;

      if (typeFlag === 0x02) {
        events.push({
          type: isDown ? MACRO_EVENT_TYPE.KEY_DOWN : MACRO_EVENT_TYPE.KEY_UP,
          keycode: code,
          keyName: this.getKeyName(code),
        });
      } else if (typeFlag === 0x01) {
        const btnKey = Object.keys(MOUSE_BUTTONS).find(k => MOUSE_BUTTONS[k].bit === code) || 'LEFT';
        events.push({
          type: isDown ? MACRO_EVENT_TYPE.MOUSE_DOWN : MACRO_EVENT_TYPE.MOUSE_UP,
          button: btnKey,
          buttonName: MOUSE_BUTTONS[btnKey].name,
        });
      } else if (typeFlag === 0x03) {
        events.push({
          type: code === 1 ? MACRO_EVENT_TYPE.WHEEL_UP : MACRO_EVENT_TYPE.WHEEL_DOWN,
        });
      }

      if (delayMs > 0) {
        events.push({ type: MACRO_EVENT_TYPE.DELAY, ms: delayMs });
      }
    }

    return events;
  }
}
