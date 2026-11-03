#!/usr/bin/env python3
"""Inventário LOCAL sem mudanças e sem divulgar configurações/segredos."""
import json, re, sys, pathlib, collections, datetime
root = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv)>1 else pathlib.Path.cwd().resolve()
plugins = root/'plugins'
if not plugins.is_dir():
 print('ERRO: execute na raiz do Open Ticket ou passe o caminho como argumento.'); sys.exit(2)
out = []
def line(t=''):out.append(t)
line('# HEZZUZ 5.0 — Inventário de auditoria (sem valores de configuração)')
line('Gerado em UTC: '+datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M'))
line('Projeto: '+root.name)
line('**Somente leitura. Não testa credenciais, não altera arquivos e não realiza pagamentos.**\n')
paths=sorted(p for p in plugins.iterdir() if p.is_dir())
line('## Módulos detectados ('+str(len(paths))+')')
for p in paths:
 meta={}
 try:meta=json.loads((p/'plugin.json').read_text('utf-8'))
 except Exception: pass
 has_index=(p/'index.ts').exists()
 line('- '+p.name+' | index.ts: '+('sim' if has_index else 'não')+' | plugin.json: '+('sim' if (p/'plugin.json').is_file() else 'não'))
line('\n## Verificações de arquivos (sem exibir conteúdo)')
for key in ('hezzuz-donate','hezzuz-link','hezzuz-vipsync','hezzuz-economy-games','hezzuz-ai-support'):
 p=plugins/key
 if p.exists():
  cfg=p/'config.json';line('- '+key+': config '+('presente' if cfg.is_file() else 'ausente'))
  if cfg.is_file():
   try: json.loads(cfg.read_text('utf-8'));line('  - JSON: válido')
   except Exception as e: line('  - JSON: inválido ('+type(e).__name__+')')
  for fn in ('orders.json','economy.json'):
   if (p/fn).is_file():line('  - '+fn+': presente (fazer backup antes de atualizar)')
line('\n## Comandos slash encontrados por inspeção estática (pode haver falsos positivos)')
command_re=re.compile(r"\.setName\(\s*['\"]([a-z0-9_-]{1,32})['\"]\s*\)")
commands=collections.defaultdict(list)
for p in paths:
 f=p/'index.ts'
 if not f.is_file():continue
 try:s=f.read_text('utf-8')
 except:continue
 for m in set(command_re.findall(s)):commands[m].append(p.name)
for k,v in sorted(commands.items()):line('- /'+k+': '+', '.join(v))
line('\n## Possíveis nomes duplicados (revisão manual)')
repeated={k:v for k,v in commands.items() if len(v)>1}
for k,v in sorted(repeated.items()):line('- '+k+': '+', '.join(v))
if not repeated:line('- Nenhum nome duplicado detectado pelo padrão simples.')
line('\n## Checklist de homologação')
for s in ['Backup de banco e arquivos persistentes restaurável','Compilação npm start sem erro TS','Pix real: criação, validação, entrega única, estorno e reinício','VIP Sync: promoção, expiração, cargos preservados','Link: vincular/desvincular e autorização','Economy: concorrência, limites, restauração','Games: botões, partidas simultâneas, canais','ChatBridge: anti-loop, rate limit, nChat e permissões','Network Manager: somente leitura, perdas de conexão','Sentinel: alertas sem punições automáticas','Observabilidade: logs sem segredos, alertas e healthcheck']:
 line('- [ ] '+s)
result='\n'.join(out)+'\n'
output=root/'HEZZUZ-5.0-INVENTARIO.md'
output.write_text(result,'utf-8')
print('Inventário gerado:',output)
print('Módulos:',len(paths),'| Comandos detectados:',len(commands),'| Potenciais duplicações:',len(repeated))
print('NÃO anexe config.json, .env ou arquivos de token em relatórios públicos.')
