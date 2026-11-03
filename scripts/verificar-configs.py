#!/usr/bin/env python3
import json,pathlib,sys
base=pathlib.Path(__file__).resolve().parents[1]
errors=0
for f in sorted((base/'plugins').glob('hezzuz-*/config.json')):
 try:
  d=json.loads(f.read_text());print('OK',f.relative_to(base),'enabled='+str(d.get('enabled')))
 except Exception as exc:errors+=1;print('ERRO',f,exc)
sys.exit(bool(errors))
