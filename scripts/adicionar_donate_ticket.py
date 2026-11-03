#!/usr/bin/env python3
"""Insere a opção HEZZUZ Donate nas configurações existentes do Open Ticket.
Não substitui as categorias atuais. Faz backup antes de gravar.
"""
import json,sys,copy,shutil
from pathlib import Path
home=Path(sys.argv[1]) if len(sys.argv)>1 else Path('.')
base=home/'config'
paths={n:base/(n+'.json') for n in ('options','panels','questions')}
for name,path in paths.items():
    if not path.exists():raise SystemExit(f'Arquivo ausente: {path}')
    try:
        data=json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(data,list):raise ValueError('Esperava uma lista JSON')
    except Exception as e:raise SystemExit(f'Erro em {path}: {e}')
    paths[name]=(path,data)
opts=paths['options'][1];panels=paths['panels'][1];questions=paths['questions'][1]
if not panels:raise SystemExit('Não há painéis em config/panels.json')
if not any(x.get('id')=='donate' for x in opts):
    base_option=next((o for o in opts if o.get('id')=='financeiro'),None)
    if not base_option:raise SystemExit('Não encontrei opção financeiro para reutilizar permissões e categorias. Nenhuma alteração feita.')
    opt=copy.deepcopy(base_option)
    opt.update({'id':'donate','name':'PlayerPoints / Contribuições','description':'Contribua via Pix e receba PlayerPoints após confirmação oficial.','questions':['donate-nick']})
    opt['button']={'emoji':'💎','label':'PlayerPoints / Contribuições','color':'green'}
    opt['channel']['prefix']='Donate-'
    opt['ticketMessage']['enabled']=True
    opt['ticketMessage']['text']=''
    opt['ticketMessage']['embed']['title']='💎 HEZZUZ — Tesouro dos Reinos'
    opt['ticketMessage']['embed']['description']='Escolha o pacote no painel enviado pelo bot neste ticket. Vincule seu Minecraft antes de contribuir. Somente pagamentos confirmados geram PlayerPoints.'
    opts.append(opt)
if not any(q.get('id')=='donate-nick' for q in questions):
    questions.append({'id':'donate-nick','name':'Qual é seu nick no Minecraft?','type':'short','required':True,'placeholder':'Informe seu nickname (a conta deverá estar vinculada).','length':{'enabled':True,'min':3,'max':16}})
# Não altera painéis extras. Insere no primeiro painel de suporte, se necessário.
panel=next((p for p in panels if 'financeiro' in p.get('options',[])),panels[0]);panel.setdefault('options',[])
if 'donate' not in panel['options']:panel['options'].append('donate')
for name,(path,data) in paths.items():
    backup=path.with_suffix(path.suffix+'.before-donate.bak')
    if not backup.exists():shutil.copy2(path,backup)
    tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    tmp.replace(path)
print('Opção Donate adicionada/confirmada sem remover opções existentes.')
print('Backups *.before-donate.bak criados na pasta config/.')
print('Atualize/republique o painel pelo Open Ticket para mostrar o botão.')
