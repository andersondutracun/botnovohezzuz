import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs'
const base='./plugins/hezzuz-link/'
export type Pair={uuid:string;name:string;discordId:string;linkedAt:number}
export type LinkDB={links:Pair[];pending:{uuid:string;name:string;code:string;expires:number}[];unlinks:string[]}
const dbfile=base+'links.json'
const initial=():LinkDB=>({links:[],pending:[],unlinks:[]})
export function getLinkDB():LinkDB {
 try {const raw=JSON.parse(readFileSync(dbfile,'utf8'));return {links:Array.isArray(raw.links)?raw.links:[],pending:Array.isArray(raw.pending)?raw.pending:[],unlinks:Array.isArray(raw.unlinks)?raw.unlinks:[]}}
 catch(e){if((e as NodeJS.ErrnoException)?.code==='ENOENT')return initial();throw new Error('HEZZUZ Link: links.json ilegível; vinculações preservadas e operação interrompida: '+String(e))}
}
export function saveLinkDB(db:LinkDB){mkdirSync(base,{recursive:true});const f=dbfile+'.tmp';writeFileSync(f,JSON.stringify(db,null,2),{mode:0o600});renameSync(f,dbfile)}
export function scrub(db:LinkDB){db.pending=db.pending.filter(p=>typeof p.code==='string' && Number.isFinite(p.expires) && p.expires>Date.now());db.unlinks=db.unlinks.slice(-100)}
