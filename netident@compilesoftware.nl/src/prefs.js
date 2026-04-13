import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
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
            _('Show IP Address'), _('Display external IP in the top bar'),
            settings, 'show-ip-in-panel'));

        panelGroup.add(this._makeSwitchRow(
            _('Show Country Flag'), _('Display country flag emoji'),
            settings, 'show-flag-in-panel'));

        panelGroup.add(this._makeSwitchRow(
            _('Show VPN Icon'), _('Display VPN status icon'),
            settings, 'show-vpn-icon-in-panel'));

        panelGroup.add(this._makeSwitchRow(
            _('Mask IP Address'), _('Replace last segments with asterisks'),
            settings, 'mask-ip'));

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

    _makeSwitchRow(title, subtitle, settings, key) {
        const row = new Adw.SwitchRow({title, subtitle});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }
}
