import NM from 'gi://NM';

/**
 * Gather detailed information about all active NetworkManager connections.
 *
 * @param {NM.Client} client
 * @returns {object} structured connection data
 */
export function gatherConnectionInfo(client) {
    if (!client)
        return {connections: [], vpnActive: false, vpnName: null};

    const activeConnections = client.get_active_connections() || [];
    const connections = [];
    let vpnActive = false;
    let vpnName = null;

    for (const conn of activeConnections) {
        if (conn.state !== NM.ActiveConnectionState.ACTIVATED)
            continue;

        const info = _extractConnectionInfo(conn);
        connections.push(info);

        if (info.isVpn) {
            vpnActive = true;
            vpnName = info.id;
        }
    }

    const dns = _gatherDnsInfo(client);
    const routing = _gatherRoutingInfo(client);

    return {connections, vpnActive, vpnName, dns, routing};
}

function _extractConnectionInfo(conn) {
    const type = conn.get_connection_type();
    const id = conn.get_id();
    const uuid = conn.get_uuid();
    const isVpn = type === 'vpn' || type === 'wireguard';

    const devices = conn.get_devices() || [];
    const interfaces = devices.map(d => d.get_iface()).filter(Boolean);

    const ipv4 = [];
    const ipv6 = [];
    const dnsServers = [];
    let dhcp = false;

    const ip4Config = conn.get_ip4_config();
    if (ip4Config) {
        const addrs = ip4Config.get_addresses() || [];
        for (const addr of addrs)
            ipv4.push(`${addr.get_address()}/${addr.get_prefix()}`);

        const nameservers = ip4Config.get_nameservers() || [];
        for (const ns of nameservers)
            dnsServers.push(ns);
    }

    const ip6Config = conn.get_ip6_config();
    if (ip6Config) {
        const addrs = ip6Config.get_addresses() || [];
        for (const addr of addrs)
            ipv6.push(`${addr.get_address()}/${addr.get_prefix()}`);

        const nameservers = ip6Config.get_nameservers() || [];
        for (const ns of nameservers)
            dnsServers.push(ns);
    }

    const dhcp4Config = conn.get_dhcp4_config();
    dhcp = dhcp4Config !== null;

    return {id, uuid, type, isVpn, interfaces, ipv4, ipv6, dnsServers, dhcp};
}

/**
 * Gather DNS servers from all active connections and detect potential leaks.
 * A DNS leak is when DNS queries go to servers outside the VPN tunnel.
 */
function _gatherDnsInfo(client) {
    const activeConnections = client.get_active_connections() || [];
    const vpnDns = [];
    const nonVpnDns = [];

    for (const conn of activeConnections) {
        if (conn.state !== NM.ActiveConnectionState.ACTIVATED)
            continue;

        const type = conn.get_connection_type();
        const isVpn = type === 'vpn' || type === 'wireguard';

        const ip4Config = conn.get_ip4_config();
        if (ip4Config) {
            const nameservers = ip4Config.get_nameservers() || [];
            for (const ns of nameservers) {
                if (isVpn)
                    vpnDns.push(ns);
                else
                    nonVpnDns.push(ns);
            }
        }
    }

    // DNS leak: VPN is active but DNS still goes to non-VPN servers
    const hasVpn = vpnDns.length > 0;
    const dnsLeak = hasVpn && nonVpnDns.length > 0;

    return {
        vpnDns,
        nonVpnDns,
        allServers: [...vpnDns, ...nonVpnDns],
        dnsLeak,
        hasVpn,
    };
}

/**
 * Determine routing mode: full tunnel vs split tunnel.
 */
function _gatherRoutingInfo(client) {
    const activeConnections = client.get_active_connections() || [];
    let vpnHasDefaultRoute = false;
    let defaultRouteInterface = null;
    const vpnRoutes = [];

    for (const conn of activeConnections) {
        if (conn.state !== NM.ActiveConnectionState.ACTIVATED)
            continue;

        const type = conn.get_connection_type();
        const isVpn = type === 'vpn' || type === 'wireguard';
        const devices = conn.get_devices() || [];
        const iface = devices.length > 0 ? devices[0].get_iface() : null;

        const ip4Config = conn.get_ip4_config();
        if (ip4Config) {
            const routes = ip4Config.get_routes() || [];
            for (const route of routes) {
                const dest = route.get_dest();
                const prefix = route.get_prefix();

                if (dest === '0.0.0.0' && prefix === 0) {
                    if (isVpn)
                        vpnHasDefaultRoute = true;
                    defaultRouteInterface = iface;
                }

                if (isVpn && !(dest === '0.0.0.0' && prefix === 0))
                    vpnRoutes.push(`${dest}/${prefix}`);
            }
        }
    }

    const hasVpn = activeConnections.some(c =>
        c.state === NM.ActiveConnectionState.ACTIVATED &&
        (c.get_connection_type() === 'vpn' || c.get_connection_type() === 'wireguard'));

    let mode = 'No VPN';
    if (hasVpn)
        mode = vpnHasDefaultRoute ? 'Full tunnel' : `Split tunnel (${vpnRoutes.length} routes)`;

    return {mode, defaultRouteInterface, vpnHasDefaultRoute, vpnRoutes};
}
