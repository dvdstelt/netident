import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

const API_URL = 'https://ipinfo.io/json';

/**
 * Fetch external IP details from ipinfo.io.
 *
 * @param {Soup.Session} session - reusable Soup session
 * @returns {{data: object|null, error: string|null}}
 */
export async function fetchExternalIp(session) {
    const message = Soup.Message.new('GET', API_URL);

    try {
        const bytes = await session.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, null);

        if (message.statusCode !== Soup.Status.OK) {
            return {data: null, error: `HTTP ${message.statusCode}`};
        }

        const decoder = new TextDecoder('utf-8');
        const data = JSON.parse(decoder.decode(bytes.get_data()));

        // Normalize location to separate lat/lon
        if (typeof data.loc === 'string' && data.loc.includes(',')) {
            const [lat, lon] = data.loc.split(',').map(s => s.trim());
            data.lat = lat;
            data.lon = lon;
        }

        return {data, error: null};
    } catch (e) {
        console.error(`NetIdent: fetchExternalIp error: ${e}`);
        return {data: null, error: `${e}`};
    }
}

/**
 * Get a country flag emoji from a two-letter country code.
 *
 * @param {string} countryCode
 * @returns {string}
 */
export function getFlagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2)
        return '';
    return [...countryCode.toUpperCase()]
        .map(char => String.fromCodePoint(127397 + char.charCodeAt()))
        .join('');
}

/**
 * Mask an IP address by replacing the last segments with asterisks.
 *
 * @param {string} ip
 * @returns {string}
 */
export function maskIp(ip) {
    if (!ip || typeof ip !== 'string')
        return '';

    const isIPv4 = ip.includes('.');
    const separator = isIPv4 ? '.' : ':';
    const segments = ip.split(separator);

    return segments
        .map((seg, i) => i < 2 ? seg : '*'.repeat(seg.length))
        .join(separator);
}
