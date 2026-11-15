/**
 * Dareu Control Application Controller
 * Coordinates WebHID drivers (JM / TG), Demo Mode simulation, NVRAM inspector,
 * button chord/macro editors, and live coalesced polling diagnostics.
 */

import { WebHidManager } from './hid/webhid-manager.js?v=4.1.0';
import {
  MACRO_EVENT_TYPE,
  MOUSE_BUTTONS,
  MEDIA_KEYS,
  POWER_KEYS,
  MacroCompiler,
  jmChecksum,
} from './protocol/macro-compiler.js?v=4.1.0';
import { DAREU_MODELS, getModelByPid } from './models.js?v=4.1.0';
import { i18n, t } from './i18n/index.js?v=4.1.0';

const STAGE_COLOR_PALETTE = [
  '#ea5413',
  '#3b82f6',
  '#22c55e',
  '#eab308',
  '#a855f7',
  '#06b6d4',
  '#f43f5e',
  '#ededed',
];

const JM_POLLING_TO_CODE = {
  125: 8,
  250: 4,
  500: 2,
  1000: 1,
  2000: 16,
  4000: 32,
  8000: 64,
};

const SENSOR_MODE_HINT_KEYS = {
  0: 'sensor.hintMode0',
  1: 'sensor.hintMode1',
  2: 'sensor.hintMode2',
  3: 'sensor.hintMode3',
};

const BUTTON_NAME_KEYS = {
  1: 'buttons.btnLeft',
  2: 'buttons.btnRight',
  3: 'buttons.btnMiddle',
  4: 'buttons.btnBackward',
  5: 'buttons.btnForward',
};

