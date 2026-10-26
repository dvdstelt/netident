import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async');

export const HISTORY_LENGTH = 60;

/**
 * Samples byte counters for one network interface from /proc/net/dev and
 * keeps a rolling history of download and upload rates in bytes per second.
 *
 * Emits 'updated' after every sample.
 */
export class TrafficMonitor extends EventEmitter {
    constructor() {
        super();
        this._file = Gio.File.new_for_path('/proc/net/dev');
        this._iface = null;
        this._timerId = null;
        this._last = null;
        this._sampling = false;

        this.rxRate = 0;
        this.txRate = 0;
        this.sessionRx = 0;
        this.sessionTx = 0;
        this.rxHistory = new Array(HISTORY_LENGTH).fill(0);
        this.txHistory = new Array(HISTORY_LENGTH).fill(0);
    }

    get iface() {
        return this._iface;
    }

    /**
     * Switch to another interface. Rates and history are reset; session
     * totals are kept because they describe this login session.
     *
     * @param {string|null} iface
     */
    setInterface(iface) {
        if (iface === this._iface)
            return;

        this._iface = iface;
        this._last = null;
        this.rxRate = 0;
        this.txRate = 0;
        this.rxHistory.fill(0);
        this.txHistory.fill(0);
        this.emit('updated');
    }

    start(intervalMs = 1000) {
        this.stop();
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
            this._sample();
            return GLib.SOURCE_CONTINUE;
        });
        this._sample();
    }

    stop() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
    }

    destroy() {
        this.stop();
        this._iface = null;
    }

    async _sample() {
        if (!this._iface || this._sampling)
            return;
        this._sampling = true;

        try {
            const [contents] = await this._file.load_contents_async(null);
            const counters = _parseProcNetDev(new TextDecoder().decode(contents), this._iface);
            if (counters)
                this._update(counters);
        } catch (e) {
            console.error(`NetIdent: traffic sample failed: ${e}`);
        } finally {
            this._sampling = false;
        }
    }

    _update({rx, tx}) {
        const now = GLib.get_monotonic_time();

        if (this._last) {
            const seconds = (now - this._last.time) / 1e6;
            if (seconds > 0) {
                const rxDelta = Math.max(0, rx - this._last.rx);
                const txDelta = Math.max(0, tx - this._last.tx);
                this.rxRate = rxDelta / seconds;
                this.txRate = txDelta / seconds;
                this.sessionRx += rxDelta;
                this.sessionTx += txDelta;
                this.rxHistory.push(this.rxRate);
                this.txHistory.push(this.txRate);
                this.rxHistory.shift();
                this.txHistory.shift();
            }
        }

        this._last = {rx, tx, time: now};
        this.emit('updated');
    }
}

/**
 * @param {string} text - contents of /proc/net/dev
 * @param {string} iface - interface name
 * @returns {{rx: number, tx: number}|null}
 */
function _parseProcNetDev(text, iface) {
    for (const line of text.split('\n')) {
        const colon = line.indexOf(':');
        if (colon < 0 || line.slice(0, colon).trim() !== iface)
            continue;

        const fields = line.slice(colon + 1).trim().split(/\s+/);
        if (fields.length < 9)
            return null;

        return {rx: Number(fields[0]), tx: Number(fields[8])};
    }
    return null;
}

/**
 * List the network interfaces known to the kernel, without loopback.
 *
 * @returns {string[]}
 */
export function listInterfaces() {
    try {
        const [, contents] = GLib.file_get_contents('/proc/net/dev');
        return new TextDecoder().decode(contents).split('\n')
            .filter(line => line.includes(':'))
            .map(line => line.split(':')[0].trim())
            .filter(name => name && name !== 'lo')
            .sort();
    } catch (e) {
        console.error(`NetIdent: could not list interfaces: ${e}`);
        return [];
    }
}

/**
 * Format a rate in bytes per second as a value/unit pair.
 *
 * @param {number} bytesPerSecond
 * @returns {{value: string, unit: string}}
 */
export function formatRate(bytesPerSecond) {
    const {value, unit} = formatBytes(bytesPerSecond);
    return {value, unit: `${unit}/s`};
}

/**
 * Format two rates that share one unit, as shown in the panel.
 *
 * @param {number} rx - download rate in bytes per second
 * @param {number} tx - upload rate in bytes per second
 * @returns {string} e.g. "↓24.8 ↑1.2 MB/s"
 */
export function formatRatePair(rx, tx) {
    const scale = _pickScale(Math.max(rx, tx));
    const fmt = v => _formatScaled(v, scale);
    return `↓${fmt(rx)} ↑${fmt(tx)} ${scale.unit}/s`;
}

/**
 * Format a byte count as a value/unit pair.
 *
 * @param {number} bytes
 * @returns {{value: string, unit: string}}
 */
export function formatBytes(bytes) {
    const scale = _pickScale(bytes);
    return {value: _formatScaled(bytes, scale), unit: scale.unit};
}

const SCALES = [
    {unit: 'B', divisor: 1, decimals: 0},
    {unit: 'KB', divisor: 1024, decimals: 0},
    {unit: 'MB', divisor: 1024 ** 2, decimals: 1},
    {unit: 'GB', divisor: 1024 ** 3, decimals: 1},
    {unit: 'TB', divisor: 1024 ** 4, decimals: 2},
];

function _pickScale(bytes) {
    let scale = SCALES[0];
    for (const candidate of SCALES) {
        if (bytes >= candidate.divisor)
            scale = candidate;
    }
    return scale;
}

function _formatScaled(bytes, scale) {
    return (bytes / scale.divisor).toFixed(scale.decimals);
}
