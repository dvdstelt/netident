import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class NetIdentPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.set_default_size(500, 600);
        window.set_search_enabled(true);

        // General page
        const generalPage = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(generalPage);

        // Panel group
        const panelGroup = new Adw.PreferencesGroup({
            title: _('Panel Indicator'),
            description: _('Configure what appears in the top bar'),
        });
        generalPage.add(panelGroup);

        panelGroup.add(this._makeSwitchRow(
            _('Show Live Traffic'), _('Display download and upload rates'),
            settings, 'show-traffic-in-panel'));

        panelGroup.add(this._makeSwitchRow(
            _('Show IP Address'), _('Display external IP in the top bar'),
            settings, 'show-ip-in-panel'));

        panelGroup.add(this._makeSwitchRow(
            _('Show Country Flag'), _('Display country flag emoji'),
            settings, 'show-flag-in-panel'));

        panelGroup.add(this._makeSwitchRow(
            _('Show VPN Icon'), _('Display VPN or Tailscale status icon'),
            settings, 'show-vpn-icon-in-panel'));

        panelGroup.add(this._makeSwitchRow(
            _('Mask IP Address'), _('Replace last segments with asterisks'),
            settings, 'mask-ip'));

        panelGroup.add(this._makeSwitchRow(
            _('Highlight Packet Loss'), _('Color the indicator when the latency probe loses packets'),
            settings, 'alert-on-packet-loss'));

        // Notifications group
        const notifyGroup = new Adw.PreferencesGroup({
            title: _('Notifications'),
        });
        generalPage.add(notifyGroup);

        notifyGroup.add(this._makeSwitchRow(
            _('Public IP Changed'), _('Notify when the public IP address changes'),
            settings, 'notify-ip-change'));

        notifyGroup.add(this._makeSwitchRow(
            _('VPN Connected or Disconnected'), _('Notify when a VPN connection comes up or goes down'),
            settings, 'notify-vpn-change'));

        // Traffic group
        const trafficGroup = new Adw.PreferencesGroup({
            title: _('Live Traffic'),
        });
        generalPage.add(trafficGroup);

        const interfaces = this._listInterfaces();
        const current = settings.get_string('traffic-interface');
        if (current && !interfaces.includes(current))
            interfaces.push(current);

        const ifaceRow = new Adw.ComboRow({
            title: _('Interface'),
            subtitle: _('Interface measured by the traffic graph'),
        });
        const ifaceModel = new Gtk.StringList();
        ifaceModel.append(_('Automatic (primary connection)'));
        for (const iface of interfaces)
            ifaceModel.append(iface);
        ifaceRow.set_model(ifaceModel);
        ifaceRow.set_selected(current ? interfaces.indexOf(current) + 1 : 0);
        ifaceRow.connect('notify::selected', () => {
            const index = ifaceRow.get_selected();
            settings.set_string('traffic-interface', index === 0 ? '' : interfaces[index - 1]);
        });
        trafficGroup.add(ifaceRow);

        // Position group
        const positionGroup = new Adw.PreferencesGroup({
            title: _('Position'),
            description: _('Where the indicator appears in the panel'),
        });
        generalPage.add(positionGroup);

        const positionRow = new Adw.ComboRow({
            title: _('Panel Position'),
            subtitle: _('Left, center, or right side of the top bar'),
        });
        const positionModel = new Gtk.StringList();
        positionModel.append(_('Left'));
        positionModel.append(_('Center'));
        positionModel.append(_('Right'));
        positionRow.set_model(positionModel);

        const positionMap = {'left': 0, 'center': 1, 'right': 2};
        const positionValues = ['left', 'center', 'right'];
        positionRow.set_selected(positionMap[settings.get_string('position-in-panel')] ?? 2);
        positionRow.connect('notify::selected', () => {
            settings.set_string('position-in-panel', positionValues[positionRow.get_selected()]);
        });
        positionGroup.add(positionRow);

        const offsetRow = new Adw.SpinRow({
            title: _('Position Offset'),
            subtitle: _('Fine-tune placement within the chosen panel box'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 1,
                value: settings.get_int('position-in-panel-offset'),
            }),
        });
        settings.bind('position-in-panel-offset', offsetRow.get_adjustment(), 'value', Gio.SettingsBindFlags.DEFAULT);
        positionGroup.add(offsetRow);

        // Refresh group
        const refreshGroup = new Adw.PreferencesGroup({
            title: _('Refresh'),
        });
        generalPage.add(refreshGroup);

        const probeRow = new Adw.EntryRow({
            title: _('Latency Probe Host'),
            text: settings.get_string('probe-host'),
        });
        probeRow.connect('changed', () => {
            const host = probeRow.get_text().trim();
            if (host)
                settings.set_string('probe-host', host);
        });
        refreshGroup.add(probeRow);

        const refreshRow = new Adw.SpinRow({
            title: _('Refresh Interval'),
            subtitle: _('How often to check external IP (seconds)'),
            adjustment: new Gtk.Adjustment({
                lower: 60,
                upper: 3600,
                step_increment: 30,
                value: settings.get_int('refresh-interval'),
            }),
        });
        settings.bind('refresh-interval', refreshRow.get_adjustment(), 'value', Gio.SettingsBindFlags.DEFAULT);
        refreshGroup.add(refreshRow);
    }

    _listInterfaces() {
        try {
            const [, contents] = GLib.file_get_contents('/proc/net/dev');
            return new TextDecoder().decode(contents).split('\n')
                .map(line => line.split(':')[0].trim())
                .filter(name => name && name !== 'lo' && !name.startsWith('Inter') && !name.startsWith('face'))
                .sort();
        } catch (e) {
            console.error(`NetIdent: could not list interfaces: ${e}`);
            return [];
        }
    }

    _makeSwitchRow(title, subtitle, settings, key) {
        const row = new Adw.SwitchRow({title, subtitle});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }
}
