#!/bin/sh
# Build the Basic Auth include for nginx from env at container start.
# DOCS_PASSWORD set  -> require auth (user defaults to "admin").
# DOCS_PASSWORD unset -> public, empty include.
set -eu

auth_conf="/etc/nginx/auth.conf"
htpasswd_file="/etc/nginx/.htpasswd"
docs_user="${DOCS_USER:-admin}"
docs_realm="${DOCS_REALM:-zeropdf docs}"

if [ -n "${DOCS_PASSWORD:-}" ]; then
  htpasswd -bc "$htpasswd_file" "$docs_user" "$DOCS_PASSWORD" >/dev/null 2>&1
  {
    printf 'auth_basic "%s";\n' "$docs_realm"
    printf 'auth_basic_user_file %s;\n' "$htpasswd_file"
  } > "$auth_conf"
else
  : > "$auth_conf"
fi

exec nginx -g 'daemon off;'
