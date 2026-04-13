# NetIdent

A GNOME Shell extension that shows your external IP address and network identity in the top bar. Click it for a detailed overview of all your active connections.

## Features

**Top bar indicator:**
- External IP address (with optional masking)
- Country flag emoji
- Color-coded VPN status icon (green = VPN active, red = no VPN)

**Popup menu:**
- External IP details: IP, hostname, ISP, location, timezone
- VPN status with connection name
- DNS servers and leak detection
- Routing mode (full tunnel vs split tunnel)
- All active connections with IPv4/IPv6, DNS, DHCP/static
- Tailscale status: hostname, tailnet, exit node, MagicDNS, peers
- System proxy settings
- Copy any value to clipboard by clicking it

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
- Show/hide IP address, country flag, VPN icon
- Mask IP address
- Refresh interval (1 min to 1 hour)

## License

GPL-3.0
