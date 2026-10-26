import Gio from 'gi://Gio';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

/**
 * Measure latency, jitter and packet loss to a host with the system `ping`.
 *
 * @param {string} host - IP address or hostname
 * @param {number} count - number of echo requests
 * @param {Gio.Cancellable|null} cancellable
 * @returns {object} {ok, host, latency, jitter, loss} or {ok: false, host, error}
 */
export async function pingHost(host, count = 5, cancellable = null) {
    if (!host)
        return {ok: false, host, error: 'no host'};

    const argv = [
        'ping', '-n', '-q',
        '-c', `${count}`,
        '-i', '0.2',
        '-W', '1',
        '-w', `${count + 2}`,
        host,
    ];

    try {
        const proc = Gio.Subprocess.new(argv,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        const cancelId = cancellable?.connect(() => proc.force_exit()) ?? 0;
        let stdout, stderr;
        try {
            [stdout, stderr] = await proc.communicate_utf8_async(null, cancellable);
        } finally {
            if (cancelId)
                cancellable.disconnect(cancelId);
        }
        const parsed = parsePingOutput(stdout || '');

        if (!parsed)
            return {ok: false, host, error: stderr?.trim() || 'no reply'};

        return {ok: true, host, ...parsed};
    } catch (e) {
        return {ok: false, host, error: `${e}`};
    }
}

/**
 * Parse the summary lines printed by iputils ping.
 *
 * @param {string} output
 * @returns {{latency: number|null, jitter: number|null, loss: number}|null}
 */
export function parsePingOutput(output) {
    const lossMatch = output.match(/(\d+(?:\.\d+)?)% packet loss/);
    if (!lossMatch)
        return null;

    const loss = Number(lossMatch[1]);
    const rttMatch = output.match(/= ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+) ms/);

    if (!rttMatch)
        return {latency: null, jitter: null, loss};

    return {
        latency: Number(rttMatch[2]),
        jitter: Number(rttMatch[4]),
        loss,
    };
}
