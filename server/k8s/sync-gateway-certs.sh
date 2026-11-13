#!/usr/bin/env bash
# Run on lyc-server after renewing the three existing certificate files.
set -euo pipefail
umask 077

if command -v kubectl >/dev/null 2>&1; then
  kubectl_cmd=(kubectl)
else
  kubectl_cmd=(k3s kubectl)
fi

for item in \
  'gateway-api-tls aaa.imlyc.cn' \
  'gateway-blog-tls imlyc.cn' \
  'gateway-ssl-tls ssl.imlyc.cn'; do
  read -r secret_name domain <<< "$item"
  cert="/data/software/compose/nginx/ssl/$domain/${domain}_bundle.pem"
  key="/data/software/compose/nginx/ssl/$domain/$domain.key"
  [[ -f "$cert" && -f "$key" ]] || {
    echo "Missing certificate or key for $domain" >&2
    exit 1
  }
  "${kubectl_cmd[@]}" -n kube-system create secret tls "$secret_name" \
    --cert="$cert" --key="$key" --dry-run=client -o yaml | \
    "${kubectl_cmd[@]}" apply -f -
done
