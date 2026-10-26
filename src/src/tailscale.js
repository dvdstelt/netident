import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

/**
 * Query Tailscale status via `tailscale status --json`.
 *
 * @returns {object} parsed Tailscale status or error info
 */
export async function getTailscaleStatus() {
    try {
        const proc = Gio.Subprocess.new(
            ['tailscale', 'status', '--json'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);

        const [stdout, stderr] = await proc.communicate_utf8_async(null, null);

        if (!proc.get_successful()) {
            const errMsg = stderr?.trim() || 'tailscale command failed';
            return {available: false, error: errMsg};
        }

        const data = JSON.parse(stdout);

        const selfNode = data.Self || {};
        const backendState = data.BackendState || 'Unknown';
        const running = backendState === 'Running';

        // Exit node detection
        let exitNode = null;
        if (data.ExitNodeStatus) {
            exitNode = {
                id: data.ExitNodeStatus.ID || null,
                online: data.ExitNodeStatus.Online ?? false,
            };
        }

        // Check peers for active exit node
        const peers = data.Peer || {};
        for (const [_key, peer] of Object.entries(peers)) {
            if (peer.ExitNode) {
                exitNode = {
                    name: peer.HostName || peer.DNSName || 'Unknown',
                    online: peer.Online ?? false,
                    tailscaleIp: peer.TailscaleIPs?.[0] || null,
                };
                break;
            }
        }

        return {
            available: true,
            running,
            backendState,
            hostname: selfNode.HostName || null,
            tailscaleIp: selfNode.TailscaleIPs?.[0] || null,
            dnsName: selfNode.DNSName || null,
            exitNode,
            magicDnsSuffix: data.MagicDNSSuffix || null,
            currentTailnet: data.CurrentTailnet?.Name || null,
            peerCount: Object.keys(peers).length,
        };
    } catch (e) {
        // Tailscale not installed or not accessible
        return {available: false, error: `${e}`};
    }
}

/**
 * Bring Tailscale up or down via `tailscale up` / `tailscale down`.
 *
 * Runs the plain command first, which succeeds when the current user is the
 * Tailscale operator (`sudo tailscale set --operator=$USER`). On a permission
 * error it retries through `pkexec` so polkit can prompt for authorization.
 *
 * @param {boolean} up - true for `tailscale up`, false for `tailscale down`
 * @returns {object} {success} or {success: false, error}
 */
export async function setTailscaleState(up) {
    const args = ['tailscale', up ? 'up' : 'down'];
    let error = null;

    for (const argv of [args, ['pkexec', ...args]]) {
        try {
            const proc = Gio.Subprocess.new(
                argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);

            const [, stderr] = await proc.communicate_utf8_async(null, null);

            if (proc.get_successful())
                return {success: true};

            error = stderr?.trim() || `${argv.join(' ')} failed`;

            // Only escalate to pkexec on permission problems
            if (!/access denied|permission denied|not authorized/i.test(error))
                break;
        } catch (e) {
            error = `${e}`;
            break;
        }
    }

    return {success: false, error};
}
