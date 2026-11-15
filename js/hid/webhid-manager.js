/**
 * WebHID Manager & Device Connection Dispatcher
 * Handles device discovery (including 2.4G dongle PID 0x1154), interface prioritization,
 * and protocol driver initialization (JM vs TG).
 */

import { DAREU_DEVICES, DEFAULT_DEVICE_FALLBACK } from '../devices.js?v=4.1.0';
import { JmDevice } from '../protocol/jm-device.js?v=4.1.0';
import { TgDevice } from '../protocol/tg-device.js?v=4.1.0';
import { t } from '../i18n/index.js?v=4.1.0';

export class WebHidManager {
  constructor(logger = null) {
    this.hidDevice = null;
    this.driver = null;
    this.profile = null;
    this.isConnected = false;
    this.logger = logger || (() => {});
    this.onStatusChange = () => {};
    this._inFlightPromise = null;
    this._disconnectHandlerRegistered = false;
  }

  isSupported() {
    return typeof navigator !== 'undefined' && 'hid' in navigator;
  }

  /**
   * Find the vendor-defined command interface among opened/paired HID collections.
   */
  findCommandDevice(devices) {
    if (!devices || devices.length === 0) return null;

    // 1. JM standard vendor command collection (UsagePage 0xFF02, Usage 0x02)
    let target = devices.find(
      d =>
        d.vendorId === 0x260d &&
        d.collections.some(c => (c.usagePage === 0xff02 || c.usagePage === 65282) && (c.usage === 0x02 || c.usage === 2))
    );
    if (target) return target;

    // 2. TG secondary vendor collection (0xFFA0 / 0xFF04 / 0xFF01)
    target = devices.find(
      d =>
        d.vendorId === 0x260d &&
        d.collections.some(
          c =>
            c.usagePage === 0xff01 ||
            c.usagePage === 65281 ||
            c.usagePage === 0xffa0 ||
            c.usagePage === 0xff04
        )
    );
    if (target) return target;

    // 3. Any vendor-defined collection (usagePage >= 0xFF00)
    target = devices.find(
      d => d.vendorId === 0x260d && d.collections.some(c => c.usagePage >= 0xff00 || c.usagePage >= 65280)
    );
    if (target) return target;

    // 4. Fallback: non-boot-mouse Dareu collection
    target = devices.find(
      d => d.vendorId === 0x260d && !d.collections.every(c => c.usagePage === 1 && c.usage === 2)
    );
    if (target) return target;

    return devices.find(d => d.vendorId === 0x260d) || devices[0];
  }

  async requestAndConnect() {
    if (this._inFlightPromise) return this._inFlightPromise;
    if (!this.isSupported()) {
      throw new Error(t('errors.webhidUnsupported'));
    }

    const filters = [
      { vendorId: 0x260d, usagePage: 0xff02, usage: 0x02 },
      { vendorId: 0x260d, usagePage: 0xffa0, usage: 0x01 },
      { vendorId: 0x260d, usagePage: 0xff04, usage: 0x02 },
      { vendorId: 0x260d, usagePage: 0xff01, usage: 0x00 },
      { vendorId: 0x260d, productId: 0x1154 },
      { vendorId: 0x260d },
    ];

    const devices = await navigator.hid.requestDevice({ filters });
    if (!devices || devices.length === 0) return null;

    const selected = this.findCommandDevice(devices);
    if (!selected) throw new Error(t('errors.noCommandInterface'));

    this._inFlightPromise = this.connectDevice(selected);
    try {
      return await this._inFlightPromise;
    } finally {
      this._inFlightPromise = null;
    }
  }

  async autoConnectExisting() {
    if (this._inFlightPromise) return this._inFlightPromise;
    if (!this.isSupported()) return null;

    try {
      const existing = await navigator.hid.getDevices();
      const dareuDevice = this.findCommandDevice(existing);
      if (dareuDevice) {
        this._inFlightPromise = this.connectDevice(dareuDevice);
        try {
          return await this._inFlightPromise;
        } finally {
          this._inFlightPromise = null;
        }
      }
    } catch (e) {
      this.logger('WARN', 0, `Auto-connect probe failed: ${e.message}`);
    }
    return null;
  }

  async connectDevice(hidDevice) {
    if (this.isConnected && this.hidDevice === hidDevice) return this.driver;
    if (this.isConnected && this.hidDevice) {
      await this.disconnect();
    }

    this.hidDevice = hidDevice;
    if (!hidDevice.opened) {
      await hidDevice.open();
    }

    const pid = hidDevice.productId;
    const baseProfile = DAREU_DEVICES[pid] || {
      ...DEFAULT_DEVICE_FALLBACK,
      pid,
      name: hidDevice.productName || `Dareu Device (0x${pid.toString(16).toUpperCase()})`,
    };
    this.profile = { ...baseProfile };

    if (this.profile.fwType === 2) {
      this.driver = new JmDevice(hidDevice, this.profile, this.logger);
    } else {
      this.driver = new TgDevice(hidDevice, this.profile, this.logger);
    }

    if (this.driver.initDevice) {
      try {
        await this.driver.initDevice();
      } catch (e) {
        console.warn('Driver initialization warning:', e);
      }
    }

    if (!this._disconnectHandlerRegistered) {
      this._disconnectHandlerRegistered = true;
      navigator.hid.addEventListener('disconnect', event => {
        if (this.hidDevice && event.device === this.hidDevice) {
          this.isConnected = false;
          this.hidDevice = null;
          this.driver = null;
          this.logger('WARN', 0, 'Device disconnected');
          this.onStatusChange(false, null);
        }
      });
    }

    this.isConnected = true;
    this.onStatusChange(true, this.profile);
    return this.driver;
  }

  async disconnect() {
    if (this.driver && typeof this.driver.dispose === 'function') {
      try {
        this.driver.dispose();
      } catch (_) {}
    }
    if (this.hidDevice && this.hidDevice.opened) {
      try {
        await this.hidDevice.close();
      } catch (e) {
        console.warn('Error closing HID device:', e);
      }
    }
    this.isConnected = false;
    this.hidDevice = null;
    this.driver = null;
    this.onStatusChange(false, null);
  }
}
