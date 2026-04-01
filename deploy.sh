#!/usr/bin/env bash
# deploy.sh — push local plugin changes into the running NetBox container
set -e

CONTAINER="netbox-stack-netbox-1"
SRC="$(cd "$(dirname "$0")" && pwd)/netbox_devicelayout"
DEST="/opt/netbox/venv/lib/python3.12/site-packages/netbox_devicelayout"

echo "Copying files..."

# Copy each file individually so existing files are always overwritten
find "$SRC" -type f | while read -r file; do
  rel="${file#$SRC/}"
  dest_file="$DEST/$rel"
  dest_dir=$(dirname "$dest_file")
  docker exec -u root "$CONTAINER" mkdir -p "$dest_dir" 2>/dev/null || true
  docker cp "$file" "$CONTAINER:$dest_file"
done

echo "Collecting static files..."
docker exec -u root "$CONTAINER" sh -c \
  "cd /opt/netbox && python netbox/manage.py collectstatic --no-input --clear 2>&1 | tail -3"

echo "Done."
