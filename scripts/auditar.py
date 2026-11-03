#!/usr/bin/env python3
"""Auditoria local somente leitura. Não exibe valores de configuração ou credenciais."""
import json,sys,re,pathlib,collections
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve()
plugins=root/'plugins'
problems=[]; reports=[]; names=collections.defaultdict(list)
for mod in sorted(plugins.iterdir()):
 if not mod.is_dir() or not (mod/'index.ts').exists():continue
 js=mod/'plugin.json'
 if not js.exists():problems.append(f'{mod.name}: plugin.json ausente');continue
 try: meta=json.loads(js.read_text())
 except Exception:problems.append(f'{mod.name}: plugin.json inválido');continue
 source=(mod/'index.ts').read_text()
 reports.append((mod.name, bool(meta.get('enabled',True)),len(source.splitlines())))
 for item in re.finditer(r'\.setName\([\'\"]([^\'\"]+)[\'\"]\)',source):
  names[item.group(1)].append(mod.name)
 for config in mod.glob('*.json'):
  try:json.loads(config.read_text())
  except Exception:problems.append(f'{mod.name}: {config.name} inválido')
 print(f'{mod.name}: configurado (ativo={meta.get("enabled",True)}), {len(source.splitlines())} linhas de TS')
print('\nTotal de módulos:',len(reports))
print('Arquivo .env presente:',(root/'.env').exists(),'(NÃO envie em ZIPs)')
print('Gitignore protege .env:', bool((root/'.gitignore').exists() and re.search(r'(?m)^\.env$',(root/'.gitignore').read_text())))
for k,mods in names.items():
 # Apenas alerta: subcomandos/opções aparecem aqui também.
 if len(set(mods))>1: pass
print('Dependências instaladas:',(root/'node_modules').exists())
print('Verificações:', 'OK' if not problems else '; '.join(problems))
print('NÃO comprova compilação, segurança financeira nem integração Minecraft.')
