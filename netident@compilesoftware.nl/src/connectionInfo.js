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

/**
 * Describe the device that carries the primary connection: what kind of
 * link it is, its interface, link speed, Wi-Fi network and gateway.
 *
 * When the primary connection is a VPN, the physical device underneath it
 * is described instead, so the header always shows the real link.
 *
 * @param {NM.Client} client
 * @returns {object|null}
 */
export function getPrimaryDeviceInfo(client) {
    if (!client)
        return null;

    const primary = client.get_primary_connection();
    let device = _firstDevice(primary);

    if (!device || _isTunnelDevice(device)) {
        const physical = (client.get_active_connections() || []).find(conn =>
            conn.state === NM.ActiveConnectionState.ACTIVATED &&
            !_isVpnType(conn.get_connection_type()) &&
            _firstDevice(conn) && !_isTunnelDevice(_firstDevice(conn)));
        device = _firstDevice(physical) || device;
    }

    if (!device)
        return null;

    const info = {
        iface: device.get_iface(),
        connectionId: primary?.get_id() || null,
        kind: 'other',
        title: primary?.get_id() || device.get_iface(),
        iconName: 'network-wired-symbolic',
        linkSpeedMbps: null,
        ssid: null,
        gateway: _gatewayOf(primary) || _gatewayOf(device) || null,
        localIp: _firstAddress(device.get_ip4_config()) || _firstAddress(device.get_ip6_config()) || null,
        connectivity: _connectivityName(client.get_connectivity()),
    };

    switch (device.get_device_type()) {
    case NM.DeviceType.ETHERNET:
        info.kind = 'wired';
        info.title = 'Wired connection';
        info.iconName = 'network-wired-symbolic';
        info.linkSpeedMbps = device.get_speed?.() || null;
        break;
    case NM.DeviceType.WIFI: {
        info.kind = 'wifi';
        info.title = 'Wi-Fi';
        info.iconName = 'network-wireless-symbolic';
        const ap = device.get_active_access_point?.();
        const ssid = ap?.get_ssid();
        if (ssid)
            info.ssid = NM.utils_ssid_to_utf8(ssid.get_data());
        const bitrate = device.get_bitrate?.() || 0;
        info.linkSpeedMbps = bitrate ? Math.round(bitrate / 1000) : null;
        break;
    }
    case NM.DeviceType.MODEM:
        info.kind = 'mobile';
        info.title = 'Mobile broadband';
        info.iconName = 'network-cellular-symbolic';
        break;
    case NM.DeviceType.BRIDGE:
    case NM.DeviceType.BOND:
    case NM.DeviceType.TEAM:
        info.kind = 'virtual';
        info.iconName = 'network-wired-symbolic';
        break;
    default:
        break;
    }

    return info;
}

function _firstDevice(activeConnection) {
    const devices = activeConnection?.get_devices() || [];
    return devices.length > 0 ? devices[0] : null;
}

function _isVpnType(type) {
    return type === 'vpn' || type === 'wireguard';
}

function _isTunnelDevice(device) {
    const type = device.get_device_type();
    return type === NM.DeviceType.TUN ||
        type === NM.DeviceType.WIREGUARD ||
        type === NM.DeviceType.VPN ||
        type === NM.DeviceType.IP_TUNNEL;
}

function _firstAddress(ipConfig) {
    const addresses = ipConfig?.get_addresses() || [];
    return addresses.length > 0 ? addresses[0].get_address() : null;
}

function _gatewayOf(owner) {
    return owner?.get_ip4_config()?.get_gateway() ||
        owner?.get_ip6_config()?.get_gateway() ||
        null;
}

function _connectivityName(state) {
    switch (state) {
    case NM.ConnectivityState.FULL:
        return 'online';
    case NM.ConnectivityState.LIMITED:
        return 'limited';
    case NM.ConnectivityState.PORTAL:
        return 'portal';
    case NM.ConnectivityState.NONE:
        return 'offline';
    default:
        return 'unknown';
    }
}
