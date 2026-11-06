import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

export const ADMIN_CONSOLE_URL = 'https://login.tailscale.com/admin/machines';

// Names of Tailscale DERP relay regions, keyed by region code.
const RELAY_NAMES = {
    ams: 'Amsterdam', blr: 'Bangalore', den: 'Denver', dfw: 'Dallas',
    dxb: 'Dubai', fra: 'Frankfurt', hel: 'Helsinki', hkg: 'Hong Kong',
    hnl: 'Honolulu', iad: 'Ashburn', jnb: 'Johannesburg', lax: 'Los Angeles',
    lhr: 'London', mad: 'Madrid', mel: 'Melbourne', mia: 'Miami', mil: 'Milan',
    nai: 'Nairobi', nue: 'Nuremberg', nyc: 'New York', ord: 'Chicago',
    par: 'Paris', sao: 'São Paulo', sea: 'Seattle', sfo: 'San Francisco',
    sin: 'Singapore', syd: 'Sydney', tok: 'Tokyo', tor: 'Toronto', waw: 'Warsaw',
};

const OS_NAMES = {
    linux: 'Linux', windows: 'Windows', macos: 'macOS', ios: 'iOS',
    android: 'Android', freebsd: 'FreeBSD', openbsd: 'OpenBSD', tvos: 'tvOS',
};

/**
 * @param {string} code - DERP region code such as 'fra'
 * @returns {string}
 */
export function relayName(code) {
    if (!code)
        return '';
    return RELAY_NAMES[code.toLowerCase()] || code.toUpperCase();
}

/**
 * @param {string} os - OS string from tailscale status
 * @returns {string}
 */
export function osName(os) {
    if (!os)
        return '';
    return OS_NAMES[os.toLowerCase()] || os;
}

/**
 * Query Tailscale status via `tailscale status --json`.
 *
 * @returns {object} parsed Tailscale status or error info
 */
export async function getTailscaleStatus() {
    const {success, stdout, stderr, error} = await _run(['tailscale', 'status', '--json']);

    if (error)
        return {available: false, error};
    if (!success)
        return {available: false, error: stderr?.trim() || 'tailscale command failed'};

    let data;
    try {
        data = JSON.parse(stdout);
    } catch (e) {
        return {available: false, error: `${e}`};
    }

    const selfNode = data.Self || {};
    const backendState = data.BackendState || 'Unknown';
    const running = backendState === 'Running';
    const peers = Object.values(data.Peer || {}).map(_parsePeer);
    peers.sort(_comparePeers);

    const exitPeer = peers.find(p => p.exitNode) || null;
    let exitNode = null;
    if (exitPeer) {
        exitNode = {
            name: exitPeer.name,
            online: exitPeer.online,
            tailscaleIp: exitPeer.ip,
        };
    } else if (data.ExitNodeStatus) {
        exitNode = {
            id: data.ExitNodeStatus.ID || null,
            online: data.ExitNodeStatus.Online ?? false,
        };
    }

    const prefs = running ? await _getPrefs() : null;

    return {
        available: true,
        running,
        backendState,
        hostname: selfNode.HostName || null,
        tailscaleIp: selfNode.TailscaleIPs?.[0] || null,
        dnsName: selfNode.DNSName || null,
        os: selfNode.OS || null,
        exitNode,
        magicDnsSuffix: data.MagicDNSSuffix || null,
        currentTailnet: data.CurrentTailnet?.Name || null,
        peerCount: peers.length,
        onlineCount: peers.filter(p => p.online).length,
        peers,
        routesAccepted: prefs?.RouteAll ?? null,
        advertisedRoutes: peers.flatMap(p => p.routes),
        health: data.Health || [],
        fetchedAt: GLib.get_real_time(),
    };
}

function _parsePeer(peer) {
    const lastSeen = peer.LastSeen && !peer.LastSeen.startsWith('0001-')
        ? GLib.DateTime.new_from_iso8601(peer.LastSeen, null)
        : null;

    return {
        id: peer.ID || null,
        hostName: peer.HostName || 'Unknown',
        dnsName: (peer.DNSName || '').replace(/\.$/, ''),
        name: (peer.DNSName || peer.HostName || 'unknown').split('.')[0],
        os: peer.OS || '',
        online: peer.Online ?? false,
        active: peer.Active ?? false,
        exitNode: peer.ExitNode ?? false,
        exitNodeOption: peer.ExitNodeOption ?? false,
        relay: peer.Relay || '',
        direct: peer.CurAddr || '',
        ip: peer.TailscaleIPs?.[0] || null,
        ips: peer.TailscaleIPs || [],
        routes: peer.PrimaryRoutes || [],
        lastSeen,
        rxBytes: peer.RxBytes || 0,
        txBytes: peer.TxBytes || 0,
    };
}

