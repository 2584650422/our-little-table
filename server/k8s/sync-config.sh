#!/usr/bin/env bash
# Run on the K3s server as a user allowed to use kubectl. Never print .env values.
set -euo pipefail
umask 077

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 /path/to/server/.env MYSQL_HOST MYSQL_PORT" >&2
  exit 2
fi

source_file=$1
mysql_host=$2
mysql_port=$3
namespace=homelab
[[ -f "$source_file" && -n "$mysql_host" && "$mysql_port" =~ ^[0-9]+$ ]] || exit 2

if command -v kubectl >/dev/null 2>&1; then
  kubectl_cmd=(kubectl)
else
  kubectl_cmd=(k3s kubectl)
fi

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

python3 - "$source_file" "$workdir/secrets.env" "$workdir/config.env" <<'PY'
import re
import shlex
import sys

secret_keys = {
    "JWT_SECRET", "MYSQL_PASSWORD", "WECHAT_APP_SECRET", "COS_SECRET_ID",
    "COS_SECRET_KEY", "WECHAT_ORDER_TEMPLATE_ID", "WECHAT_SERVED_TEMPLATE_ID", "WECHAT_THOUGHT_TEMPLATE_ID",
}
config_keys = {
    "JWT_EXPIRES_IN", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_CONNECT_TIMEOUT_MS",
    "WECHAT_APP_ID", "WECHAT_ORDER_PAGE", "WECHAT_THOUGHT_USER_KEY", "WECHAT_THOUGHT_MESSAGE_KEY", "WECHAT_TEMPLATE_USER_KEY",
    "WECHAT_TEMPLATE_DISH_KEY", "WECHAT_TEMPLATE_MESSAGE_KEY",
    "WECHAT_SERVED_USER_KEY", "WECHAT_SERVED_DISH_NAME_KEY", "COS_BUCKET",
    "COS_REGION", "COS_BASE_URL", "COS_UPLOAD_MAX_MB", "COS_KEY_PREFIX",
    "COS_SIGNED_URL_EXPIRES_SECONDS", "LOG_LEVEL", "LOG_FORMAT",
}
with open(sys.argv[1], encoding="utf-8") as source, \
     open(sys.argv[2], "w", encoding="utf-8") as secrets, \
     open(sys.argv[3], "w", encoding="utf-8") as config:
    for line in source:
        tokens = shlex.split(line, comments=True)
        if len(tokens) != 1 or "=" not in tokens[0]:
            continue
        key, value = tokens[0].split("=", 1)
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        if key in secret_keys:
            secrets.write(f"{key}={value}\n")
        elif key in config_keys:
            config.write(f"{key}={value}\n")
PY

for key in JWT_SECRET MYSQL_PASSWORD WECHAT_APP_SECRET; do
  if ! grep -q "^${key}=." "$workdir/secrets.env"; then
    echo "Missing required value: $key" >&2
    exit 1
  fi
done

cat >> "$workdir/config.env" <<EOF
APP_ENV=production
NODE_ENV=production
DEV_LOGIN_ENABLED=false
PORT=3000
TZ=Asia/Shanghai
MYSQL_HOST=$mysql_host
MYSQL_PORT=$mysql_port
EOF

"${kubectl_cmd[@]}" -n "$namespace" create secret generic our-time-secrets \
  --from-env-file="$workdir/secrets.env" --dry-run=client -o yaml | \
  "${kubectl_cmd[@]}" -n "$namespace" apply -f -
"${kubectl_cmd[@]}" -n "$namespace" create configmap our-time-config \
  --from-env-file="$workdir/config.env" --dry-run=client -o yaml | \
  "${kubectl_cmd[@]}" -n "$namespace" apply -f -

if "${kubectl_cmd[@]}" -n "$namespace" get deployment our-time-api >/dev/null 2>&1; then
  "${kubectl_cmd[@]}" -n "$namespace" rollout restart deployment/our-time-api
  "${kubectl_cmd[@]}" -n "$namespace" rollout status deployment/our-time-api --timeout=120s
fi
