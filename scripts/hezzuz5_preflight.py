#!/usr/bin/env python3
from pathlib import Path
import json,subprocess,sys
p=Path.cwd();errs=[]
for d in sorted((p/'plugins').glob('hezzuz-*')):
 if not d.is_dir():continue
 for filename in ('plugin.json','config.json'):
  f=d/filename
  if f.exists():
   try:json.loads(f.read_text())
   except Exception as e:errs.append(f'{d.name}/{filename}: JSON inválido ({type(e).__name__})')
print('Módulos HEZZUZ:',sum(1 for d in (p/'plugins').glob('hezzuz-*') if d.is_dir()))
for f in ['plugins/hezzuz-donate/orders.json','plugins/hezzuz-economy-games/economy.json','plugins/hezzuz-link/data.json']:
 path=p/f
 print(('PRESENTE' if path.exists() else 'AUSENTE'),f)
if not (p/'node_modules/.bin/tsc').exists():print('AVISO: compilador TypeScript local ausente; use npm ci antes de npm run build.')
print('Erros:',len(errs));print('\n'.join(errs));sys.exit(bool(errs))
