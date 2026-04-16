.PHONY: all clean install enable disable uninstall schemas test zip release

UUID = netident@compilesoftware.nl
INSTALLBASE = $(HOME)/.local/share/gnome-shell/extensions

all: schemas

clean:
	rm -f ./schemas/gschemas.compiled

schemas: ./schemas/gschemas.compiled

./schemas/gschemas.compiled: ./schemas/org.gnome.shell.extensions.netident.gschema.xml
	glib-compile-schemas ./schemas/

install: schemas
	rm -rf $(INSTALLBASE)/$(UUID)
	mkdir -p $(INSTALLBASE)/$(UUID)/schemas
	mkdir -p $(INSTALLBASE)/$(UUID)/icons
	cp metadata.json $(INSTALLBASE)/$(UUID)/
	cp src/*.js $(INSTALLBASE)/$(UUID)/
	cp src/stylesheet.css $(INSTALLBASE)/$(UUID)/
	cp schemas/*.xml $(INSTALLBASE)/$(UUID)/schemas/
	cp schemas/gschemas.compiled $(INSTALLBASE)/$(UUID)/schemas/
	test -d icons && cp -r icons/* $(INSTALLBASE)/$(UUID)/icons/ || true
	@echo "Installed to $(INSTALLBASE)/$(UUID)"
	@echo "Run 'make enable' to enable, then restart GNOME Shell (log out/in on Wayland)"

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

uninstall: disable
	rm -rf $(INSTALLBASE)/$(UUID)

info:
	gnome-extensions show $(UUID)

test: install enable
	@echo ""
	@echo "Installed and enabled. Log out and back in to reload, then run:"
	@echo "  make logs"

zip:
	@rm -rf _build $(UUID).zip
	@mkdir -p _build/schemas _build/icons
	cp metadata.json _build/
	cp src/*.js _build/
	cp src/stylesheet.css _build/
	cp schemas/*.xml _build/schemas/
	test -d icons && cp -r icons/* _build/icons/ || true
	cd _build && zip -qr ../$(UUID).zip .
	@rm -rf _build
	@echo "Created $(UUID).zip"

release:
	@CURRENT=$$(grep '"version":' metadata.json | head -1 | sed 's/[^0-9]//g'); \
	NEXT=$$((CURRENT + 1)); \
	sed -i "s/\"version\": $$CURRENT/\"version\": $$NEXT/" metadata.json; \
	echo "Bumped version $$CURRENT -> $$NEXT"; \
	$(MAKE) zip

logs:
	journalctl -b /usr/bin/gnome-shell --no-pager 2>/dev/null | grep -i "netident\|NetIdent" | tail -30 || echo "No netident logs found"
