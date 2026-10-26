# NetIdent

A GNOME Shell extension that shows your external IP address and network identity in the top bar. Click it for a detailed overview of all your active connections.

## Features

**Top bar indicator:**
- VPN or Tailscale status icon (red unlock icon when neither is active)
- Live download and upload rates
- Country flag of your public IP
- External IP address (optional, with masking)

**Popup dashboard:**
- Connection header: link type, device name, link speed, online status
- Live traffic graph for the last 60 seconds with session totals
- Internet latency, jitter and packet loss (ping probe, 1.1.1.1 by default) and gateway latency
- Public IP with ISP and location, click to copy
- Internet route: VPN status, routing mode, gateway, DNS servers and leak detection, system proxy
- Tailscale: on/off toggle, hostname, Tailscale IP, DNS name, tailnet, exit node, MagicDNS, peers
- Connection details: every active connection with IPv4/IPv6, DNS, DHCP/static
- Speed test button
- Copy any value in the detail rows to the clipboard by clicking it

**Speed test:** the button uses the first tool it finds: the [Ookla speedtest CLI](https://www.speedtest.net/apps/cli) (speedtest.net servers), `speedtest-cli`, or a built-in test against Cloudflare's speed endpoints using `curl`. Install the Ookla CLI if you want results from speedtest.net.

**Theme:** the popup follows the GNOME Shell style. On GNOME Shell 50 and later it switches between the dark and light variants with the system color scheme.

## Install

Install from [extensions.gnome.org](https://extensions.gnome.org) (search for "NetIdent"), or download the latest release from the [releases page](https://github.com/dvdstelt/netident/releases).

## Compatibility

GNOME Shell 45, 46, 47, 48, 49, 50

## Preferences

Open via the gear icon in the popup, or:

```bash
gnome-extensions prefs netident@compilesoftware.nl
```

- Panel position (left, center, right)
- Show/hide live traffic, IP address, country flag, VPN icon
- Mask IP address
- Latency probe host
- Refresh interval (1 min to 1 hour)

## License

GPL-3.0
