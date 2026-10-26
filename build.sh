#!/usr/bin/env bash
# Build the NetIdent extension zip, with an optional version bump.
#
# Usage:
#   ./build.sh            Build dist/netident@compilesoftware.nl.zip with the current version
#   ./build.sh patch      Bump the patch version (3.1.0 -> 3.1.1), then build
#   ./build.sh minor      Bump the minor version (3.1.1 -> 3.2.0), then build
#   ./build.sh major      Bump the major version (3.2.0 -> 4.0.0), then build
#
# The SemVer string lives in "version-name" in src/metadata.json. GNOME
# extensions also need an integer "version" that grows by one on every
# release, so a bump increments both.

set -euo pipefail

cd "$(dirname "$0")"

METADATA=src/metadata.json
BUMP="${1:-}"

usage() {
    echo "Usage: $0 [major|minor|patch]" >&2
    exit 1
}

case "$BUMP" in
    ''|major|minor|patch) ;;
    -h|--help) usage ;;
    *) echo "Unknown argument: $BUMP" >&2; usage ;;
esac

for tool in python3 zip glib-compile-schemas; do
    if ! command -v "$tool" >/dev/null; then
        echo "Missing tool: $tool" >&2
        exit 1
    fi
done

if [ -n "$BUMP" ]; then
    python3 - "$METADATA" "$BUMP" <<'EOF'
import json, re, sys

path, bump = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)

match = re.fullmatch(r'(\d+)\.(\d+)(?:\.(\d+))?', data.get('version-name', '0.0.0'))
if not match:
    sys.exit(f'version-name {data.get("version-name")!r} is not a SemVer version')

major, minor, patch = (int(part or 0) for part in match.groups())
old = f'{major}.{minor}.{patch}'

if bump == 'major':
    major, minor, patch = major + 1, 0, 0
elif bump == 'minor':
    minor, patch = minor + 1, 0
else:
    patch += 1

data['version-name'] = f'{major}.{minor}.{patch}'
data['version'] = int(data.get('version', 0)) + 1

with open(path, 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')

print(f'Version {old} -> {data["version-name"]} (GNOME version {data["version"]})')
EOF
fi

make zip

VERSION_NAME=$(python3 -c "import json; print(json.load(open('$METADATA'))['version-name'])")
echo "Built dist/netident@compilesoftware.nl.zip for version $VERSION_NAME"
echo "Upload it at https://extensions.gnome.org/upload/"
