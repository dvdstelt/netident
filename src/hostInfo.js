import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.DBusProxy, 'new_for_bus', 'new_for_bus_finish');

/**
 * Get the name of this machine as the user knows it: the pretty hostname
 * from systemd-hostnamed when set, otherwise the static hostname.
 *
 * @returns {string}
 */
export async function getDeviceName() {
    try {
        const proxy = await Gio.DBusProxy.new_for_bus(
            Gio.BusType.SYSTEM,
            Gio.DBusProxyFlags.DO_NOT_CONNECT_SIGNALS,
            null,
            'org.freedesktop.hostname1',
            '/org/freedesktop/hostname1',
            'org.freedesktop.hostname1',
            null);

        for (const property of ['PrettyHostname', 'StaticHostname', 'Hostname']) {
            const value = proxy.get_cached_property(property)?.unpack();
            if (value)
                return value;
        }
    } catch (e) {
        console.error(`NetIdent: hostname1 lookup failed: ${e}`);
    }

    return GLib.get_host_name();
}