function _comparePeers(a, b) {
    if (a.online !== b.online)
        return a.online ? -1 : 1;
    if (!a.online && a.lastSeen && b.lastSeen)
        return b.lastSeen.compare(a.lastSeen);
    return a.name.localeCompare(b.name);
}

/**
 * `tailscale debug prefs` is the only CLI way to read local preferences
 * such as whether advertised subnet routes are accepted.
 */
async function _getPrefs() {
    const {success, stdout} = await _run(['tailscale', 'debug', 'prefs']);
    if (!success)
        return null;
    try {
        return JSON.parse(stdout);
    } catch {
        return null;
    }
}

/**
 * Ping a peer over the tailnet with `tailscale ping`.
 *
 * @param {string} ip - Tailscale IP of the peer
 * @param {Gio.Cancellable|null} cancellable
 * @returns {object} {ok, ms, via: 'direct'|'relay', relay} or {ok: false, error}
 */
export async function pingPeer(ip, cancellable = null) {
    const argv = ['tailscale', 'ping', '-c', '1', '--timeout', '3s', ip];
    // With -c 1 the command exits non-zero when no direct path was found,
    // but it still prints the pong line, so only the output matters.
    const {stdout, stderr} = await _run(argv, cancellable);
    const match = (stdout || '').match(/pong from \S+ \(([^)]+)\) via (\S+) in (\d+(?:\.\d+)?)(ms|s)/);

    if (!match)
        return {ok: false, error: (stderr || stdout || '').trim() || 'no reply'};

    const [, , via, value, unit] = match;
    const ms = unit === 's' ? Number(value) * 1000 : Number(value);
    const relayMatch = via.match(/^DERP\((\w+)\)$/);

    return {
        ok: true,
        ms,
        via: relayMatch ? 'relay' : 'direct',
        relay: relayMatch ? relayMatch[1] : '',
    };
}

/**
 * Bring Tailscale up or down via `tailscale up` / `tailscale down`.
 *
 * @param {boolean} up - true for `tailscale up`, false for `tailscale down`
 * @returns {object} {success} or {success: false, error}
 */
export function setTailscaleState(up) {
    return _runPrivileged(['tailscale', up ? 'up' : 'down']);
}

/**
 * Route Internet traffic through a peer, or stop doing so.
 *
 * @param {string|null} ip - Tailscale IP of the exit node, or null to clear
 * @returns {object} {success} or {success: false, error}
 */
export function setExitNode(ip) {
    return _runPrivileged(['tailscale', 'set', `--exit-node=${ip || ''}`]);
}

/**
 * Accept subnet routes advertised by other peers.
 *
 * @param {boolean} accept
 * @returns {object} {success} or {success: false, error}
 */
export function setAcceptRoutes(accept) {
    return _runPrivileged(['tailscale', 'set', `--accept-routes=${accept}`]);
}

/**
 * Run a tailscale command that changes state. The plain command succeeds
 * when the current user is the Tailscale operator (`sudo tailscale set
 * --operator=$USER`). On a permission error it retries through `pkexec`
 * so polkit can prompt for authorization.
 */
async function _runPrivileged(args) {
    let error = null;

    for (const argv of [args, ['pkexec', ...args]]) {
        const result = await _run(argv);

        if (result.success)
            return {success: true};

        error = result.error || result.stderr?.trim() || `${argv.join(' ')} failed`;

        // Only escalate to pkexec on permission problems
        if (result.error || !/access denied|permission denied|not authorized/i.test(error))
            break;
    }

    return {success: false, error};
}

async function _run(argv, cancellable = null) {
    try {
        const proc = Gio.Subprocess.new(argv,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        const cancelId = cancellable?.connect(() => proc.force_exit()) ?? 0;
        try {
            const [stdout, stderr] = await proc.communicate_utf8_async(null, cancellable);
            return {success: proc.get_successful(), stdout, stderr, error: null};
        } finally {
            if (cancelId)
                cancellable.disconnect(cancelId);
        }
    } catch (e) {
        // Tailscale not installed, or the command was cancelled
        return {success: false, stdout: '', stderr: '', error: `${e}`};
    }
}
