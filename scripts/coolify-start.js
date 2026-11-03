// HEZZUZ Coolify bootstrap (no Discloud dependencies)
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const state = '/data';
// Minimal safe defaults for files excluded by .gitignore in a fresh clone.
const pluginDefaults = {
  'hezzuz-ai-support/config.json': {enabled:false},
  'hezzuz-donate/config.json': {enabled:false},
  'hezzuz-link/config.json': {enabled:false},
  'hezzuz-vipsync/config.json': {enabled:false},
};
const pluginRuntimeDefaults = {
  'hezzuz-ai-support/data.json': {},
  'hezzuz-contador/data.json': {},
  'hezzuz-eventos/data.json': {},
  'hezzuz-minecraft/data.json': {},
  'hezzuz-moderacao/history.json': {},
  'hezzuz-moderacao/warnings.json': {},
  'hezzuz-sorteios/data.json': {},
  'hezzuz-donate/orders.json': {},
  'hezzuz-donate/mp-sandbox-orders.json': {},
  'hezzuz-link/links.json': {},
  'hezzuz-link/panel-state.json': {},
  'hezzuz-economy-games/economy.json': {},
};
const copyMissing = (from, to) => {
  fs.mkdirSync(path.dirname(to), {recursive:true});
  if (!fs.existsSync(to)) fs.copyFileSync(from, to);
};
const linkFile = (source, persistent) => {
  copyMissing(source,persistent);
  fs.rmSync(source);
  fs.symlinkSync(persistent,source);
};
function persistDirectory(name) {
  const source = path.join(root,name);
  const target = path.join(state,name);
  fs.mkdirSync(target,{recursive:true});
  fs.mkdirSync(source,{recursive:true});
  if(name==='database') {
    for(const n of ['global','options','stats','tickets','users']) {
      const file=path.join(target,n+'.json');
      if(!fs.existsSync(file))fs.writeFileSync(file,'[]\n');
    }
  }
  for(const file of fs.readdirSync(source)) {
    const f=path.join(source,file);
    if(fs.statSync(f).isFile())copyMissing(f,path.join(target,file));
  }
  fs.rmSync(source,{recursive:true,force:true});
  fs.symlinkSync(target,source,'dir');
}
fs.mkdirSync(state,{recursive:true});
persistDirectory('database');
persistDirectory('config');
// Store mutable plugin JSON on persistent storage; plugin.json remains version-controlled.
const plugins=path.join(root,'plugins');
for(const name of fs.readdirSync(plugins)) {
  const folder=path.join(plugins,name);
  if (!fs.statSync(folder).isDirectory())continue;
  for(const [rel,defaults] of Object.entries({...pluginDefaults,...pluginRuntimeDefaults})) {
    if(!rel.startsWith(name+'/'))continue;
    const file=rel.substring(name.length+1);
    const local=path.join(folder,file);
    const target=path.join(state,'plugins',name,file);
    if(!fs.existsSync(local) && !fs.existsSync(target)) {
      fs.writeFileSync(local,JSON.stringify(defaults,null,2)+'\n');
    } else if (!fs.existsSync(local) && fs.existsSync(target)) {
      fs.writeFileSync(local,'{}\n'); // replaced by persistent file immediately below
    }
  }
  for(const file of fs.readdirSync(folder)) {
    if (!file.endsWith('.json') || file==='plugin.json' || file.endsWith('.example.json') || file.startsWith('EXEMPLO-'))continue;
    linkFile(path.join(folder,file),path.join(state,'plugins',name,file));
  }
}
console.log('[HEZZUZ] Coolify: configs e dados persistentes em /data, codigo dos plugins atualizado pela imagem.');
require(path.join(root,'index.js'));
