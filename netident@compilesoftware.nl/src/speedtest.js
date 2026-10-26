import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

// Cloudflare serves at most 50 MB per request, so the built-in test runs a
// few parallel streams and repeats them until MIN_TEST_SECONDS have passed.
const CLOUDFLARE_DOWN = 'https://speed.cloudflare.com/__down?bytes=50000000';
const CLOUDFLARE_UP = 'https://speed.cloudflare.com/__up';
const UPLOAD_BYTES = 25000000;
const STREAMS = 4;
const BATCH_MAX_SECONDS = 8;
const MIN_TEST_SECONDS = 5;

const CURL_BASE = [
    'curl', '-sS', '--parallel', '--parallel-immediate',
    '--max-time', `${BATCH_MAX_SECONDS}`,
];

/**
 * Run a speed test with the best tool available:
 *
 * 1. Ookla's `speedtest` CLI (speedtest.net servers)
 * 2. `speedtest-cli` (community speedtest.net client)
 * 3. Built-in test against Cloudflare's speed endpoints using `curl`
 *
 * @param {Function} onPhase - called with a phase key:
 *     'starting', 'download', 'upload'
 * @param {Gio.Cancellable|null} cancellable
 * @returns {object} {ok, download, upload, latency, server, provider}
 *     with download/upload in bytes per second, or {ok: false, error}
 */
export async function runSpeedTest(onPhase = () => {}, cancellable = null) {
    const ookla = await _findOoklaCli(cancellable);
    if (ookla)
        return _runOokla(ookla, onPhase, cancellable);

    if (GLib.find_program_in_path('speedtest-cli'))
        return _runSpeedtestCli(onPhase, cancellable);

    if (GLib.find_program_in_path('curl'))
        return _runCloudflare(onPhase, cancellable);

    return {
        ok: false,
        error: 'No speed test tool found. Install the Ookla speedtest CLI, speedtest-cli or curl.',
    };
}

/**
 * Both Ookla and the community client install a `speedtest` binary.
 * Only Ookla's prints its name in `--version`.
 */
async function _findOoklaCli(cancellable) {
    const path = GLib.find_program_in_path('speedtest');
    if (!path)
        return null;

    const {stdout} = await _run([path, '--version'], cancellable);
    return /ookla/i.test(stdout || '') ? path : null;
}

async function _runOokla(path, onPhase, cancellable) {
    onPhase('starting');
    const argv = [path, '--format=json', '--accept-license', '--accept-gdpr', '--progress=no'];
    const {success, stdout, stderr} = await _run(argv, cancellable);

    if (!success)
        return {ok: false, error: stderr?.trim() || 'speedtest failed'};

    try {
        const data = JSON.parse(stdout);
        return {
            ok: true,
            download: data.download?.bandwidth ?? 0,
            upload: data.upload?.bandwidth ?? 0,
            latency: data.ping?.latency ?? null,
            server: [data.server?.name, data.server?.location].filter(Boolean).join(', ') || null,
            provider: 'speedtest.net',
        };
    } catch (e) {
        return {ok: false, error: `Could not parse speedtest output: ${e}`};
    }
}

async function _runSpeedtestCli(onPhase, cancellable) {
    onPhase('starting');
    const {success, stdout, stderr} = await _run(['speedtest-cli', '--json', '--secure'], cancellable);

    if (!success)
        return {ok: false, error: stderr?.trim() || 'speedtest-cli failed'};

    try {
        const data = JSON.parse(stdout);
        return {
            ok: true,
            download: (data.download ?? 0) / 8,
            upload: (data.upload ?? 0) / 8,
            latency: data.ping ?? null,
            server: [data.server?.sponsor, data.server?.name].filter(Boolean).join(', ') || null,
            provider: 'speedtest.net',
        };
    } catch (e) {
        return {ok: false, error: `Could not parse speedtest-cli output: ${e}`};
    }
}

async function _runCloudflare(onPhase, cancellable) {
    onPhase('download');
    const downloadArgv = [
        ...CURL_BASE, '-w', '%{http_code} %{size_download}\n',
        ...Array(STREAMS).fill(['-o', '/dev/null', CLOUDFLARE_DOWN]).flat(),
    ];
    const download = await _measure(downloadArgv, cancellable);
    if (download === null)
        return {ok: false, error: 'download test failed'};

    onPhase('upload');
    let upload = null;
    let tmpFile = null;
    try {
        tmpFile = _createSparseFile(UPLOAD_BYTES);
        const uploadArgv = [
            ...CURL_BASE, '-w', '%{http_code} %{size_upload}\n',
            '-X', 'POST', '-H', 'Content-Type: application/octet-stream',
            '--data-binary', `@${tmpFile.get_path()}`,
            ...Array(STREAMS).fill(['-o', '/dev/null', CLOUDFLARE_UP]).flat(),
        ];
        upload = await _measure(uploadArgv, cancellable);
    } catch (e) {
        return {ok: false, error: `upload test failed: ${e}`};
    } finally {
        try {
            tmpFile?.delete(null);
        } catch {
            // best effort
        }
    }

    if (upload === null)
        return {ok: false, error: 'upload test failed'};

    return {
        ok: true,
        download,
        upload,
        latency: null,
        server: null,
        provider: 'Cloudflare',
    };
}

/**
 * Run one curl batch repeatedly until MIN_TEST_SECONDS have passed and
 * return the aggregate throughput in bytes per second. curl prints its
 * write-out line per transfer even when --max-time cut the transfer short.
 */
async function _measure(argv, cancellable) {
    let totalBytes = 0;
    let totalSeconds = 0;

    while (totalSeconds < MIN_TEST_SECONDS) {
        const start = GLib.get_monotonic_time();
        const {stdout} = await _run(argv, cancellable);
        const seconds = (GLib.get_monotonic_time() - start) / 1e6;

        if (cancellable?.is_cancelled())
            return null;

        const bytes = (stdout || '').split('\n')
            .map(line => line.trim().split(/\s+/))
            .filter(([code]) => code === '200')
            .reduce((sum, [, size]) => sum + (Number(size) || 0), 0);

        if (bytes <= 0)
            return null;

        totalBytes += bytes;
        totalSeconds += seconds;
    }

    return totalBytes / totalSeconds;
}

/**
 * A sparse file reads back as zeros without using disk space.
 */
function _createSparseFile(size) {
    const [file, stream] = Gio.File.new_tmp('netident-upload-XXXXXX');
    stream.get_output_stream().truncate(size, null);
    stream.close(null);
    return file;
}

async function _run(argv, cancellable) {
    try {
        const proc = Gio.Subprocess.new(argv,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        const cancelId = cancellable?.connect(() => proc.force_exit()) ?? 0;
        try {
            const [stdout, stderr] = await proc.communicate_utf8_async(null, cancellable);
            return {success: proc.get_successful(), stdout, stderr};
        } finally {
            if (cancelId)
                cancellable.disconnect(cancelId);
        }
    } catch (e) {
        return {success: false, stdout: '', stderr: `${e}`};
    }
}
