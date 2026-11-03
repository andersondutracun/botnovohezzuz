#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
stamp=$(date -u +%Y%m%d-%H%M%S)
archive="backups/hezzuz-before-v5-${stamp}.tar.gz"
# Backup local sensível; não enviar arquivo para terceiros.
tar -czf "$archive" --exclude='plugins/*/config.json' --exclude='plugins/*/.env' plugins/hezzuz-donate/orders.json plugins/hezzuz-economy-games/economy.json database config 2>/dev/null || { echo 'Falha no backup; verifique caminhos'; exit 1; }
chmod 600 "$archive"
echo "Backup local criado: $archive (contém dados privados; mantenha protegido)"
