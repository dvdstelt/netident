.PHONY: all clean install enable disable uninstall info schemas test zip logs

UUID = netident@compilesoftware.nl
SRC = src
DIST = dist
INSTALLBASE = $(HOME)/.local/share/gnome-shell/extensions
INSTALLDIR = $(INSTALLBASE)/$(UUID)

all: schemas

clean:
	rm -f $(SRC)/schemas/gschemas.compiled
	rm -rf $(DIST)/_build $(DIST)/$(UUID).zip

schemas: $(SRC)/schemas/gschemas.compiled

$(SRC)/schemas/gschemas.compiled: $(SRC)/schemas/org.gnome.shell.extensions.netident.gschema.xml
	glib-compile-schemas $(SRC)/schemas/

install: schemas
	rm -rf $(INSTALLDIR)
	mkdir -p $(INSTALLDIR)/schemas $(INSTALLDIR)/icons
	cp $(SRC)/metadata.json $(INSTALLDIR)/
	cp $(SRC)/*.js $(INSTALLDIR)/
	cp $(SRC)/stylesheet-dark.css $(SRC)/stylesheet-light.css $(INSTALLDIR)/
	cp $(SRC)/stylesheet-dark.css $(INSTALLDIR)/stylesheet.css
	cp $(SRC)/schemas/*.xml $(SRC)/schemas/gschemas.compiled $(INSTALLDIR)/schemas/
	cp -r $(SRC)/icons/* $(INSTALLDIR)/icons/
	@echo "Installed to $(INSTALLDIR)"
	@echo "Run 'make enable' to enable, then log out and back in to reload GNOME Shell"

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

uninstall: disable
	rm -rf $(INSTALLDIR)

info:
	gnome-extensions show $(UUID)

test: install enable
	@echo ""
	@echo "Installed and enabled. Log out and back in to reload, then run:"
	@echo "  make logs"

zip:
	@rm -rf $(DIST)/_build $(DIST)/$(UUID).zip
	@mkdir -p $(DIST)/_build/schemas $(DIST)/_build/icons
	cp $(SRC)/metadata.json $(DIST)/_build/
	cp $(SRC)/*.js $(DIST)/_build/
	cp $(SRC)/stylesheet-dark.css $(SRC)/stylesheet-light.css $(DIST)/_build/
	cp $(SRC)/stylesheet-dark.css $(DIST)/_build/stylesheet.css
	cp $(SRC)/schemas/*.xml $(DIST)/_build/schemas/
	cp -r $(SRC)/icons/* $(DIST)/_build/icons/
	cd $(DIST)/_build && zip -qr ../$(UUID).zip .
	@rm -rf $(DIST)/_build
	@echo "Created $(DIST)/$(UUID).zip"

logs:
	journalctl -b /usr/bin/gnome-shell --no-pager 2>/dev/null | grep -i "netident" | tail -30 || echo "No netident logs found"