const BUTTON_DEFAULT_ACTION_KEYS = {
  1: 'buttons.mouse1',
  2: 'buttons.mouse2',
  3: 'buttons.mouse3',
  4: 'buttons.mouse4',
  5: 'buttons.mouse5',
  6: 'buttons.sumDpiCycle',
};

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function hexToRgb(hex) {
  const clean = String(hex || '#ea5413').replace('#', '');
  if (clean.length !== 6) return [234, 84, 19];
  const n = parseInt(clean, 16);
  if (Number.isNaN(n)) return [234, 84, 19];
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

class DareuControlApp {
  constructor() {
    this.hidManager = new WebHidManager((dir, reportId, data) => this.logPacket(dir, reportId, data));
    this.driver = null;
    this.profile = null;
    this.isConnected = false;
    this.isDemoMode = false;
    this.currentModel = DAREU_MODELS.A950_AIR;

    this.state = {
      activeTab: 'sensor',
      activeProfileSlot: 1,
      fwVersion: 'v03.00',
      dongleFwVersion: '—',
      battery: { level: 100, charging: false },
      sensorMode: 0,
      lod: 1,
      debounceMs: 4,
      motionSync: true,
      angleSnapping: false,
      rippleControl: false,
      longDistance: false,
      sleepEnabled: true,
      sleepTimeoutSec: 300,
      pollingRate: 1000,
      lockDpiXY: true,
      activeDpiStage: 2,
      dpiStages: [
        { dpiX: 400, dpiY: 400, color: '#ea5413' },
        { dpiX: 800, dpiY: 800, color: '#3b82f6' },
        { dpiX: 1600, dpiY: 1600, color: '#22c55e' },
        { dpiX: 3200, dpiY: 3200, color: '#eab308' },
      ],
      dpiLed: { enabled: true, effect: 1, brightness: 255, speed: 2, sleepSec: 300 },
      selectedButtonId: 1,
      buttons: this._buildDefaultButtons(DAREU_MODELS.A950_AIR),
      activeMacroSlot: 1,
      macros: this._buildEmptyMacros(8),
      nvramBaseAddr: 0x0000,
      nvramBuffer: null,
      selectedHexOffset: null,
    };

    // Macro recording state
    this.isRecordingMacro = false;
    this.lastMacroEventTs = 0;
    this._macroKeyDownHandler = null;
    this._macroKeyUpHandler = null;
    this._macroMouseDownHandler = null;
    this._macroMouseUpHandler = null;

    // Button keyboard chord capture buffer
    this.pendingChord = { modifiersMask: 0, keyCodes: [] };
    this._chordCaptureActive = false;

    // Telemetry state
    this.telemetry = {
      lastEventTs: 0,
      intervals: [],
      rates: [],
      odometerPx: 0,
      lastX: null,
      lastY: null,
      clickTimes: [],
      peakCps: 0,
      downTimes: {},
      lastClickButton: null,
      lastCps: 0,
      lastHoldMs: null,
      lastMinHz: null,
      lastMaxHz: null,
    };

    this.cacheDom();
    this.bindEvents();
    this.initTelemetry();
    this.initApp();
  }

  _getButtonDisplayName(def) {
    if (!def) return '';
    if (BUTTON_NAME_KEYS[def.id]) return t(BUTTON_NAME_KEYS[def.id]);
    if (def.id === 6) {
      return def.name === 'DPI Switch' ? t('buttons.btnDpi') : t('buttons.btnSlot6');
    }
    return t('buttons.btnGeneric', { id: def.id });
  }

  _getButtonDefaultText(def) {
    if (!def) return '';
    if (def.note) return t('buttons.slot6Note');
    const action = BUTTON_DEFAULT_ACTION_KEYS[def.id]
      ? t(BUTTON_DEFAULT_ACTION_KEYS[def.id])
      : def.defaultAction || t('buttons.sumDpiCycle');
    return t('buttons.defaultFactory', { action });
  }

  _getMacroDisplayName(slot, rawName) {
    if (!rawName || rawName === `Macro ${slot}`) {
      return t('buttons.macroSlotName', { n: slot });
    }
    return rawName;
  }

  _buildDefaultButtons(model) {
    const out = {
      1: { btnId: 1, category: 'mouse', value: 1, loopMode: 1 },
      2: { btnId: 2, category: 'mouse', value: 2, loopMode: 1 },
      3: { btnId: 3, category: 'mouse', value: 3, loopMode: 1 },
      4: { btnId: 4, category: 'mouse', value: 4, loopMode: 1 },
      5: { btnId: 5, category: 'mouse', value: 5, loopMode: 1 },
      6: { btnId: 6, category: 'dpi', value: 'dpi_cycle', loopMode: 1 },
    };
    if (model?.buttonCount === 5) {
      out[6].note = 'Extra NVRAM Slot 6';
    }
    return out;
  }

  _buildEmptyMacros(slots = 8) {
    const out = {};
    for (let i = 1; i <= slots; i++) {
      out[i] = { name: `Macro ${i}`, events: [], actionCount: 0 };
    }
    return out;
  }

  cacheDom() {
    const q = id => document.getElementById(id);
    this.dom = {
      appSidebar: q('appSidebar'),
      sidebarBackdrop: q('sidebarBackdrop'),
      btnMobileMenu: q('btnMobileMenu'),
      navItems: Array.from(document.querySelectorAll('.nav-item')),
      tabPanels: Array.from(document.querySelectorAll('.tab-panel')),
      activeProfileBadge: q('activeProfileBadge'),
      fwVersionBadge: q('fwVersionBadge'),

      btnDemoMode: q('btnDemoMode'),
      selLanguage: q('selLanguage'),
      selDemoModel: q('selDemoModel'),
      batteryBadge: q('batteryBadge'),
      batteryPercent: q('batteryPercent'),
      batteryChargingIcon: q('batteryChargingIcon'),
      statusDot: q('statusDot'),
      statusText: q('statusText'),
      btnConnect: q('btnConnect'),

      // Sensor
      sensorSectionDesc: q('sensorSectionDesc'),
      sensorModeGroup: q('sensorModeGroup'),
      sensorModeHint: q('sensorModeHint'),
      lodGroup: q('lodGroup'),
      rngDebounce: q('rngDebounce'),
      lblDebounceVal: q('lblDebounceVal'),
      chkMotionSync: q('chkMotionSync'),
      chkAngleSnap: q('chkAngleSnap'),
      chkRipple: q('chkRipple'),
      rowLongDistance: q('rowLongDistance'),
      chkLongDistance: q('chkLongDistance'),
      chkSleepEnable: q('chkSleepEnable'),
      rngSleepTimeout: q('rngSleepTimeout'),
      lblSleepTimeoutVal: q('lblSleepTimeoutVal'),
      btnFactoryReset: q('btnFactoryReset'),

      // DPI & Polling
      dpiSectionDesc: q('dpiSectionDesc'),
      pollingGroup: q('pollingGroup'),
      chkLockDpiXY: q('chkLockDpiXY'),
      lblActiveStage: q('lblActiveStage'),
      btnAddDpiStage: q('btnAddDpiStage'),
      btnRemoveDpiStage: q('btnRemoveDpiStage'),
      dpiStagesList: q('dpiStagesList'),
      dpiLedPanel: q('dpiLedPanel'),
      btnToggleDpiLed: q('btnToggleDpiLed'),
      dpiLedBody: q('dpiLedBody'),
      chkDpiLedEnable: q('chkDpiLedEnable'),
      selDpiLedEffect: q('selDpiLedEffect'),
      rngDpiLedBrightness: q('rngDpiLedBrightness'),
      lblDpiLedBrightness: q('lblDpiLedBrightness'),
      rngDpiLedSpeed: q('rngDpiLedSpeed'),
      lblDpiLedSpeed: q('lblDpiLedSpeed'),
      rngDpiLedSleep: q('rngDpiLedSleep'),
      lblDpiLedSleep: q('lblDpiLedSleep'),
      btnApplyDpiLed: q('btnApplyDpiLed'),

      // Buttons
      schematicModelName: q('schematicModelName'),
      schematicSubtitle: q('schematicSubtitle'),
      schematicHardwareBadge: q('schematicHardwareBadge'),
      mouseRenderImg: q('mouseRenderImg'),
      schematicOverlay: q('schematicOverlay'),
      schematicPins: q('schematicPins'),
      extraSlotsWrapper: q('extraSlotsWrapper'),
      btnToggleExtraSlots: q('btnToggleExtraSlots'),
      extraSlotsContainer: q('extraSlotsContainer'),
      extraSlotsList: q('extraSlotsList'),

      selectedButtonName: q('selectedButtonName'),
      selectedButtonSlotBadge: q('selectedButtonSlotBadge'),
      selectedButtonDefault: q('selectedButtonDefault'),
      btnReloadButtonsFromDevice: q('btnReloadButtonsFromDevice'),
      btnResetButtonDefault: q('btnResetButtonDefault'),
      selActionCategory: q('selActionCategory'),

      panelActionMouse: q('panelActionMouse'),
      selMouseAction: q('selMouseAction'),
      panelActionTurbo: q('panelActionTurbo'),
      rngTurboInterval: q('rngTurboInterval'),
      lblTurboIntervalVal: q('lblTurboIntervalVal'),
      numTurboInterval: q('numTurboInterval'),
      panelActionWheel: q('panelActionWheel'),
      selWheelAction: q('selWheelAction'),
      panelActionKeyboard: q('panelActionKeyboard'),
      keyCaptureBox: q('keyCaptureBox'),
      keyCaptureDisplay: q('keyCaptureDisplay'),
      btnClearChord: q('btnClearChord'),
      chkModCtrl: q('chkModCtrl'),
      chkModShift: q('chkModShift'),
      chkModAlt: q('chkModAlt'),
      chkModWin: q('chkModWin'),
      panelActionMedia: q('panelActionMedia'),
      selMediaAction: q('selMediaAction'),
      panelActionPower: q('panelActionPower'),
      selPowerAction: q('selPowerAction'),
      panelActionDpi: q('panelActionDpi'),
      selDpiAction: q('selDpiAction'),
      panelActionSniper: q('panelActionSniper'),
      rngSniperDpi: q('rngSniperDpi'),
      lblSniperDpiVal: q('lblSniperDpiVal'),
      numSniperDpi: q('numSniperDpi'),
      panelActionHardware: q('panelActionHardware'),
      selHardwareAction: q('selHardwareAction'),
      panelActionMacro: q('panelActionMacro'),
      selMacroSlot: q('selMacroSlot'),
      selMacroLoop: q('selMacroLoop'),
      wrapMacroLoopCount: q('wrapMacroLoopCount'),
      numMacroLoopCount: q('numMacroLoopCount'),
      panelActionDisabled: q('panelActionDisabled'),
      btnApplyButton: q('btnApplyButton'),

      // Macro Studio
      macroSlotList: q('macroSlotList'),
      inpMacroName: q('inpMacroName'),
      lblMacroActionCount: q('lblMacroActionCount'),
      btnRecordMacro: q('btnRecordMacro'),
      btnClearMacro: q('btnClearMacro'),
      btnDeleteMacro: q('btnDeleteMacro'),
      btnSaveMacro: q('btnSaveMacro'),
      btnExportMacro: q('btnExportMacro'),
      btnImportMacro: q('btnImportMacro'),
      inpImportMacro: q('inpImportMacro'),
      btnInsertDelay: q('btnInsertDelay'),
      btnInsertKey: q('btnInsertKey'),
      btnInsertMouse: q('btnInsertMouse'),
      btnInsertWheel: q('btnInsertWheel'),
      macroTimeline: q('macroTimeline'),

      // Profiles & NVRAM
      profileSlotGroup: q('profileSlotGroup'),
      btnExportProfile: q('btnExportProfile'),
      btnImportProfile: q('btnImportProfile'),
      inpImportProfile: q('inpImportProfile'),
      btnBackupNvram: q('btnBackupNvram'),
      btnRestoreNvram: q('btnRestoreNvram'),
      inpRestoreNvram: q('inpRestoreNvram'),
      selNvramBank: q('selNvramBank'),
      inpNvramAddr: q('inpNvramAddr'),
      btnReadNvram: q('btnReadNvram'),
      hexGrid: q('hexGrid'),
      hexDecoderDetail: q('hexDecoderDetail'),

      // Diagnostics
      pollingTargetLabel: q('pollingTargetLabel'),
      pollingAvgHz: q('pollingAvgHz'),
      pollingJitterHz: q('pollingJitterHz'),
      pollingMinMax: q('pollingMinMax'),
      pollingCanvas: q('pollingCanvas'),
      cursorSpeedVal: q('cursorSpeedVal'),
      cursorDeltaVal: q('cursorDeltaVal'),
      cursorOdometerVal: q('cursorOdometerVal'),
      clickTestArea: q('clickTestArea'),
      clickEventLabel: q('clickEventLabel'),
      clickCpsVal: q('clickCpsVal'),
      clickHoldVal: q('clickHoldVal'),
      diagSensorSpec: q('diagSensorSpec'),
      diagDpiIpsSpec: q('diagDpiIpsSpec'),
      diagVidPid: q('diagVidPid'),
      diagFwVer: q('diagFwVer'),
      diagDongleFw: q('diagDongleFw'),
      diagInterface: q('diagInterface'),
      diagBattery: q('diagBattery'),
      btnClearLog: q('btnClearLog'),
      btnExportLog: q('btnExportLog'),
      packetLog: q('packetLog'),

      toastContainer: q('toastContainer'),
    };
  }

  async initApp() {
    await i18n.init();
    if (this.dom.selLanguage) {
      this.dom.selLanguage.value = i18n.preference;
    }
    i18n.onChange(() => this.onLocaleChanged());

    this.hidManager.onStatusChange = (connected, profile) => {
      if (connected) {
        this.onDeviceConnected(this.hidManager.driver, profile);
      } else {
        this.onDeviceDisconnected();
      }
    };

    // Start in clean Demo Mode view if no mouse auto-connects
    this.onLocaleChanged();

    if (this.hidManager.isSupported()) {
      this.hidManager.autoConnectExisting().catch(() => {});
    } else {
      this.dom.statusText.textContent = t('topbar.statusUnavailable');
      this.dom.btnConnect.disabled = true;
    }
  }

  onLocaleChanged() {
    if (this.dom.selLanguage) {
      this.dom.selLanguage.value = i18n.preference;
    }
    i18n.applyDom(document);
    this.renderLocaleDependentControls();
  }

  renderLocaleDependentControls() {
    this.dom.profileSlotGroup?.querySelectorAll('.seg-btn').forEach(btn => {
      btn.textContent = t('profiles.profileSlot', { n: btn.dataset.profile });
    });

    if (this.dom.selMacroSlot) {
      Array.from(this.dom.selMacroSlot.options).forEach(opt => {
        opt.textContent = t('buttons.macroSlotName', { n: opt.value });
      });
    }

    if (this.isConnected) {
      this.dom.btnConnect.textContent = t('topbar.disconnect');
      this.dom.statusText.textContent = this.profile?.isDongle
        ? t('topbar.statusDongle')
        : t('topbar.statusConnected');
      const pidHex = (this.profile?.pid ?? this.currentModel.pid)
        .toString(16)
        .toUpperCase()
        .padStart(4, '0');
      this.dom.schematicHardwareBadge.textContent = t('buttons.syncedBadge', { pid: pidHex });
      this.dom.fwVersionBadge.textContent = this.state.fwVersion;
      this.dom.diagBattery.textContent = this.state.battery.charging
        ? t('diagnostics.batteryCharging', { pct: this.state.battery.level })
        : `${this.state.battery.level}%`;
      if (this.driver?.getDongleFirmwareVersion && this.profile?.isDongle) {
        this.dom.diagDongleFw.textContent = t('diagnostics.dongleVer', {
          ver: this.state.dongleFwVersion,
        });
      }
    } else if (this.isDemoMode) {
      this.dom.btnConnect.textContent = t('topbar.connect');
      this.dom.statusText.textContent = t('topbar.statusDemo');
      this.dom.schematicHardwareBadge.textContent = t('topbar.statusDemo');
      this.dom.fwVersionBadge.textContent = t('sidebar.fwSim', { fw: 'v03.00' });
      this.dom.diagBattery.textContent = t('diagnostics.batterySim', { pct: 88 });
    } else {
      this.dom.btnConnect.textContent = t('topbar.connect');
      this.dom.statusText.textContent = this.hidManager.isSupported()
        ? t('topbar.statusNotConnected')
        : t('topbar.statusUnavailable');
      this.dom.schematicHardwareBadge.textContent = t('buttons.offlinePreview');
      this.dom.fwVersionBadge.textContent = '—';
    }

    this.dom.btnToggleDpiLed.textContent = this.dom.dpiLedBody.classList.contains('hidden')
      ? t('dpi.showControls')
      : t('dpi.hideControls');
    this.dom.btnRecordMacro.textContent = this.isRecordingMacro
      ? t('macros.stopRecording')
      : t('macros.startRecording');

    this.applyModelSpecs(this.currentModel.id);
    this.dom.sensorModeHint.textContent = t(SENSOR_MODE_HINT_KEYS[this.state.sensorMode] || 'sensor.hintMode0');
    this.dom.lblSleepTimeoutVal.textContent = this.formatDuration(this.state.sleepTimeoutSec);
    this.dom.activeProfileBadge.textContent = t('sidebar.profileValue', {
      slot: this.state.activeProfileSlot,
    });
    this.renderMacroSlots();
    this.renderMacroTimeline();
    if (this.state.selectedHexOffset !== null && this.state.nvramBuffer) {
      const idx = this.state.selectedHexOffset - this.state.nvramBaseAddr;
      if (idx >= 0 && idx < this.state.nvramBuffer.length) {
        const val = this.state.nvramBuffer[idx];
        this.dom.hexDecoderDetail.innerHTML = this.decodeRegisterByte(
          this.state.selectedHexOffset,
          val,
          this.state.nvramBuffer,
          this.state.nvramBaseAddr
        );
      } else {
        this.renderNvramMemory(this.state.nvramBaseAddr);
      }
    } else {
      this.renderNvramMemory(this.state.nvramBaseAddr);
      this.dom.hexDecoderDetail.textContent = t('profiles.decoderDefault');
    }
    this.refreshTelemetryLocale();
  }

  refreshTelemetryLocale() {
    if (this.telemetry.lastMinHz != null && this.telemetry.lastMaxHz != null) {
      this.dom.pollingMinMax.textContent = t('diagnostics.minMax', {
        min: this.telemetry.lastMinHz,
        max: this.telemetry.lastMaxHz,
      });
    } else {
      this.dom.pollingMinMax.textContent = t('diagnostics.minMaxEmpty');
    }

    if (this.telemetry.lastClickButton != null) {
      this.dom.clickEventLabel.textContent = t('diagnostics.clickPressed', {
        label: this._getClickButtonLabel(this.telemetry.lastClickButton),
      });
      this.dom.clickCpsVal.textContent = t('diagnostics.clickCps', {
        cps: this.telemetry.lastCps.toFixed(1),
        peak: this.telemetry.peakCps.toFixed(1),
      });
    } else {
      this.dom.clickEventLabel.textContent = t('diagnostics.clickPrompt');
      this.dom.clickCpsVal.textContent = t('diagnostics.clickCps', { cps: '0.0', peak: '0.0' });
    }

    if (this.telemetry.lastHoldMs != null) {
      this.dom.clickHoldVal.textContent = t('diagnostics.holdVal', {
        ms: this.telemetry.lastHoldMs,
      });
    } else {
      this.dom.clickHoldVal.textContent = t('diagnostics.holdEmpty');
    }
  }

  bindEvents() {
    // Mobile sidebar drawer
    const closeDrawer = () => {
      this.dom.appSidebar.classList.remove('open');
      this.dom.sidebarBackdrop.classList.remove('visible');
    };
    this.dom.btnMobileMenu?.addEventListener('click', () => {
      const opening = !this.dom.appSidebar.classList.contains('open');
      this.dom.appSidebar.classList.toggle('open', opening);
      this.dom.sidebarBackdrop.classList.toggle('visible', opening);
    });
    this.dom.sidebarBackdrop?.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeDrawer();
    });

    // Tab navigation
    this.dom.navItems.forEach(item => {
      item.addEventListener('click', () => {
        const tab = item.dataset.tab;
        this.switchTab(tab);
        closeDrawer();
      });
    });

    // Header connect / demo / model selection
    this.dom.btnConnect.addEventListener('click', async () => {
      if (this.isConnected) {
        await this.hidManager.disconnect();
        return;
      }
      try {
        await this.hidManager.requestAndConnect();
      } catch (err) {
        this.showToast(t('toast.connectionFailed', { msg: err.message }), true);
      }
    });

    this.dom.selLanguage?.addEventListener('change', async e => {
      await i18n.setPreference(e.target.value);
    });

    this.dom.btnDemoMode.addEventListener('click', () => this.toggleDemoMode());
    this.dom.selDemoModel.addEventListener('change', e => {
      if (!this.isDemoMode && !this.isConnected) {
        this.enableDemoMode(e.target.value);
      } else {
        this.applyModelSpecs(e.target.value);
      }
    });

    // Sensor tab controls
    this.dom.sensorModeGroup.addEventListener('click', async e => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      const mode = Number(btn.dataset.mode);
      this.state.sensorMode = mode;
      this.updateSegmentedActive(this.dom.sensorModeGroup, 'mode', String(mode));
      this.dom.sensorModeHint.textContent = t(SENSOR_MODE_HINT_KEYS[mode] || 'sensor.hintMode0');
      await this.syncDriver('setSensorMode', mode);
    });

    this.dom.lodGroup.addEventListener('click', async e => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      const lod = Number(btn.dataset.lod);
      this.state.lod = lod;
      this.updateSegmentedActive(this.dom.lodGroup, 'lod', String(lod));
      await this.syncDriver('setLiftOffDistance', lod === 2);
    });

    this.dom.rngDebounce.addEventListener('input', e => {
      const ms = Number(e.target.value);
      this.state.debounceMs = ms;
      this.dom.lblDebounceVal.textContent = `${ms} ms`;
    });
    this.dom.rngDebounce.addEventListener('change', async e => {
      await this.syncDriver('setDebounceTime', Number(e.target.value));
    });

    this.dom.chkMotionSync.addEventListener('change', async e => {
      this.state.motionSync = e.target.checked;
      await this.syncDriver('setMotionSync', this.state.motionSync);
    });

    this.dom.chkAngleSnap.addEventListener('change', async e => {
      this.state.angleSnapping = e.target.checked;
      await this.syncDriver('setAngleSnapping', this.state.angleSnapping);
    });

    this.dom.chkRipple.addEventListener('change', async e => {
      this.state.rippleControl = e.target.checked;
      await this.syncDriver('setRippleControl', this.state.rippleControl);
    });

    this.dom.chkLongDistance.addEventListener('change', async e => {
      this.state.longDistance = e.target.checked;
      await this.syncDriver('setLongDistanceMode', this.state.longDistance);
    });

    this.dom.chkSleepEnable.addEventListener('change', async e => {
      this.state.sleepEnabled = e.target.checked;
      await this.syncDriver('setSleepEnabled', this.state.sleepEnabled);
    });

    this.dom.rngSleepTimeout.addEventListener('input', e => {
      const sec = Number(e.target.value);
      this.state.sleepTimeoutSec = sec;
      this.dom.lblSleepTimeoutVal.textContent = this.formatDuration(sec);
    });
    this.dom.rngSleepTimeout.addEventListener('change', async e => {
      await this.syncDriver('setSleepTimeout', Number(e.target.value));
    });

    this.dom.btnFactoryReset.addEventListener('click', async () => {
      if (!window.confirm(t('sensor.factoryResetConfirm'))) return;
      if (this.driver?.setFactoryReset) {
        try {
          await this.driver.setFactoryReset();
          await this.syncAllFromDevice();
          this.showToast(t('toast.factoryRestored'));
        } catch (err) {
          this.showToast(t('toast.factoryResetFailed', { msg: err.message }), true);
        }
      } else {
        this.state.sensorMode = 0;
        this.state.lod = 1;
        this.state.debounceMs = 4;
        this.state.pollingRate = 1000;
        this.state.buttons = this._buildDefaultButtons(this.currentModel);
        this.applyStateToUi();
        this.showToast(t('toast.demoReset'));
      }
    });

    // DPI & Polling controls
    this.dom.pollingGroup.addEventListener('click', async e => {
      const btn = e.target.closest('.poll-btn');
      if (!btn || btn.disabled) return;
      const hz = Number(btn.dataset.hz);
      this.state.pollingRate = hz;
      this.updatePollingUi(hz);
      await this.syncDriver('setPollingRate', hz);
    });

    this.dom.chkLockDpiXY.addEventListener('change', e => {
      this.state.lockDpiXY = e.target.checked;
      if (this.state.lockDpiXY) {
        this.state.dpiStages.forEach(s => {
          s.dpiY = s.dpiX;
        });
      }
      this.renderDpiStages();
    });

    this.dom.btnAddDpiStage.addEventListener('click', async () => {
      if (this.state.dpiStages.length >= 8) {
        this.showToast(t('toast.maxDpiStages'));
        return;
      }
      const nextNum = this.state.dpiStages.length + 1;
      const lastDpi = this.state.dpiStages[this.state.dpiStages.length - 1]?.dpiX || 800;
      const maxDpi = this.currentModel?.maxDpi || 26000;
      const nextDpi = clamp(lastDpi + 400, 100, maxDpi);
      this.state.dpiStages.push({
        dpiX: nextDpi,
        dpiY: nextDpi,
        color: STAGE_COLOR_PALETTE[(nextNum - 1) % STAGE_COLOR_PALETTE.length],
      });
      this.renderDpiStages();
      await this.persistDpiStages();
    });

    this.dom.btnRemoveDpiStage.addEventListener('click', async () => {
      if (this.state.dpiStages.length <= 1) {
        this.showToast(t('toast.minDpiStages'));
        return;
      }
      this.state.dpiStages.pop();
      if (this.state.activeDpiStage > this.state.dpiStages.length) {
        this.state.activeDpiStage = this.state.dpiStages.length;
      }
      this.renderDpiStages();
      await this.persistDpiStages();
    });

    // Indicator LED drawer
    this.dom.btnToggleDpiLed.addEventListener('click', () => {
      const hidden = this.dom.dpiLedBody.classList.toggle('hidden');
      this.dom.btnToggleDpiLed.textContent = hidden ? t('dpi.showControls') : t('dpi.hideControls');
    });
    this.dom.rngDpiLedBrightness.addEventListener('input', e => {
      const pct = Math.round((Number(e.target.value) / 255) * 100);
      this.dom.lblDpiLedBrightness.textContent = `${pct}%`;
    });
    this.dom.rngDpiLedSpeed.addEventListener('input', e => {
      this.dom.lblDpiLedSpeed.textContent = e.target.value;
    });
    this.dom.rngDpiLedSleep.addEventListener('input', e => {
      this.dom.lblDpiLedSleep.textContent = `${e.target.value} s`;
    });
    this.dom.btnApplyDpiLed.addEventListener('click', async () => {
      this.state.dpiLed = {
        enabled: this.dom.chkDpiLedEnable.checked,
        effect: Number(this.dom.selDpiLedEffect.value),
        brightness: Number(this.dom.rngDpiLedBrightness.value),
        speed: Number(this.dom.rngDpiLedSpeed.value),
        sleepSec: Number(this.dom.rngDpiLedSleep.value),
      };
      await this.syncDriver('setDpiLedConfig', this.state.dpiLed);
      this.showToast(t('toast.dpiLedUpdated'));
    });

    // Button Remapping
    this.dom.btnToggleExtraSlots.addEventListener('click', () => {
      const expanded = this.dom.btnToggleExtraSlots.getAttribute('aria-expanded') === 'true';
      this.dom.btnToggleExtraSlots.setAttribute('aria-expanded', String(!expanded));
      this.dom.extraSlotsContainer.classList.toggle('hidden', expanded);
    });

    this.dom.btnReloadButtonsFromDevice.addEventListener('click', async () => {
      if (this.driver?.getButtonAssignments) {
        try {
          const count = Math.max(6, this.currentModel.buttonCount || 6);
          const mappings = await this.driver.getButtonAssignments(count);
          this.state.buttons = { ...this.state.buttons, ...mappings };
          this.renderSchematic();
          this.populateButtonEditor(this.state.buttons[this.state.selectedButtonId]);
          this.showToast(t('toast.buttonsReloaded'));
        } catch (err) {
          this.showToast(t('toast.buttonReadFailed', { msg: err.message }), true);
        }
      } else {
        this.renderSchematic();
        this.populateButtonEditor(this.state.buttons[this.state.selectedButtonId]);
        this.showToast(t('toast.buttonsRefreshed'));
      }
    });

    this.dom.btnResetButtonDefault.addEventListener('click', async () => {
      const id = this.state.selectedButtonId;
      const defaults = this._buildDefaultButtons(this.currentModel);
      const def = defaults[id] || { btnId: id, category: 'dpi', value: 'dpi_cycle', loopMode: 1 };
      this.state.buttons[id] = { ...def };
      this.populateButtonEditor(this.state.buttons[id]);
      this.renderSchematic();
      await this.syncDriver('setButtonAssignment', id, def.category, def.value, def.loopMode);
      this.showToast(t('toast.buttonReset', { id }));
    });

    this.dom.selActionCategory.addEventListener('change', () => this.showButtonCategorySubpanel());

    // Turbo & Sniper synced slider+number controls
    this.dom.rngTurboInterval.addEventListener('input', e => {
      this.dom.numTurboInterval.value = e.target.value;
      this.dom.lblTurboIntervalVal.textContent = `${e.target.value} ms`;
    });
    this.dom.numTurboInterval.addEventListener('input', e => {
      const v = clamp(Number(e.target.value) || 20, 5, 255);
      this.dom.rngTurboInterval.value = v;
      this.dom.lblTurboIntervalVal.textContent = `${v} ms`;
    });

    this.dom.rngSniperDpi.addEventListener('input', e => {
      this.dom.numSniperDpi.value = e.target.value;
      this.dom.lblSniperDpiVal.textContent = `${e.target.value} DPI`;
    });
    this.dom.numSniperDpi.addEventListener('input', e => {
      const maxDpi = this.currentModel?.maxDpi || 26000;
      const v = clamp(Number(e.target.value) || 400, 100, maxDpi);
      this.dom.rngSniperDpi.value = Math.min(6400, v);
      this.dom.lblSniperDpiVal.textContent = `${v} DPI`;
    });

    this.dom.selMacroLoop.addEventListener('change', e => {
      this.dom.wrapMacroLoopCount.classList.toggle('hidden', e.target.value !== 'count');
    });

    // Chord capture box
    this.dom.keyCaptureBox.addEventListener('focus', () => {
      this._chordCaptureActive = true;
    });
    this.dom.keyCaptureBox.addEventListener('blur', () => {
      this._chordCaptureActive = false;
    });
    this.dom.keyCaptureBox.addEventListener('keydown', e => {
      e.preventDefault();
      e.stopPropagation();
      const modMask = MacroCompiler.modifierBitFromEvent(e);
      const hidCode = MacroCompiler.domEventToHid(e);

      if (modMask) {
        this.pendingChord.modifiersMask |= modMask;
      }
      if (hidCode && !MacroCompiler.isModifierHid(hidCode)) {
        if (!this.pendingChord.keyCodes.includes(hidCode)) {
          if (this.pendingChord.keyCodes.length >= 2) this.pendingChord.keyCodes.shift();
          this.pendingChord.keyCodes.push(hidCode);
        }
      }
      this.syncChordDisplay();
    });

    [this.dom.chkModCtrl, this.dom.chkModShift, this.dom.chkModAlt, this.dom.chkModWin].forEach(chk => {
      chk.addEventListener('change', () => {
        const bit = Number(chk.value);
        if (chk.checked) this.pendingChord.modifiersMask |= bit;
        else this.pendingChord.modifiersMask &= ~bit;
        this.syncChordDisplay();
      });
    });

    this.dom.btnClearChord.addEventListener('click', () => {
      this.pendingChord = { modifiersMask: 0, keyCodes: [] };
      this.syncChordDisplay();
    });

    this.dom.btnApplyButton.addEventListener('click', () => this.applyButtonEditorToHardware());

    // Macro Studio
    this.dom.inpMacroName.addEventListener('input', e => {
      this.state.macros[this.state.activeMacroSlot].name = e.target.value || `Macro ${this.state.activeMacroSlot}`;
      this.renderMacroSlots();
    });

    this.dom.btnRecordMacro.addEventListener('click', () => {
      if (this.isRecordingMacro) this.stopMacroRecording();
      else this.startMacroRecording();
    });

    this.dom.btnClearMacro.addEventListener('click', () => {
      if (this.isRecordingMacro) this.stopMacroRecording();
      this.state.macros[this.state.activeMacroSlot].events = [];
      this.state.macros[this.state.activeMacroSlot].actionCount = 0;
      this.renderMacroTimeline();
      this.renderMacroSlots();
    });

    this.dom.btnDeleteMacro.addEventListener('click', async () => {
      const slot = this.state.activeMacroSlot;
      this.state.macros[slot] = { name: `Macro ${slot}`, events: [], actionCount: 0 };
      this.dom.inpMacroName.value = `Macro ${slot}`;
      this.renderMacroTimeline();
      this.renderMacroSlots();
      await this.syncDriver('deleteMacro', slot);
      this.showToast(t('toast.macroDeleted', { slot }));
    });

    this.dom.btnSaveMacro.addEventListener('click', async () => {
      if (this.isRecordingMacro) this.stopMacroRecording();
      const slot = this.state.activeMacroSlot;
      const m = this.state.macros[slot];
      const { actionCount, truncated } = MacroCompiler.compile(m.events);
      m.actionCount = actionCount;
      if (truncated) {
        this.showToast(t('toast.macroTruncated', { max: MacroCompiler.MAX_ACTIONS }), true);
      }
      await this.syncDriver('setMacro', slot, m.name, m.events);
      this.renderMacroSlots();
      const displayName = this._getMacroDisplayName(slot, m.name);
      this.showToast(t('toast.macroSaved', { name: displayName, count: actionCount, slot }));
    });

    this.dom.btnExportMacro.addEventListener('click', () => {
      const m = this.state.macros[this.state.activeMacroSlot];
      this.downloadJson(m, `dareu-macro-${this.state.activeMacroSlot}.json`);
    });

    this.dom.btnImportMacro.addEventListener('click', () => this.dom.inpImportMacro.click());
    this.dom.inpImportMacro.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        if (!Array.isArray(parsed.events)) throw new Error(t('errors.missingEventsArray'));
        const slot = this.state.activeMacroSlot;
        this.state.macros[slot] = {
          name: String(parsed.name || `Macro ${slot}`).slice(0, 30),
          events: parsed.events,
          actionCount: MacroCompiler.compile(parsed.events).actionCount,
        };
        this.dom.inpMacroName.value = this.state.macros[slot].name;
        this.renderMacroTimeline();
        this.renderMacroSlots();
        this.showToast(t('toast.macroImported', { slot }));
      } catch (err) {
        this.showToast(t('toast.importFailed', { msg: err.message }), true);
      }
    });

    this.dom.btnInsertDelay.addEventListener('click', () => this.appendMacroStep({ type: MACRO_EVENT_TYPE.DELAY, ms: 50 }));
    this.dom.btnInsertKey.addEventListener('click', () => {
      this.appendMacroStep({ type: MACRO_EVENT_TYPE.KEY_DOWN, keycode: 4, keyName: 'A' });
      this.appendMacroStep({ type: MACRO_EVENT_TYPE.DELAY, ms: 25 });
      this.appendMacroStep({ type: MACRO_EVENT_TYPE.KEY_UP, keycode: 4, keyName: 'A' });
    });
    this.dom.btnInsertMouse.addEventListener('click', () => {
      this.appendMacroStep({ type: MACRO_EVENT_TYPE.MOUSE_DOWN, button: 'LEFT', buttonName: 'Left Click' });
      this.appendMacroStep({ type: MACRO_EVENT_TYPE.DELAY, ms: 25 });
      this.appendMacroStep({ type: MACRO_EVENT_TYPE.MOUSE_UP, button: 'LEFT', buttonName: 'Left Click' });
    });
    this.dom.btnInsertWheel.addEventListener('click', () => {
      this.appendMacroStep({ type: MACRO_EVENT_TYPE.WHEEL_UP });
    });

    // Profiles & Memory Inspector
    this.dom.profileSlotGroup.addEventListener('click', async e => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      const slot = Number(btn.dataset.profile);
      this.state.activeProfileSlot = slot;
      this.updateSegmentedActive(this.dom.profileSlotGroup, 'profile', String(slot));
      this.dom.activeProfileBadge.textContent = t('sidebar.profileValue', { slot });
      if (this.driver?.setActiveProfile) {
        try {
          await this.driver.setActiveProfile(slot);
          await this.syncAllFromDevice();
          this.showToast(t('toast.profileSwitched', { slot }));
        } catch (err) {
          this.showToast(t('toast.profileSwitchFailed', { msg: err.message }), true);
        }
      } else {
        this.renderNvramMemory(this.state.nvramBaseAddr);
        this.showToast(t('toast.demoProfileActive', { slot }));
      }
    });

    this.dom.btnExportProfile.addEventListener('click', () => {
      this.downloadJson(
        {
          schema: 'dareu-ui-profile-v2',
          model: this.currentModel.id,
          sensor: {
            mode: this.state.sensorMode,
            lod: this.state.lod,
            debounceMs: this.state.debounceMs,
            motionSync: this.state.motionSync,
            angleSnapping: this.state.angleSnapping,
            rippleControl: this.state.rippleControl,
            longDistance: this.state.longDistance,
            sleepEnabled: this.state.sleepEnabled,
            sleepTimeoutSec: this.state.sleepTimeoutSec,
          },
          pollingRate: this.state.pollingRate,
          dpiStages: this.state.dpiStages,
          activeDpiStage: this.state.activeDpiStage,
          buttons: this.state.buttons,
          macros: this.state.macros,
        },
        `dareu-${this.currentModel.id.toLowerCase()}-profile${this.state.activeProfileSlot}.json`
      );
    });

    this.dom.btnImportProfile.addEventListener('click', () => this.dom.inpImportProfile.click());
    this.dom.inpImportProfile.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const cfg = JSON.parse(await file.text());
        if (cfg.model && DAREU_MODELS[cfg.model]) {
          this.applyModelSpecs(cfg.model);
        }
        if (cfg.sensor) {
          this.state.sensorMode = cfg.sensor.mode ?? this.state.sensorMode;
          this.state.lod = cfg.sensor.lod ?? this.state.lod;
          this.state.debounceMs = cfg.sensor.debounceMs ?? this.state.debounceMs;
          this.state.motionSync = cfg.sensor.motionSync ?? this.state.motionSync;
          this.state.angleSnapping = cfg.sensor.angleSnapping ?? this.state.angleSnapping;
          this.state.rippleControl = cfg.sensor.rippleControl ?? this.state.rippleControl;
          this.state.longDistance = cfg.sensor.longDistance ?? this.state.longDistance;
          this.state.sleepEnabled = cfg.sensor.sleepEnabled ?? this.state.sleepEnabled;
          this.state.sleepTimeoutSec = cfg.sensor.sleepTimeoutSec ?? this.state.sleepTimeoutSec;
        }
        if (cfg.pollingRate) this.state.pollingRate = cfg.pollingRate;
        if (Array.isArray(cfg.dpiStages) && cfg.dpiStages.length > 0) {
          this.state.dpiStages = cfg.dpiStages;
          this.state.activeDpiStage = clamp(cfg.activeDpiStage || 1, 1, cfg.dpiStages.length);
        }
        if (cfg.buttons) this.state.buttons = { ...this.state.buttons, ...cfg.buttons };
        if (cfg.macros) this.state.macros = { ...this.state.macros, ...cfg.macros };
        this.applyStateToUi();
        if (this.driver) await this.pushStateToHardware();
        this.showToast(t('toast.profileImported'));
      } catch (err) {
        this.showToast(t('toast.profileImportError', { msg: err.message }), true);
      }
    });

    this.dom.btnBackupNvram.addEventListener('click', async () => {
      try {
        let snapshot;
        if (this.driver?.dumpFullProfileSnapshot) {
          snapshot = await this.driver.dumpFullProfileSnapshot();
        } else {
          snapshot = {
            schema: 'dareu-nvram-v1',
            pid: this.currentModel.pid,
            model: this.currentModel.displayName,
            activeProfile: this.state.activeProfileSlot,
            nvram_0_191: Array.from(this.buildDemoNvramBank(0, 192)),
            nvram_256_479: Array.from(this.buildDemoNvramBank(256, 224)),
            macros: this.state.macros,
          };
        }
        this.downloadJson(snapshot, `dareu-nvram-backup-p${snapshot.activeProfile}.json`);
        this.showToast(t('toast.nvramExported'));
      } catch (err) {
        this.showToast(t('toast.backupFailed', { msg: err.message }), true);
      }
    });

    this.dom.btnRestoreNvram.addEventListener('click', () => this.dom.inpRestoreNvram.click());
    this.dom.inpRestoreNvram.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const snap = JSON.parse(await file.text());
        if (this.driver?.restoreProfileSnapshot) {
          await this.driver.restoreProfileSnapshot(snap);
          await this.syncAllFromDevice();
          this.showToast(t('toast.nvramRestored'));
        } else {
          this.showToast(t('toast.nvramVerified'));
        }
      } catch (err) {
        this.showToast(t('toast.restoreFailed', { msg: err.message }), true);
      }
    });

    this.dom.selNvramBank.addEventListener('change', e => {
      this.dom.inpNvramAddr.value = e.target.value;
      const addr = parseInt(e.target.value, 16) || 0;
      this.renderNvramMemory(addr);
    });

    this.dom.btnReadNvram.addEventListener('click', () => {
      const rawInput = this.dom.inpNvramAddr.value.trim();
      const addr = rawInput.startsWith('0x') ? parseInt(rawInput, 16) : parseInt(rawInput, 10);
      this.renderNvramMemory(Number.isNaN(addr) ? 0 : Math.max(0, addr));
    });

    // Diagnostics console
    this.dom.btnClearLog.addEventListener('click', () => {
      this.dom.packetLog.innerHTML = '';
    });
    this.dom.btnExportLog.addEventListener('click', () => {
      const lines = Array.from(this.dom.packetLog.querySelectorAll('.log-entry')).map(el => el.textContent).join('\n');
      const blob = new Blob([lines], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dareu-hid-trace.log`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  switchTab(tabId) {
    this.state.activeTab = tabId;
    this.dom.navItems.forEach(item => item.classList.toggle('active', item.dataset.tab === tabId));
    this.dom.tabPanels.forEach(panel => panel.classList.toggle('active', panel.id === `tab-${tabId}`));
    if (tabId === 'diagnostics') {
      this.drawPollingGraph();
    }
  }

  toggleDemoMode() {
    if (this.isConnected) {
      this.showToast(t('toast.disconnectBeforeDemo'));
      return;
    }
    if (this.isDemoMode) {
      this.isDemoMode = false;
      this.dom.btnDemoMode.classList.remove('active');
      this.dom.statusDot.className = 'status-dot';
      this.dom.statusText.textContent = t('topbar.statusNotConnected');
      this.dom.batteryBadge.classList.add('hidden');
      this.dom.schematicHardwareBadge.textContent = t('buttons.offlinePreview');
      this.showToast(t('toast.demoDisabled'));
    } else {
      this.enableDemoMode(this.dom.selDemoModel.value);
    }
  }

  enableDemoMode(modelId) {
    this.isDemoMode = true;
    this.dom.btnDemoMode.classList.add('active');
    this.dom.selDemoModel.disabled = false;
    this.dom.statusDot.className = 'status-dot demo';
    this.dom.statusText.textContent = t('topbar.statusDemo');
    this.dom.schematicHardwareBadge.textContent = t('topbar.statusDemo');
    this.dom.fwVersionBadge.textContent = t('sidebar.fwSim', { fw: 'v03.00' });
    this.dom.diagBattery.textContent = t('diagnostics.batterySim', { pct: 88 });
    this.dom.batteryBadge.classList.remove('hidden');
    this.dom.batteryPercent.textContent = '88%';
    this.dom.batteryChargingIcon.classList.add('hidden');
    this.applyModelSpecs(modelId || 'A950_AIR');
    this.showToast(t('toast.demoActive', { model: this.currentModel.displayName }));
  }

  applyModelSpecs(modelId) {
    const model = DAREU_MODELS[modelId] || DAREU_MODELS.A950_AIR;
    this.currentModel = model;
    if (this.dom.selDemoModel.value !== model.id) {
      this.dom.selDemoModel.value = model.id;
    }

    this.dom.sensorSectionDesc.textContent = t('sensor.descModel', { sensor: model.sensor });
    this.dom.dpiSectionDesc.textContent = t('dpi.descModel', {
      maxDpi: i18n.formatNumber(model.maxDpi),
      maxPolling: i18n.formatNumber(model.maxPolling),
    });

    // Enable/disable Long Distance toggle if TG protocol
    this.dom.rowLongDistance.classList.toggle('hidden', model.fwType !== 2);

    // Clamp polling rate & DPI stages to model caps
    if (this.state.pollingRate > model.maxPolling) {
      this.state.pollingRate = model.maxPolling;
    }
    this.updatePollingUi(this.state.pollingRate);

    this.state.dpiStages.forEach(s => {
      if (s.dpiX > model.maxDpi) s.dpiX = model.maxDpi;
      if (s.dpiY > model.maxDpi) s.dpiY = model.maxDpi;
    });
    this.dom.rngSniperDpi.max = Math.min(6400, model.maxDpi);
    this.dom.numSniperDpi.max = model.maxDpi;

    // Validate selected button still exists in shell or extra slots
    const hasPhysical = model.buttons.some(b => b.id === this.state.selectedButtonId);
    const hasExtra = (model.extraNvramSlots || []).includes(this.state.selectedButtonId);
    if (!hasPhysical && !hasExtra) {
      this.state.selectedButtonId = 1;
    }

    // Update diagnostics metadata
    this.dom.diagSensorSpec.textContent = model.sensor;
    this.dom.diagDpiIpsSpec.textContent = `${i18n.formatNumber(model.maxDpi)} DPI | ${model.ips}`;
    this.dom.diagVidPid.textContent = `VID: 0x260D | PID: 0x${model.pid.toString(16).toUpperCase().padStart(4, '0')}`;
    this.dom.diagFwVer.textContent = this.isConnected
      ? this.state.fwVersion
      : t('diagnostics.fwSimulated', { fw: this.state.fwVersion });
    this.dom.diagInterface.textContent =
      model.fwType === 2 ? t('diagnostics.ifaceTg') : t('diagnostics.ifaceJm');

    this.renderSchematic();
    this.renderDpiStages();
    this.populateButtonEditor(this.state.buttons[this.state.selectedButtonId]);
    this.drawPollingGraph();
  }

  async onDeviceConnected(driver, profile) {
    this.driver = driver;
    this.profile = profile;
    this.isConnected = true;
    this.isDemoMode = false;

    this.dom.btnDemoMode.classList.remove('active');
    this.dom.selDemoModel.disabled = true;
    this.dom.btnConnect.textContent = t('topbar.disconnect');
    this.dom.statusDot.className = 'status-dot connected';
    this.dom.statusText.textContent = profile.isDongle
      ? t('topbar.statusDongle')
      : t('topbar.statusConnected');
    this.dom.batteryBadge.classList.remove('hidden');

    const matched = getModelByPid(profile.pid);
    this.applyModelSpecs(matched.id);
    this.dom.schematicHardwareBadge.textContent = t('buttons.syncedBadge', {
      pid: profile.pid.toString(16).toUpperCase().padStart(4, '0'),
    });

    await this.syncAllFromDevice();
    this.showToast(t('toast.connected', { name: profile.name || matched.displayName }));
  }

  onDeviceDisconnected() {
    this.driver = null;
    this.profile = null;
    this.isConnected = false;
    this.dom.selDemoModel.disabled = false;
    this.dom.btnConnect.textContent = t('topbar.connect');
    this.dom.statusDot.className = 'status-dot';
    this.dom.statusText.textContent = t('topbar.statusNotConnected');
    this.dom.batteryBadge.classList.add('hidden');
    this.dom.schematicHardwareBadge.textContent = t('buttons.offlinePreview');
    this.dom.fwVersionBadge.textContent = '—';
  }

  async syncAllFromDevice() {
    if (!this.driver) return;

    try {
      const fw = await this.driver.getFirmwareVersion();
      this.state.fwVersion = fw;
      this.dom.fwVersionBadge.textContent = fw;
      this.dom.diagFwVer.textContent = fw;
    } catch (_) {}

    if (this.driver.getDongleFirmwareVersion && this.profile?.isDongle) {
      try {
        const dfw = await this.driver.getDongleFirmwareVersion();
        this.state.dongleFwVersion = dfw;
        this.dom.diagDongleFw.textContent = t('diagnostics.dongleVer', { ver: dfw });
      } catch (_) {}
    } else if (this.driver.deviceInfo) {
      const { cid, mid, jmType } = this.driver.deviceInfo;
      this.dom.diagDongleFw.textContent = `CID: 0x${(cid ?? 0).toString(16)} | MID: 0x${(mid ?? 0).toString(16)} | Type ${jmType ?? 2}`;
    }

    try {
      const bat = await this.driver.getBatteryStatus();
      this.state.battery = bat;
      this.dom.batteryPercent.textContent = `${bat.level}%`;
      this.dom.batteryChargingIcon.classList.toggle('hidden', !bat.charging);
      this.dom.diagBattery.textContent = bat.charging
        ? t('diagnostics.batteryCharging', { pct: bat.level })
        : `${bat.level}%`;
    } catch (_) {}

    if (this.driver.getActiveProfile) {
      try {
        this.state.activeProfileSlot = await this.driver.getActiveProfile();
      } catch (_) {}
    }

    if (this.driver.getLongDistanceMode && this.currentModel.fwType === 2) {
      try {
        const ld = await this.driver.getLongDistanceMode();
        this.state.longDistance = Boolean(ld.enabled);
      } catch (_) {}
    }

    if (this.driver.getSensorSettings) {
      try {
        const s = await this.driver.getSensorSettings();
        this.state.lod = s.lod ?? 1;
        this.state.debounceMs = s.debounceMs ?? 4;
        this.state.motionSync = Boolean(s.motionSync);
        this.state.angleSnapping = Boolean(s.angleSnapping);
        this.state.rippleControl = Boolean(s.rippleControl);
        this.state.sleepEnabled = Boolean(s.sleepEnabled);
        this.state.sleepTimeoutSec = s.sleepTimeoutSec ?? 300;
        this.state.sensorMode = s.sensorMode ?? 0;
      } catch (_) {}
    }

    if (this.driver.getPollingRate) {
      try {
        this.state.pollingRate = await this.driver.getPollingRate();
      } catch (_) {}
    }

    if (this.driver.getDpiStages) {
      try {
        const d = await this.driver.getDpiStages();
        if (Array.isArray(d.stages) && d.stages.length > 0) {
          this.state.dpiStages = d.stages;
          this.state.activeDpiStage = d.activeStage || 1;
          this.state.lockDpiXY = d.stages.every(st => st.dpiX === st.dpiY);
        }
      } catch (_) {}
    }

    if (this.driver.getDpiLedConfig) {
      try {
        this.state.dpiLed = await this.driver.getDpiLedConfig();
      } catch (_) {}
    }

    if (this.driver.getButtonAssignments) {
      try {
        const totalSlots = Math.max(6, this.currentModel.buttonCount || 6);
        const maps = await this.driver.getButtonAssignments(totalSlots);
        this.state.buttons = { ...this.state.buttons, ...maps };
      } catch (_) {}
    }

    if (this.driver.getAllMacros) {
      try {
        this.state.macros = await this.driver.getAllMacros(8);
      } catch (_) {}
    }

    this.applyStateToUi();
    await this.renderNvramMemory(this.state.nvramBaseAddr);
  }

  async pushStateToHardware() {
    await this.syncDriver('setSensorMode', this.state.sensorMode);
    await this.syncDriver('setLiftOffDistance', this.state.lod === 2);
    await this.syncDriver('setDebounceTime', this.state.debounceMs);
    await this.syncDriver('setMotionSync', this.state.motionSync);
    await this.syncDriver('setAngleSnapping', this.state.angleSnapping);
    await this.syncDriver('setRippleControl', this.state.rippleControl);
    await this.syncDriver('setPollingRate', this.state.pollingRate);
    await this.syncDriver('setDpiStages', this.state.dpiStages, this.state.activeDpiStage);
    for (const [idStr, b] of Object.entries(this.state.buttons)) {
      await this.syncDriver('setButtonAssignment', Number(idStr), b.category, b.value, b.loopMode);
    }
  }

  applyStateToUi() {
    this.updateSegmentedActive(this.dom.sensorModeGroup, 'mode', String(this.state.sensorMode));
    this.dom.sensorModeHint.textContent = t(SENSOR_MODE_HINT_KEYS[this.state.sensorMode] || 'sensor.hintMode0');
    this.updateSegmentedActive(this.dom.lodGroup, 'lod', String(this.state.lod));
    this.dom.rngDebounce.value = this.state.debounceMs;
    this.dom.lblDebounceVal.textContent = `${this.state.debounceMs} ms`;
    this.dom.chkMotionSync.checked = this.state.motionSync;
    this.dom.chkAngleSnap.checked = this.state.angleSnapping;
    this.dom.chkRipple.checked = this.state.rippleControl;
    this.dom.chkLongDistance.checked = this.state.longDistance;
    this.dom.chkSleepEnable.checked = this.state.sleepEnabled;
    this.dom.rngSleepTimeout.value = this.state.sleepTimeoutSec;
    this.dom.lblSleepTimeoutVal.textContent = this.formatDuration(this.state.sleepTimeoutSec);

    this.updateSegmentedActive(this.dom.profileSlotGroup, 'profile', String(this.state.activeProfileSlot));
    this.dom.activeProfileBadge.textContent = t('sidebar.profileValue', {
      slot: this.state.activeProfileSlot,
    });
    this.updatePollingUi(this.state.pollingRate);

    this.dom.chkLockDpiXY.checked = this.state.lockDpiXY;
    this.renderDpiStages();

    this.dom.chkDpiLedEnable.checked = this.state.dpiLed.enabled;
    this.dom.selDpiLedEffect.value = String(this.state.dpiLed.effect ?? 1);
    this.dom.rngDpiLedBrightness.value = this.state.dpiLed.brightness ?? 255;
    this.dom.lblDpiLedBrightness.textContent = `${Math.round(((this.state.dpiLed.brightness ?? 255) / 255) * 100)}%`;
    this.dom.rngDpiLedSpeed.value = this.state.dpiLed.speed ?? 2;
    this.dom.lblDpiLedSpeed.textContent = String(this.state.dpiLed.speed ?? 2);
    this.dom.rngDpiLedSleep.value = this.state.dpiLed.sleepSec ?? 300;
    this.dom.lblDpiLedSleep.textContent = `${this.state.dpiLed.sleepSec ?? 300} s`;

    this.renderSchematic();
    this.populateButtonEditor(this.state.buttons[this.state.selectedButtonId]);
    this.renderMacroSlots();
    this.renderMacroTimeline();
  }

  async syncDriver(methodName, ...args) {
    if (!this.driver || typeof this.driver[methodName] !== 'function') return;
    try {
      await this.driver[methodName](...args);
      if (this.state.activeTab === 'profiles') {
        await this.renderNvramMemory(this.state.nvramBaseAddr);
      }
    } catch (err) {
      this.showToast(t('toast.hardwareWriteFailed', { method: methodName, msg: err.message }), true);
    }
  }

  updateSegmentedActive(container, dataKey, valueStr) {
    container.querySelectorAll('.seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset[dataKey] === valueStr);
    });
  }

  updatePollingUi(activeHz) {
    const maxHz = this.currentModel?.maxPolling || 1000;
    this.dom.pollingTargetLabel.textContent = t('diagnostics.target', { hz: activeHz });
    this.dom.pollingGroup.querySelectorAll('.poll-btn').forEach(btn => {
      const hz = Number(btn.dataset.hz);
      const unsupported = hz > maxHz;
      btn.disabled = unsupported;
      btn.title = unsupported
        ? t('dpi.pollingUnsupported', { model: this.currentModel.displayName, max: maxHz })
        : '';
      btn.classList.toggle('active', hz === activeHz && !unsupported);
    });
  }

  async persistDpiStages() {
    await this.syncDriver('setDpiStages', this.state.dpiStages, this.state.activeDpiStage);
  }

  renderDpiStages() {
    const maxDpi = this.currentModel?.maxDpi || 26000;
    const minDpi = this.currentModel?.dpiMin || 50;
    const step = this.currentModel?.dpiStep || 50;
    this.dom.lblActiveStage.textContent = t('dpi.activeStage', { n: this.state.activeDpiStage });
    this.dom.dpiStagesList.innerHTML = '';

    this.state.dpiStages.forEach((stage, idx) => {
      const stageNum = idx + 1;
      const isActive = stageNum === this.state.activeDpiStage;
      const stageColor = stage.color || STAGE_COLOR_PALETTE[idx % STAGE_COLOR_PALETTE.length];

      const row = document.createElement('div');
      row.className = `dpi-stage-row${isActive ? ' active' : ''}`;

      const selBtn = document.createElement('button');
      selBtn.type = 'button';
      selBtn.className = 'dpi-stage-select';
      const selSpan = document.createElement('span');
      selSpan.className = 'mono-num';
      selSpan.textContent = t('dpi.stageLabel', { n: stageNum });
      selBtn.appendChild(selSpan);
      selBtn.addEventListener('click', async () => {
        this.state.activeDpiStage = stageNum;
        this.renderDpiStages();
        await this.syncDriver('setActiveDpiStage', stageNum);
      });

      const axesWrap = document.createElement('div');
      axesWrap.className = 'dpi-axes-stack';

      const makeAxisRow = (axisLabel, prop) => {
        const line = document.createElement('div');
        line.className = 'dpi-axis-row';

        const tag = document.createElement('span');
        tag.className = 'axis-tag';
        tag.textContent = axisLabel;

        const range = document.createElement('input');
        range.type = 'range';
        range.className = 'range-input';
        range.min = String(minDpi);
        range.max = String(maxDpi);
        range.step = String(step);
        range.value = String(stage[prop]);

        const num = document.createElement('input');
        num.type = 'number';
        num.className = 'num-input mono-num';
        num.min = String(minDpi);
        num.max = String(maxDpi);
        num.step = String(step);
        num.value = String(stage[prop]);

        const syncVal = raw => {
          const snapped = Math.round(clamp(Number(raw) || minDpi, minDpi, maxDpi) / step) * step;
          stage[prop] = snapped;
          if (this.state.lockDpiXY) {
            stage.dpiX = snapped;
            stage.dpiY = snapped;
          }
          range.value = String(snapped);
          num.value = String(snapped);
        };

        range.addEventListener('input', e => syncVal(e.target.value));
        range.addEventListener('change', () => this.persistDpiStages());
        num.addEventListener('change', e => {
          syncVal(e.target.value);
          this.persistDpiStages();
        });

        line.append(tag, range, num);
        return line;
      };

      axesWrap.appendChild(makeAxisRow(this.state.lockDpiXY ? 'XY' : 'X', 'dpiX'));
      if (!this.state.lockDpiXY) {
        axesWrap.appendChild(makeAxisRow('Y', 'dpiY'));
      }

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'color-swatch-input';
      colorInput.value = stageColor;
      colorInput.title = t('dpi.stageColorTitle', { n: stageNum });
      colorInput.addEventListener('change', async e => {
        stage.color = e.target.value;
        await this.persistDpiStages();
      });

      row.append(selBtn, axesWrap, colorInput);
      this.dom.dpiStagesList.appendChild(row);
    });
  }

  // === Schematic & Button Action Editor ===

  formatButtonSummary(mapping) {
    if (!mapping) return t('buttons.sumUnassigned');
    const { category, value, loopMode } = mapping;
    if (category === 'disabled') return t('buttons.sumDisabled');
    if (category === 'mouse') {
      const keys = {
        1: 'buttons.mouse1',
        2: 'buttons.mouse2',
        3: 'buttons.mouse3',
        4: 'buttons.sumBack',
        5: 'buttons.sumForward',
      };
      return keys[value] ? t(keys[value]) : t('buttons.sumMouseOther', { n: value });
    }
    if (category === 'double_click') return t('buttons.sumDoubleClick');
    if (category === 'turbo') return t('buttons.sumTurbo', { ms: value });
    if (category === 'wheel') return t(value === 'scroll_down' ? 'buttons.sumScrollDown' : 'buttons.sumScrollUp');
    if (category === 'hwheel') return t(value === 'scroll_left' ? 'buttons.sumTiltLeft' : 'buttons.sumTiltRight');
    if (category === 'dpi') {
      if (value === 'dpi_up') return t('buttons.sumDpiUp');
      if (value === 'dpi_down') return t('buttons.sumDpiDown');
      return t('buttons.sumDpiCycle');
    }
    if (category === 'sniper') return t('buttons.sumSniper', { dpi: value });
    if (category === 'profile_cycle') return t('buttons.sumProfileCycle');
    if (category === 'polling_switch') return t('buttons.sumPollingSwitch');
    if (category === 'lighting_switch') return t('buttons.sumLightingSwitch');
    if (category === 'media') {
      const k = `media.${value}`;
      const translated = t(k);
      return translated !== k ? translated : MEDIA_KEYS[value]?.label || t('buttons.sumMedia');
    }
    if (category === 'power') {
      const k = `power.${value}`;
      const translated = t(k);
      return translated !== k ? translated : POWER_KEYS[value]?.label || t('buttons.sumPower');
    }
    if (category === 'keyboard') {
      if (typeof value === 'number') return MacroCompiler.getKeyName(value);
      return value?.label || MacroCompiler.formatChordSummary(value?.modifiersMask, value?.keyCodes);
    }
    if (category === 'macro') {
      const rawName = this.state.macros[value]?.name;
      const name = this._getMacroDisplayName(value, rawName);
      if (loopMode === 'toggle') return t('buttons.sumToggleSuffix', { name });
      if (loopMode === 'hold') return t('buttons.sumHoldSuffix', { name });
      return name;
    }
    return t('buttons.sumCustom');
  }

  renderSchematic() {
    const model = this.currentModel;
    this.dom.mouseRenderImg.src = model.image;
    this.dom.schematicModelName.textContent = model.modelName.toUpperCase();
    this.dom.schematicSubtitle.textContent = t('buttons.schematicSub', {
      count: model.buttonCount,
      sensor: model.sensor,
    });

    this.dom.schematicPins.innerHTML = '';
    this.dom.schematicOverlay.innerHTML = '';

    model.buttons.forEach(btn => {
      const isSelected = btn.id === this.state.selectedButtonId;
      const mapping = this.state.buttons[btn.id];

      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = `pin-hotspot${isSelected ? ' active' : ''}`;
      pin.style.left = `${btn.pinX}%`;
      pin.style.top = `${btn.pinY}%`;
      pin.dataset.btnId = String(btn.id);
      pin.title = `${this._getButtonDisplayName(btn)}: ${this.formatButtonSummary(mapping)}`;
      pin.textContent = String(btn.id);

      const badge = document.createElement('span');
      badge.className = `pin-callout-badge callout-${btn.calloutSide || 'right'}${isSelected ? ' active' : ''}`;
      badge.textContent = this.formatButtonSummary(mapping);
      pin.appendChild(badge);

      pin.addEventListener('click', () => this.selectButtonSlot(btn.id));
      this.dom.schematicPins.appendChild(pin);
    });

    // Extra NVRAM slots drawer (Slot 6 on A950 AIR, etc.)
    const hidden = model.hiddenButtons || [];
    this.dom.extraSlotsWrapper.classList.toggle('hidden', hidden.length === 0);
    this.dom.extraSlotsList.innerHTML = '';
    hidden.forEach(slot => {
      const mapping = this.state.buttons[slot.id];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `extra-slot-btn${this.state.selectedButtonId === slot.id ? ' active' : ''}`;
      const numSpan = document.createElement('span');
      numSpan.className = 'mono-num';
      numSpan.textContent = t('buttons.slotLabel', { id: slot.id });
      const nameSpan = document.createElement('span');
      nameSpan.textContent = this._getButtonDisplayName(slot);
      const tagSpan = document.createElement('span');
      tagSpan.className = 'mono-tag';
      tagSpan.textContent = this.formatButtonSummary(mapping);
      b.append(numSpan, nameSpan, tagSpan);
      b.addEventListener('click', () => this.selectButtonSlot(slot.id));
      this.dom.extraSlotsList.appendChild(b);
    });
  }

  selectButtonSlot(btnId) {
    this.state.selectedButtonId = btnId;
    this.renderSchematic();
    this.populateButtonEditor(this.state.buttons[btnId]);
  }

  populateButtonEditor(mapping) {
    const btnId = this.state.selectedButtonId;
    const def =
      this.currentModel.buttons.find(b => b.id === btnId) ||
      (this.currentModel.hiddenButtons || []).find(b => b.id === btnId) || {
        id: btnId,
        name: `Button Slot ${btnId}`,
        defaultAction: 'DPI Cycle',
      };

    this.dom.selectedButtonName.textContent = this._getButtonDisplayName(def);
    this.dom.selectedButtonSlotBadge.textContent = t('buttons.slotBadge', {
      id: btnId,
      addr: 96 + 4 * (btnId - 1),
    });
    this.dom.selectedButtonDefault.textContent = this._getButtonDefaultText(def);

    const cat = mapping?.category || 'mouse';
    const val = mapping?.value;

    // Map internal driver categories into dropdown categories
    if (cat === 'hwheel') {
      this.dom.selActionCategory.value = 'wheel';
      this.dom.selWheelAction.value = val || 'scroll_left';
    } else if (cat === 'profile_cycle' || cat === 'polling_switch' || cat === 'lighting_switch') {
      this.dom.selActionCategory.value = 'hardware_switch';
      this.dom.selHardwareAction.value = cat;
    } else {
      this.dom.selActionCategory.value = cat;
    }

    if (cat === 'mouse') this.dom.selMouseAction.value = String(val || 1);
    if (cat === 'turbo') {
      const ms = clamp(Number(val) || 20, 5, 255);
      this.dom.rngTurboInterval.value = ms;
      this.dom.numTurboInterval.value = ms;
      this.dom.lblTurboIntervalVal.textContent = `${ms} ms`;
    }
    if (cat === 'wheel') this.dom.selWheelAction.value = val || 'scroll_up';
    if (cat === 'dpi') this.dom.selDpiAction.value = val || 'dpi_cycle';
    if (cat === 'media') this.dom.selMediaAction.value = MEDIA_KEYS[val] ? val : 'play_pause';
    if (cat === 'power') this.dom.selPowerAction.value = POWER_KEYS[val] ? val : 'power';
    if (cat === 'sniper') {
      const dpi = clamp(Number(val) || 400, 100, this.currentModel?.maxDpi || 26000);
      this.dom.rngSniperDpi.value = Math.min(6400, dpi);
      this.dom.numSniperDpi.value = dpi;
      this.dom.lblSniperDpiVal.textContent = `${dpi} DPI`;
    }
    if (cat === 'keyboard') {
      if (typeof val === 'number') {
        this.pendingChord = { modifiersMask: 0, keyCodes: [val] };
      } else {
        this.pendingChord = {
          modifiersMask: val?.modifiersMask || 0,
          keyCodes: Array.isArray(val?.keyCodes) ? [...val.keyCodes] : [],
        };
      }
      this.syncChordDisplay();
    } else {
      this.pendingChord = { modifiersMask: 0, keyCodes: [] };
      this.syncChordDisplay();
    }
    if (cat === 'macro') {
      this.dom.selMacroSlot.value = String(val || 1);
      const lm = mapping.loopMode;
      if (lm === 'hold' || lm === 'toggle' || lm === 'until_next') {
        this.dom.selMacroLoop.value = lm;
        this.dom.wrapMacroLoopCount.classList.add('hidden');
      } else {
        this.dom.selMacroLoop.value = 'count';
        this.dom.numMacroLoopCount.value = String(Number(lm) || 1);
        this.dom.wrapMacroLoopCount.classList.remove('hidden');
      }
    }

    this.showButtonCategorySubpanel();
  }

  syncChordDisplay() {
    const m = this.pendingChord.modifiersMask;
    this.dom.chkModCtrl.checked = Boolean(m & (1 | 16));
    this.dom.chkModShift.checked = Boolean(m & (2 | 32));
    this.dom.chkModAlt.checked = Boolean(m & (4 | 64));
    this.dom.chkModWin.checked = Boolean(m & (8 | 128));

    if (m === 0 && this.pendingChord.keyCodes.length === 0) {
      this.dom.keyCaptureDisplay.textContent = t('buttons.capturePlaceholder');
    } else {
      this.dom.keyCaptureDisplay.textContent = MacroCompiler.formatChordSummary(m, this.pendingChord.keyCodes);
    }
  }

  showButtonCategorySubpanel() {
    const cat = this.dom.selActionCategory.value;
    const panels = {
      mouse: this.dom.panelActionMouse,
      turbo: this.dom.panelActionTurbo,
      wheel: this.dom.panelActionWheel,
      keyboard: this.dom.panelActionKeyboard,
      media: this.dom.panelActionMedia,
      power: this.dom.panelActionPower,
      dpi: this.dom.panelActionDpi,
      sniper: this.dom.panelActionSniper,
      hardware_switch: this.dom.panelActionHardware,
      macro: this.dom.panelActionMacro,
      disabled: this.dom.panelActionDisabled,
    };
    Object.values(panels).forEach(p => p.classList.add('hidden'));
    if (cat === 'double_click') return; // no extra options needed
    if (panels[cat]) panels[cat].classList.remove('hidden');
    if (cat === 'macro') {
      this.dom.wrapMacroLoopCount.classList.toggle('hidden', this.dom.selMacroLoop.value !== 'count');
    }
  }

  async applyButtonEditorToHardware() {
    const btnId = this.state.selectedButtonId;
    const uiCat = this.dom.selActionCategory.value;
    let category = uiCat;
    let value = 1;
    let loopMode = 1;

    if (uiCat === 'mouse') {
      value = Number(this.dom.selMouseAction.value);
    } else if (uiCat === 'double_click') {
      value = 1;
    } else if (uiCat === 'turbo') {
      value = clamp(Number(this.dom.numTurboInterval.value) || 20, 5, 255);
    } else if (uiCat === 'wheel') {
      value = this.dom.selWheelAction.value;
      category = value === 'scroll_left' || value === 'scroll_right' ? 'hwheel' : 'wheel';
    } else if (uiCat === 'keyboard') {
      if (this.pendingChord.modifiersMask === 0 && this.pendingChord.keyCodes.length === 0) {
        this.showToast(t('toast.chordRequired'), true);
        return;
      }
      value = {
        modifiersMask: this.pendingChord.modifiersMask,
        keyCodes: [...this.pendingChord.keyCodes],
        label: MacroCompiler.formatChordSummary(this.pendingChord.modifiersMask, this.pendingChord.keyCodes),
      };
    } else if (uiCat === 'media') {
      value = this.dom.selMediaAction.value;
    } else if (uiCat === 'power') {
      value = this.dom.selPowerAction.value;
    } else if (uiCat === 'dpi') {
      value = this.dom.selDpiAction.value;
    } else if (uiCat === 'sniper') {
      value = clamp(Number(this.dom.numSniperDpi.value) || 400, 100, this.currentModel?.maxDpi || 26000);
    } else if (uiCat === 'hardware_switch') {
      category = this.dom.selHardwareAction.value;
      value = 1;
    } else if (uiCat === 'macro') {
      value = Number(this.dom.selMacroSlot.value);
      const lm = this.dom.selMacroLoop.value;
      loopMode = lm === 'count' ? clamp(Number(this.dom.numMacroLoopCount.value) || 1, 1, 250) : lm;
    } else {
      category = 'disabled';
      value = 0;
    }

    this.state.buttons[btnId] = { btnId, category, value, loopMode };
    this.renderSchematic();
    await this.syncDriver('setButtonAssignment', btnId, category, value, loopMode);
    this.showToast(
      t('toast.buttonApplied', {
        summary: this.formatButtonSummary(this.state.buttons[btnId]),
        id: btnId,
      })
    );
  }

  // === Macro Studio ===

  renderMacroSlots() {
    this.dom.macroSlotList.innerHTML = '';
    for (let slot = 1; slot <= 8; slot++) {
      const m = this.state.macros[slot];
      const count = MacroCompiler.compile(m.events).actionCount;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `macro-slot-item${slot === this.state.activeMacroSlot ? ' active' : ''}`;
      const nameSpan = document.createElement('span');
      nameSpan.textContent = this._getMacroDisplayName(slot, m.name);
      const countSpan = document.createElement('span');
      countSpan.className = 'mono-tag';
      countSpan.textContent = String(count);
      btn.append(nameSpan, countSpan);
      btn.addEventListener('click', () => {
        if (this.isRecordingMacro) this.stopMacroRecording();
        this.state.activeMacroSlot = slot;
        this.dom.inpMacroName.value = m.name || `Macro ${slot}`;
        this.renderMacroSlots();
        this.renderMacroTimeline();
      });
      this.dom.macroSlotList.appendChild(btn);
    }
  }

  appendMacroStep(step) {
    const m = this.state.macros[this.state.activeMacroSlot];
    const currentActions = MacroCompiler.compile(m.events).actionCount;
    if (step.type !== MACRO_EVENT_TYPE.DELAY && currentActions >= MacroCompiler.MAX_ACTIONS) {
      this.showToast(t('toast.maxMacroActions', { max: MacroCompiler.MAX_ACTIONS }), true);
      return;
    }
    m.events.push(step);
    this.renderMacroTimeline();
    this.renderMacroSlots();
  }

  startMacroRecording() {
    this.isRecordingMacro = true;
    this.lastMacroEventTs = performance.now();
    this.dom.btnRecordMacro.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg><span></span>`;
    this.dom.btnRecordMacro.querySelector('span').textContent = t('macros.stopRecording');

    const pushGap = () => {
      const now = performance.now();
      const delta = Math.round(now - this.lastMacroEventTs);
      this.lastMacroEventTs = now;
      if (delta >= 5) {
        this.state.macros[this.state.activeMacroSlot].events.push({
          type: MACRO_EVENT_TYPE.DELAY,
          ms: Math.min(65535, delta),
        });
      }
    };

    // Single global window listener (never duplicated on document!)
    this._macroKeyDownHandler = e => {
      if (e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      const code = MacroCompiler.domEventToHid(e);
      if (!code) return;
      pushGap();
      this.appendMacroStep({
        type: MACRO_EVENT_TYPE.KEY_DOWN,
        keycode: code,
        keyName: MacroCompiler.getKeyName(code),
      });
    };

    this._macroKeyUpHandler = e => {
      e.preventDefault();
      e.stopPropagation();
      const code = MacroCompiler.domEventToHid(e);
      if (!code) return;
      pushGap();
      this.appendMacroStep({
        type: MACRO_EVENT_TYPE.KEY_UP,
        keycode: code,
        keyName: MacroCompiler.getKeyName(code),
      });
    };

    this._macroMouseDownHandler = e => {
      if (this.dom.btnRecordMacro.contains(e.target)) return;
      const btnKey = ['LEFT', 'MIDDLE', 'RIGHT', 'BACKWARD', 'FORWARD'][e.button] || 'LEFT';
      pushGap();
      this.appendMacroStep({
        type: MACRO_EVENT_TYPE.MOUSE_DOWN,
        button: btnKey,
        buttonName: MOUSE_BUTTONS[btnKey].name,
      });
    };

    this._macroMouseUpHandler = e => {
      if (this.dom.btnRecordMacro.contains(e.target)) return;
      const btnKey = ['LEFT', 'MIDDLE', 'RIGHT', 'BACKWARD', 'FORWARD'][e.button] || 'LEFT';
      pushGap();
      this.appendMacroStep({
        type: MACRO_EVENT_TYPE.MOUSE_UP,
        button: btnKey,
        buttonName: MOUSE_BUTTONS[btnKey].name,
      });
    };

    window.addEventListener('keydown', this._macroKeyDownHandler, true);
    window.addEventListener('keyup', this._macroKeyUpHandler, true);
    window.addEventListener('mousedown', this._macroMouseDownHandler, true);
    window.addEventListener('mouseup', this._macroMouseUpHandler, true);
  }

  stopMacroRecording() {
    if (!this.isRecordingMacro) return;
    this.isRecordingMacro = false;
    this.dom.btnRecordMacro.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg><span></span>`;
    this.dom.btnRecordMacro.querySelector('span').textContent = t('macros.startRecording');
    window.removeEventListener('keydown', this._macroKeyDownHandler, true);
    window.removeEventListener('keyup', this._macroKeyUpHandler, true);
    window.removeEventListener('mousedown', this._macroMouseDownHandler, true);
    window.removeEventListener('mouseup', this._macroMouseUpHandler, true);
  }

  _getMacroMouseLabel(btnKey) {
    const map = {
      LEFT: 'buttons.mouse1',
      RIGHT: 'buttons.mouse2',
      MIDDLE: 'buttons.mouse3',
      BACKWARD: 'buttons.sumBack',
      FORWARD: 'buttons.sumForward',
    };
    return map[btnKey] ? t(map[btnKey]) : MOUSE_BUTTONS[btnKey]?.name || btnKey;
  }

  renderMacroTimeline() {
    const m = this.state.macros[this.state.activeMacroSlot];
    const { actionCount } = MacroCompiler.compile(m.events);
    this.dom.lblMacroActionCount.textContent = t('macros.actionCount', {
      count: actionCount,
      max: MacroCompiler.MAX_ACTIONS,
    });
    this.dom.macroTimeline.innerHTML = '';

    if (m.events.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = t('macros.emptyState');
      this.dom.macroTimeline.appendChild(empty);
      return;
    }

    const labelMap = {
      [MACRO_EVENT_TYPE.KEY_DOWN]: t('macros.badgeKeyDown'),
      [MACRO_EVENT_TYPE.KEY_UP]: t('macros.badgeKeyUp'),
      [MACRO_EVENT_TYPE.MOUSE_DOWN]: t('macros.badgeMouseDown'),
      [MACRO_EVENT_TYPE.MOUSE_UP]: t('macros.badgeMouseUp'),
      [MACRO_EVENT_TYPE.WHEEL_UP]: t('macros.badgeWheelUp'),
      [MACRO_EVENT_TYPE.WHEEL_DOWN]: t('macros.badgeWheelDown'),
      [MACRO_EVENT_TYPE.DELAY]: t('macros.badgeDelay'),
    };

    m.events.forEach((ev, idx) => {
      const row = document.createElement('div');
      row.className = 'macro-event-row';

      const meta = document.createElement('div');
      meta.className = 'macro-event-meta';

      const badge = document.createElement('span');
      const isDown = ev.type === MACRO_EVENT_TYPE.KEY_DOWN || ev.type === MACRO_EVENT_TYPE.MOUSE_DOWN || ev.type === MACRO_EVENT_TYPE.WHEEL_UP;
      const isDelay = ev.type === MACRO_EVENT_TYPE.DELAY;
      badge.className = `macro-badge ${isDelay ? 'delay' : isDown ? 'down' : 'up'}`;

      badge.textContent = labelMap[ev.type] || ev.type;
      meta.appendChild(badge);

      if (isDelay) {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.className = 'num-input mono-num';
        inp.min = '1';
        inp.max = '65535';
        inp.value = String(ev.ms || 10);
        inp.addEventListener('change', e => {
          ev.ms = clamp(Number(e.target.value) || 10, 1, 65535);
          e.target.value = String(ev.ms);
        });
        const unit = document.createElement('span');
        unit.className = 'muted-readout';
        unit.textContent = 'ms';
        meta.append(inp, unit);
      } else if (ev.type === MACRO_EVENT_TYPE.KEY_DOWN || ev.type === MACRO_EVENT_TYPE.KEY_UP) {
        const lbl = document.createElement('span');
        lbl.className = 'mono-num';
        lbl.textContent = ev.keyName || MacroCompiler.getKeyName(ev.keycode);
        meta.appendChild(lbl);
      } else if (ev.type === MACRO_EVENT_TYPE.MOUSE_DOWN || ev.type === MACRO_EVENT_TYPE.MOUSE_UP) {
        const sel = document.createElement('select');
        sel.className = 'select-input select-sm';
        Object.keys(MOUSE_BUTTONS).forEach(k => {
          const opt = document.createElement('option');
          opt.value = k;
          opt.textContent = this._getMacroMouseLabel(k);
          if (k === ev.button) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', e => {
          ev.button = e.target.value;
          ev.buttonName = MOUSE_BUTTONS[ev.button]?.name || ev.button;
        });
        meta.appendChild(sel);
      } else if (ev.type === MACRO_EVENT_TYPE.WHEEL_UP || ev.type === MACRO_EVENT_TYPE.WHEEL_DOWN) {
        const sel = document.createElement('select');
        sel.className = 'select-input select-sm';
        const optUp = document.createElement('option');
        optUp.value = MACRO_EVENT_TYPE.WHEEL_UP;
        optUp.textContent = t('macros.wheelUp');
        const optDown = document.createElement('option');
        optDown.value = MACRO_EVENT_TYPE.WHEEL_DOWN;
        optDown.textContent = t('macros.wheelDown');
        sel.append(optUp, optDown);
        sel.value = ev.type;
        sel.addEventListener('change', e => {
          ev.type = e.target.value;
          badge.textContent = labelMap[ev.type];
          badge.className = `macro-badge ${ev.type === MACRO_EVENT_TYPE.WHEEL_UP ? 'down' : 'up'}`;
        });
        meta.appendChild(sel);
      }

      const actions = document.createElement('div');
      actions.className = 'header-action-group';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-ghost btn-xs';
      delBtn.textContent = t('macros.removeStep');
      delBtn.addEventListener('click', () => {
        m.events.splice(idx, 1);
        this.renderMacroTimeline();
        this.renderMacroSlots();
      });
      actions.appendChild(delBtn);

      row.append(meta, actions);
      this.dom.macroTimeline.appendChild(row);
    });
  }

  // === NVRAM Hex Inspector & Hardware-Accurate Simulation ===

  buildDemoNvramBank(startAddr = 0, len = 64) {
    // Construct realistic 192-byte JM profile bank matching A950 hardware layout
    const core = new Uint8Array(192).fill(0);
    core[0] = JM_POLLING_TO_CODE[this.state.pollingRate] ?? 1;
    core[1] = jmChecksum([core[0], 0]);
    core[2] = this.state.dpiStages.length;
    core[3] = jmChecksum([core[2], 0]);
    core[4] = this.state.activeDpiStage - 1;
    core[5] = jmChecksum([core[4], 0]);
    core[10] = this.state.lod;
    core[11] = jmChecksum([core[10], 0]);

    for (let i = 0; i < Math.min(8, this.state.dpiStages.length); i++) {
      const s = this.state.dpiStages[i];
      const idxX = Math.max(0, Math.round(s.dpiX / 50) - 1);
      const idxY = Math.max(0, Math.round(s.dpiY / 50) - 1);
      const hi = (((idxY >> 8) & 0x03) << 6) | (((idxX >> 8) & 0x03) << 2);
      const d = [idxX & 0xff, idxY & 0xff, hi, 0];
      d[3] = jmChecksum(d);
      core.set(d, 12 + i * 4);

      const [r, g, b] = hexToRgb(s.color || STAGE_COLOR_PALETTE[i]);
      const c = [r, g, b, 0];
      c[3] = jmChecksum(c);
      core.set(c, 44 + i * 4);
    }

    core[76] = this.state.dpiLed.effect;
    core[77] = jmChecksum([core[76], 0]);
    core[78] = this.state.dpiLed.brightness;
    core[79] = jmChecksum([core[78], 0]);
    core[80] = this.state.dpiLed.speed;
    core[81] = jmChecksum([core[80], 0]);
    core[82] = this.state.dpiLed.enabled ? 1 : 0;
    core[83] = jmChecksum([core[82], 0]);

    const encodeBtn4 = b => {
      const a = [0, 0, 0, 0];
      if (!b || b.category === 'disabled') return [0, 0, 0, 85];
      if (b.category === 'mouse') { a[0] = 1; a[1] = 1 << ((b.value || 1) - 1); }
      else if (b.category === 'dpi') { a[0] = 2; a[1] = b.value === 'dpi_up' ? 2 : b.value === 'dpi_down' ? 3 : 1; }
      else if (b.category === 'hwheel') { a[0] = 3; a[1] = b.value === 'scroll_left' ? 1 : 2; }
      else if (b.category === 'double_click') { a[0] = 4; a[1] = 10; a[2] = 2; }
      else if (b.category === 'turbo') { a[0] = 4; a[1] = b.value || 20; }
      else if (b.category === 'keyboard' || b.category === 'media' || b.category === 'power') { a[0] = 5; }
      else if (b.category === 'macro') {
        a[0] = 6;
        a[1] = (b.value || 1) - 1;
        a[2] = b.loopMode === 'toggle' ? 255 : b.loopMode === 'hold' ? 254 : b.loopMode === 'until_next' ? 253 : Number(b.loopMode) || 1;
      } else if (b.category === 'polling_switch') a[0] = 7;
      else if (b.category === 'lighting_switch') { a[0] = 8; a[1] = 4; }
      else if (b.category === 'profile_cycle') a[0] = 9;
      else if (b.category === 'sniper') { a[0] = 10; a[1] = Math.round(((b.value || 400) - 100) / 50) + 1; }
      else if (b.category === 'wheel') { a[0] = 11; a[1] = b.value === 'scroll_down' ? 2 : 1; }
      a[3] = jmChecksum(a);
      return a;
    };

    for (let btnId = 1; btnId <= 6; btnId++) {
      core.set(encodeBtn4(this.state.buttons[btnId]), 96 + (btnId - 1) * 4);
    }

    const tailWrites = [
      [169, this.state.debounceMs],
      [171, this.state.motionSync ? 1 : 0],
      [173, Math.round((this.state.dpiLed.sleepSec || 300) / 10)],
      [175, this.state.angleSnapping ? 1 : 0],
      [177, this.state.rippleControl ? 1 : 0],
      [181, this.state.sleepEnabled ? 1 : 0],
      [183, Math.round((this.state.sleepTimeoutSec || 300) / 10)],
      [185, this.state.sensorMode],
    ];
    tailWrites.forEach(([addr, val]) => {
      core[addr] = val & 0xff;
      core[addr + 1] = jmChecksum([core[addr], 0]);
    });

    const out = new Uint8Array(len).fill(0xff);
    for (let i = 0; i < len; i++) {
      const a = startAddr + i;
      const bankOffset = a % 0x1b00;
      if (bankOffset < 192) {
        out[i] = core[bankOffset];
      } else if (a >= 256 && a < 480) {
        const slot = Math.floor((a - 256) / 32) + 1;
        const inner = (a - 256) % 32;
        const b = this.state.buttons[slot];
        if (b?.category === 'keyboard') {
          const buf = MacroCompiler.encodeKeyChordBuffer(b.value?.modifiersMask || 0, b.value?.keyCodes || [b.value]);
          if (buf && inner < buf.length) out[i] = buf[inner];
        } else if (b?.category === 'media') {
          const buf = MacroCompiler.encodeMediaBuffer(b.value);
          if (inner < buf.length) out[i] = buf[inner];
        } else if (b?.category === 'power') {
          const buf = MacroCompiler.encodePowerBuffer(b.value);
          if (inner < buf.length) out[i] = buf[inner];
        }
      } else if (a >= 768 && a < 768 + 8 * 384) {
        const mSlot = Math.floor((a - 768) / 384) + 1;
        const mOff = (a - 768) % 384;
        const macro = this.state.macros[mSlot];
        if (macro) {
          const { bytecode, actionCount } = MacroCompiler.compile(macro.events);
          const ascii = String(macro.name || `Macro ${mSlot}`).slice(0, 30);
          if (mOff === 0) out[i] = ascii.length;
          else if (mOff >= 1 && mOff <= ascii.length) out[i] = ascii.charCodeAt(mOff - 1);
          else if (mOff === 31) out[i] = actionCount;
          else if (actionCount === 0 && mOff === 32) out[i] = 0x55;
          else if (mOff >= 32 && mOff < 32 + bytecode.length) out[i] = bytecode[mOff - 32];
          else if (actionCount > 0 && mOff === 32 + bytecode.length) {
            const e = new Uint8Array(2 + bytecode.length);
            e[0] = actionCount;
            e.set(bytecode, 1);
            out[i] = jmChecksum(e);
          }
        }
      }
    }
    return out;
  }

  async renderNvramMemory(baseAddr = 0) {
    this.state.nvramBaseAddr = baseAddr;
    let buf;
    if (this.driver?.getRawMemory) {
      try {
        buf = await this.driver.getRawMemory(baseAddr, 64);
      } catch (err) {
        this.showToast(
          t('toast.nvramReadFailed', { addr: baseAddr.toString(16), msg: err.message }),
          true
        );
        return;
      }
    } else {
      buf = this.buildDemoNvramBank(baseAddr, 64);
    }
    this.state.nvramBuffer = buf;
    this.dom.hexGrid.innerHTML = '';

    for (let row = 0; row < 4; row++) {
      const rowAddr = baseAddr + row * 16;
      const line = document.createElement('div');
      line.className = 'hex-row';

      const off = document.createElement('span');
      off.className = 'hex-offset';
      off.textContent = `0x${rowAddr.toString(16).toUpperCase().padStart(4, '0')}`;
      line.appendChild(off);

      for (let col = 0; col < 16; col++) {
        const idx = row * 16 + col;
        const absAddr = baseAddr + idx;
        const val = buf[idx];
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = `hex-cell ${val === 0 || val === 255 ? 'empty' : 'nonzero'}${
          this.state.selectedHexOffset === absAddr ? ' active' : ''
        }`;
        cell.textContent = val.toString(16).toUpperCase().padStart(2, '0');
        cell.addEventListener('click', () => {
          this.state.selectedHexOffset = absAddr;
          this.dom.hexGrid.querySelectorAll('.hex-cell').forEach(c => c.classList.remove('active'));
          cell.classList.add('active');
          this.dom.hexDecoderDetail.innerHTML = this.decodeRegisterByte(absAddr, val, buf, baseAddr);
        });
        line.appendChild(cell);
      }
      this.dom.hexGrid.appendChild(line);
    }

    const firstVal = buf[0];
    this.dom.hexDecoderDetail.innerHTML = this.decodeRegisterByte(baseAddr, firstVal, buf, baseAddr);
  }

  decodeRegisterByte(addr, val, buffer, baseAddr) {
    const esc = s =>
      String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const addrHex = `0x${addr.toString(16).toUpperCase().padStart(4, '0')}`;
    const valHex = `0x${val.toString(16).toUpperCase().padStart(2, '0')}`;
    const bankAddr = addr % 0x1b00;
    const prefix = t('nvram.addrPrefix', { addrHex, addr, valHex, val });
    const tag = `<span class="mono-num">${esc(prefix)}</span> — `;

    if (addr < 192 || bankAddr < 192) {
      if (bankAddr === 0) {
        const hzMap = { 8: '125 Hz', 4: '250 Hz', 2: '500 Hz', 1: '1000 Hz', 16: '2000 Hz', 32: '4000 Hz', 64: '8000 Hz' };
        return `${tag}${t('nvram.pollingRate', { val: `<strong>${esc(hzMap[val] || t('nvram.unknown'))}</strong>` })}`;
      }
      if (bankAddr === 2) {
        return `${tag}${t('nvram.dpiStageCount', { val: `<strong>${val}</strong>` })}`;
      }
      if (bankAddr === 4) {
        return `${tag}${t('nvram.dpiStageIndex', { val: `<strong>${esc(t('dpi.stageLabel', { n: val + 1 }))}</strong>` })}`;
      }
      if (bankAddr === 10) {
        return `${tag}${t('nvram.lod', { val: `<strong>${val === 2 ? '2.0 mm' : '1.0 mm'}</strong>` })}`;
      }
      if (bankAddr >= 12 && bankAddr <= 43) {
        const stage = Math.floor((bankAddr - 12) / 4) + 1;
        const field = t(`nvram.dpiField${(bankAddr - 12) % 4}`);
        return `${tag}${t('nvram.dpiStageField', { stage, field: esc(field) })}`;
      }
      if (bankAddr >= 44 && bankAddr <= 75) {
        const stage = Math.floor((bankAddr - 44) / 4) + 1;
        const channel = t(`nvram.ledCh${(bankAddr - 44) % 4}`);
        return `${tag}${t('nvram.dpiStageColor', { stage, channel: esc(channel) })}`;
      }
      if (bankAddr === 76 || bankAddr === 78 || bankAddr === 80 || bankAddr === 82) {
        const ledKeys = {
          76: 'nvram.ledEffect',
          78: 'nvram.ledBrightness',
          80: 'nvram.ledSpeed',
          82: 'nvram.ledEnable',
        };
        return `${tag}${esc(t(ledKeys[bankAddr]))}`;
      }
      if (bankAddr >= 96 && bankAddr <= 127) {
        const slot = Math.floor((bankAddr - 96) / 4) + 1;
        const sub = (bankAddr - 96) % 4;
        if (sub === 0) {
          const catText = val >= 0 && val <= 11 ? t(`nvram.btnCat${val}`) : String(val);
          return `${tag}${t('nvram.btnSlotCat', { slot, val: `<strong>${esc(catText)}</strong>` })}`;
        }
        return `${tag}${t('nvram.btnSlotSub', { slot, sub: esc(t(`nvram.btnSub${sub}`)) })}`;
      }
      const tailKeys = {
        169: 'nvram.tail169',
        171: 'nvram.tail171',
        173: 'nvram.tail173',
        175: 'nvram.tail175',
        177: 'nvram.tail177',
        181: 'nvram.tail181',
        185: 'nvram.tail185',
      };
      if (bankAddr === 183) {
        return `${tag}${esc(t('nvram.tail183', { sec: val * 10 }))}`;
      }
      if (tailKeys[bankAddr]) return `${tag}${esc(t(tailKeys[bankAddr]))}`;
    }

    if (addr >= 256 && addr < 512) {
      const slot = Math.floor((addr - 256) / 32) + 1;
      return `${tag}${esc(t('nvram.chordBuffer', { slot, byte: (addr - 256) % 32 }))}`;
    }

    if (addr >= 768 && addr < 768 + 8 * 384) {
      const slot = Math.floor((addr - 768) / 384) + 1;
      const off = (addr - 768) % 384;
      if (off === 0) return `${tag}${esc(t('nvram.macroNameLen', { slot, val }))}`;
      if (off >= 1 && off <= 30) {
        const ch = val >= 32 && val <= 126 ? `'${String.fromCharCode(val)}'` : t('nvram.macroPadding');
        return `${tag}${esc(t('nvram.macroNameByte', { slot, char: ch }))}`;
      }
      if (off === 31) {
        const countLabel = val === 255 ? t('nvram.macroEmpty') : String(val);
        return `${tag}${t('nvram.macroActionCount', { slot, val: `<strong>${esc(countLabel)}</strong>` })}`;
      }
      return `${tag}${esc(t('nvram.macroInstrByte', { slot, off }))}`;
    }

    return `${tag}${esc(t('nvram.bankPadding'))}`;
  }

  // === Live Diagnostics ===

  _getClickButtonLabel(button) {
    if (button >= 0 && button <= 4) {
      return t(`diagnostics.clickBtn${button}`);
    }
    return t('diagnostics.clickBtnOther', { n: button });
  }

  initTelemetry() {
    window.addEventListener(
      'pointermove',
      e => {
        if (this.state.activeTab !== 'diagnostics') return;
        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
        for (const ev of events) {
          this.processTelemetrySample(ev);
        }
      },
      { passive: true }
    );

    const area = this.dom.clickTestArea;
    area.addEventListener('contextmenu', e => e.preventDefault());
    area.addEventListener('auxclick', e => e.preventDefault());
    area.addEventListener('mousedown', e => {
      e.preventDefault();
      const now = performance.now();
      this.telemetry.downTimes[e.button] = now;
      this.telemetry.clickTimes.push(now);
      this.telemetry.clickTimes = this.telemetry.clickTimes.filter(ts => now - ts <= 1000);
      const cps = this.telemetry.clickTimes.length;
      if (cps > this.telemetry.peakCps) this.telemetry.peakCps = cps;

      this.telemetry.lastClickButton = e.button;
      this.telemetry.lastCps = cps;
      this.refreshTelemetryLocale();
    });

    area.addEventListener('mouseup', e => {
      e.preventDefault();
      const now = performance.now();
      const down = this.telemetry.downTimes[e.button];
      if (down) {
        const dur = Math.max(1, Math.round(now - down));
        this.telemetry.lastHoldMs = dur;
        this.refreshTelemetryLocale();
        delete this.telemetry.downTimes[e.button];
      }
    });
  }

  processTelemetrySample(ev) {
    const now = ev.timeStamp || performance.now();
    if (this.telemetry.lastEventTs > 0) {
      const dt = now - this.telemetry.lastEventTs;
      if (dt > 0.05 && dt < 100) {
        const hz = Math.min(this.currentModel?.maxPolling || 8000, Math.round(1000 / dt));
        this.telemetry.rates.push(hz);
        if (this.telemetry.rates.length > 90) this.telemetry.rates.shift();

        if (this.telemetry.lastX !== null) {
          const dx = Math.round(ev.clientX - this.telemetry.lastX);
          const dy = Math.round(ev.clientY - this.telemetry.lastY);
          const dist = Math.hypot(dx, dy);
          this.telemetry.odometerPx += dist;
          const speed = Math.round((dist / dt) * 1000);
          this.dom.cursorSpeedVal.textContent = `${speed} px/s`;
          this.dom.cursorDeltaVal.textContent = `${dx >= 0 ? `+${dx}` : dx} / ${dy >= 0 ? `+${dy}` : dy}`;
          this.dom.cursorOdometerVal.textContent = `${(this.telemetry.odometerPx / 3780).toFixed(2)} m (${Math.round(this.telemetry.odometerPx)} px)`;
        }
      }
    }
    this.telemetry.lastEventTs = now;
    this.telemetry.lastX = ev.clientX;
    this.telemetry.lastY = ev.clientY;
    this.drawPollingGraph();
  }

  drawPollingGraph() {
    const canvas = this.dom.pollingCanvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(300, Math.round(rect.width || canvas.width));
    const h = Math.max(120, Math.round(rect.height || canvas.height));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    // Subtle calibration grid lines (25% / 50% / 75%)
    ctx.strokeStyle = 'rgba(237, 237, 237, 0.08)';
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach(frac => {
      const y = Math.round(h * frac) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    });

    const rates = this.telemetry.rates;
    if (rates.length === 0) return;

    const avg = Math.round(rates.reduce((a, b) => a + b, 0) / rates.length);
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    const jitter = Math.round(Math.sqrt(rates.reduce((s, r) => s + (r - avg) ** 2, 0) / rates.length));
    this.telemetry.lastMinHz = min;
    this.telemetry.lastMaxHz = max;
    this.dom.pollingAvgHz.textContent = `${avg} Hz`;
    this.dom.pollingJitterHz.textContent = `± ${jitter} Hz`;
    this.dom.pollingMinMax.textContent = t('diagnostics.minMax', { min, max });

    // Scale dynamically up to max model polling (supports 1K, 2K, 4K, 8K without clipping)
    const maxScale = Math.max(1000, this.currentModel?.maxPolling || 1000, max);

    ctx.strokeStyle = '#ea5413';
    ctx.lineWidth = 2;
    ctx.beginPath();
    rates.forEach((hz, idx) => {
      const x = (idx / Math.max(1, rates.length - 1)) * w;
      const y = h - clamp(hz / maxScale, 0.02, 0.96) * h;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // === Utilities & Logging ===

  logPacket(dir, reportId, data) {
    if (!this.dom.packetLog) return;
    const row = document.createElement('div');
    row.className = 'log-entry';
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    const cls = dir === 'TX' ? 'log-dir-tx' : dir === 'RX' ? 'log-dir-rx' : 'log-dir-warn';
    const content =
      typeof data === 'string'
        ? data
        : Array.from(data)
            .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
            .join(' ');
    row.innerHTML = `<span class="log-ts">${ts}</span><span class="${cls}">[${dir} R${reportId}]</span><span>${content}</span>`;
    this.dom.packetLog.appendChild(row);
    while (this.dom.packetLog.children.length > 200) {
      this.dom.packetLog.removeChild(this.dom.packetLog.firstChild);
    }
    this.dom.packetLog.scrollTop = this.dom.packetLog.scrollHeight;
  }

  formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = String(seconds % 60).padStart(2, '0');
    return t('common.durationMinSec', { m, s });
  }

  downloadJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `toast${isError ? ' error' : ''}`;
    toast.textContent = message;
    this.dom.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.dareuApp = new DareuControlApp();
});
