import { api, opendiscord } from '#opendiscord'
import { EmbedBuilder, ChannelType, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js'
import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import {getLinkDB,saveLinkDB} from '../hezzuz-link/storage'

const base = './plugins/hezzuz-minecraft/'
type ServerEntry = {id:string;name:string;online:boolean;players:number}
type Report = {total:number;servers:ServerEntry[];time:number}
type Config = {enabled:boolean;guildId:string;channelId:string;listenHost:string;listenPort:number;bridgeToken:string;refreshSeconds:number;staleSeconds:number;servers:{id:string;name:string}[]}
const readState=()=>{try{return JSON.parse(readFileSync(base+'data.json','utf8'))}catch{return {}}}
const saveState=(state:any)=>{const tmp=base+'data.json.tmp';writeFileSync(tmp,JSON.stringify(state,null,2),{mode:0o600});renameSync(tmp,base+'data.json')}
const saveSnapshot=(report:Report)=>{const path=base+'telemetry.json',tmp=path+'.tmp';writeFileSync(tmp,JSON.stringify(report),{mode:0o600});renameSync(tmp,path)}
const safeToken=(received:string,expected:string)=>{const a=Buffer.from(received);const b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b)}

opendiscord.events.get('onConfigLoad').listen(manager=>{manager.add(new api.ODJsonConfig('hezzuz-minecraft:config','config.json',base))})
opendiscord.events.get('afterClientReady').listen(async()=>{
 const cfg=opendiscord.configs.get('hezzuz-minecraft:config')?.data as Config|undefined
 if(!cfg?.enabled)return
 // Prefer a secret supplied by Coolify; keep JSON fallback for local installations.
 cfg.bridgeToken=process.env.HEZZUZ_BRIDGE_TOKEN?.trim() || cfg.bridgeToken
 if(!cfg.bridgeToken||cfg.bridgeToken.startsWith('SUBSTITUA_')||!cfg.channelId||cfg.channelId.startsWith('COLOQUE_')){opendiscord.log('Minecraft Bridge: preencha token e channelId no config.json','warning');return}
 const guild=await opendiscord.client.client.guilds.fetch(cfg.guildId).catch(()=>null)
 if(!guild){opendiscord.log('Minecraft Bridge: servidor Discord não encontrado','warning');return}
 const state=readState();let last:Report|null=null;let updatedAt=0;let rendering=false
 const lines=()=>{
  const stale=!last||Date.now()-updatedAt>(cfg.staleSeconds||180)*1000
  const servers=cfg.servers.map(s=>{const status=last?.servers.find(x=>x.id===s.id);return stale||!status?`⚪ **${s.name}** — sem informação`:status.online?`🟢 **${s.name}** — ${status.players} jogador(es)`:`🔴 **${s.name}** — offline`})
  return [...servers,'',stale?'⚠️ Dados temporariamente indisponíveis':`👥 **Total da rede: ${last?.total||0} jogador(es)**`].join('\n')
 }
 const publish=async()=>{
  if(rendering)return;rendering=true
  try{
   const ch=await guild.channels.fetch(cfg.channelId).catch(()=>null)
   if(!ch||ch.type!==ChannelType.GuildText){opendiscord.log('Minecraft Bridge: canal de texto inválido','warning');return}
   const embed=new EmbedBuilder().setTitle('⚔️ REDE HEZZUZ — STATUS DOS REINOS').setDescription(lines()).setColor(last&&Date.now()-updatedAt<=(cfg.staleSeconds||180)*1000?0x49a76f:0x808080).setFooter({text:'Atualização automática via Velocity'}).setTimestamp()
   let msg:any=null
   if(state.messageId)msg=await ch.messages.fetch(state.messageId).catch(()=>null)
   if(msg)await msg.edit({embeds:[embed],allowedMentions:{parse:[]}})
   else {msg=await ch.send({embeds:[embed],allowedMentions:{parse:[]}});state.messageId=msg.id;saveState(state)}
  }catch(err){opendiscord.log('Minecraft Bridge painel: '+String(err),'error')}finally{rendering=false}
 }
 const cmd=new SlashCommandBuilder().setName('minecrafthezzuz').setDescription('Consulta os jogadores e os reinos da HEZZUZ')
 try{const cmds=await guild.commands.fetch();const old=cmds.find(x=>x.name==='minecrafthezzuz');if(old)await old.edit(cmd.toJSON() as any);else await guild.commands.create(cmd.toJSON() as any)}catch(err){opendiscord.log('Minecraft Bridge comando: '+String(err),'error')}
 opendiscord.client.client.on('interactionCreate',async i=>{if(!i.isChatInputCommand()||i.guildId!==cfg.guildId||i.commandName!=='minecrafthezzuz')return;await i.reply({content:lines(),ephemeral:true,allowedMentions:{parse:[]}}).catch(()=>{})})
 const server=createServer((req,res)=>{
  if(req.method!=='POST'||req.url!=='/bridge/report'){res.writeHead(404);res.end();return}
  if(!safeToken(String(req.headers['x-hezzuz-token']||''),cfg.bridgeToken)){res.writeHead(401);res.end();return}
  let body='';let rejected=false
  req.on('data',chunk=>{body+=chunk.toString();if(body.length>16384){rejected=true;req.destroy()}})
  req.on('end',()=>{
   if(rejected)return
   try{const parsed=JSON.parse(body);if(!Array.isArray(parsed.servers)||!Number.isInteger(parsed.total)||parsed.total<0)throw Error('payload invalido')
    const servers:ServerEntry[]=parsed.servers.filter((s:any)=>typeof s.id==='string'&&typeof s.online==='boolean'&&Number.isInteger(s.players)&&s.players>=0).map((s:any)=>({id:s.id,name:String(s.name||s.id),online:s.online,players:s.players})).slice(0,30)
    last={total:parsed.total,servers,time:Date.now()};updatedAt=Date.now();saveSnapshot(last);const db=getLinkDB()
    const now=Date.now()
    db.pending=db.pending.filter(p=>p.expires>now)
    if(Array.isArray(parsed.pending))for(const entry of parsed.pending.slice(0,200)){
     if(typeof entry.uuid!=='string'||!/^[0-9a-fA-F-]{32,36}$/.test(entry.uuid)||typeof entry.name!=='string'||entry.name.length>32||typeof entry.code!=='string'||!/^[A-Z2-9]{8}$/.test(entry.code)||!Number.isFinite(entry.expires)||entry.expires<=now||entry.expires>now+300000)continue
     if(db.links.some(p=>p.uuid===entry.uuid))continue
     // Keep the first unexpired code for a UUID, never overwrite an existing proof.
     if(!db.pending.some(p=>p.uuid===entry.uuid||p.code===entry.code))db.pending.push({uuid:entry.uuid,name:entry.name,code:entry.code,expires:entry.expires})
    }
    // Request unlink only for the authenticated UUID whose in-game command sent it.
    if(Array.isArray(parsed.unlinks))for(const uuid of parsed.unlinks.slice(0,100))if(typeof uuid==='string'&&/^[0-9a-fA-F-]{32,36}$/.test(uuid)){db.links=db.links.filter(p=>p.uuid!==uuid);db.pending=db.pending.filter(p=>p.uuid!==uuid)}
    saveLinkDB(db)
    const linked=Array.isArray(parsed.onlineUuids)?parsed.onlineUuids.slice(0,500).filter((x:any)=>typeof x==='string').map((uuid:string)=>{const pair=db.links.find(p=>p.uuid===uuid);return pair?{uuid,discordId:pair.discordId}:null}).filter(Boolean):[]
    const reply=JSON.stringify({linked})
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(reply);void publish()
   }catch{res.writeHead(400);res.end()}
  })
 })
 server.on('error',err=>opendiscord.log('Minecraft Bridge HTTP: '+String(err),'error'))
 server.listen(cfg.listenPort,cfg.listenHost,()=>opendiscord.log(`Minecraft Bridge ouvindo em ${cfg.listenHost}:${cfg.listenPort}`,'info'))
 setInterval(()=>{void publish()},Math.max(30,cfg.refreshSeconds||60)*1000).unref()
 void publish()
})
