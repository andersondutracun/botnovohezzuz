#!/usr/bin/env bash
set -euo pipefail
if [ ! -d plugins ] || [ ! -f package.json ];then echo 'Execute na raiz do bot';exit 1;fi
src="$(cd "$(dirname "$0")/.." && pwd)"
[ "$src" != "$(pwd)" ] || { echo 'Extraia o pacote fora do projeto';exit 1; }
mkdir -p plugins/hezzuz-minecraft plugins/hezzuz-network-manager
cp "$src/plugins/hezzuz-minecraft/index.ts" plugins/hezzuz-minecraft/index.ts
for f in index.ts plugin.json;do cp "$src/plugins/hezzuz-network-manager/$f" "plugins/hezzuz-network-manager/$f";done
if [ ! -f plugins/hezzuz-network-manager/config.json ];then cp "$src/plugins/hezzuz-network-manager/config.json" plugins/hezzuz-network-manager/config.json;fi
cp "$src/scripts/hezzuz5_preflight.py" scripts/hezzuz5_preflight.py
printf '%s\n' 'Instalado. Configure guildId e enabled no network-manager. NÃO alteramos dados persistentes.'
