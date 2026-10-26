import Gio from 'gi://Gio';

/**
 * Read system proxy settings from org.gnome.system.proxy GSettings.
 *
 * @returns {object} proxy configuration details
 */
export function getProxySettings() {
    try {
        const proxySettings = new Gio.Settings({schema_id: 'org.gnome.system.proxy'});
        const mode = proxySettings.get_string('mode');

        if (mode === 'none')
            return {enabled: false, mode};

        const result = {enabled: true, mode, proxies: []};

        if (mode === 'manual') {
            const httpSettings = new Gio.Settings({
                schema_id: 'org.gnome.system.proxy.http',
            });
            const httpHost = httpSettings.get_string('host');
            const httpPort = httpSettings.get_int('port');
            if (httpHost)
                result.proxies.push({type: 'HTTP', host: httpHost, port: httpPort});

            const httpsSettings = new Gio.Settings({
                schema_id: 'org.gnome.system.proxy.https',
            });
            const httpsHost = httpsSettings.get_string('host');
            const httpsPort = httpsSettings.get_int('port');
            if (httpsHost)
                result.proxies.push({type: 'HTTPS', host: httpsHost, port: httpsPort});

            const socksSettings = new Gio.Settings({
                schema_id: 'org.gnome.system.proxy.socks',
            });
            const socksHost = socksSettings.get_string('host');
            const socksPort = socksSettings.get_int('port');
            if (socksHost)
                result.proxies.push({type: 'SOCKS', host: socksHost, port: socksPort});

            const ftpSettings = new Gio.Settings({
                schema_id: 'org.gnome.system.proxy.ftp',
            });
            const ftpHost = ftpSettings.get_string('host');
            const ftpPort = ftpSettings.get_int('port');
            if (ftpHost)
                result.proxies.push({type: 'FTP', host: ftpHost, port: ftpPort});
        } else if (mode === 'auto') {
            const autoConfigUrl = proxySettings.get_string('autoconfig-url');
            if (autoConfigUrl)
                result.autoConfigUrl = autoConfigUrl;
        }

        return result;
    } catch (e) {
        console.error(`NetIdent: getProxySettings error: ${e}`);
        return {enabled: false, mode: 'error', error: `${e}`};
    }
}
