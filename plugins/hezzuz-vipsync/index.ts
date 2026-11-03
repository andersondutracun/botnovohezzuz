import {api,opendiscord} from '#opendiscord'
import {PermissionFlagsBits,SlashCommandBuilder} from 'discord.js'
import {getLinkDB} from '../hezzuz-link/storage'
import mysql from 'mysql2/promise'

const root='./plugins/hezzuz-vipsync/'
type Config={enabled:boolean;guildId:string;syncEnabled:boolean;intervalMinutes?:number;intervalSeconds?:number;syncOnStartup?:boolean;mysql:{host:string;port:number;user:string;password:string;database:string;tablePrefix:string;ssl:boolean};roles:Record<string,string>;linkedRoleId?:string}
type Status={uuid:string;name:string;discordId:string;group:string|null;reason:string;roleId:string|null}
const validUuid=(v:string)=>/^[0-9a-f]{32}$/i.test(v.replace(/-/g,''))
const priority=['mega+','mega','vip+','vip']
const normalize=(s:string)=>s.replace(/-/g,'').toLowerCase()
const sqlIdent=(s:string)=>{if(!/^[a-zA-Z0-9_]+$/.test(s))throw Error('Prefixo de tabela inválido');return '`'+s+'`'}
const sleep=(n:number)=>new Promise(r=>setTimeout(r,n))

opendiscord.events.get('onConfigLoad').listen(manager=>{manager.add(new api.ODJsonConfig('hezzuz-vipsync:config','config.json',root))})
opendiscord.events.get('afterClientReady').listen(async()=>{
 const cfg=opendiscord.configs.get('hezzuz-vipsync:config')?.data as Config|undefined
 if(!cfg?.enabled)return
 const client=opendiscord.client.client
 const guild=await client.guilds.fetch(cfg.guildId).catch(()=>null)
 if(!guild){console.error('[HEZZUZ VIP Sync] Servidor Discord não encontrado.');return}
 const map=cfg.roles||{}
 const roleIds=priority.map(x=>String(map[x]||'')).filter(Boolean)
 if(roleIds.length!==4||new Set(roleIds).size!==4){console.error('[HEZZUZ VIP Sync] Configure os quatro IDs distintos de cargos antes de iniciar.');return}
 const prefix=String(cfg.mysql?.tablePrefix||'luckperms_')
 const players=sqlIdent(prefix+'players'),perms=sqlIdent(prefix+'user_permissions')
 let active=false
 const pool=mysql.createPool({host:cfg.mysql.host,port:Number(cfg.mysql.port)||3306,user:cfg.mysql.user,password:cfg.mysql.password,database:cfg.mysql.database,waitForConnections:true,connectionLimit:2,connectTimeout:10000,ssl:cfg.mysql.ssl?{}:undefined})
 const query=async(link:{uuid:string;name:string;discordId:string}):Promise<Status>=>{
  const uuid=normalize(link.uuid)
  if(!validUuid(uuid))return {...link,group:null,roleId:null,reason:'UUID inválido'}
  // Nunca inferir VIP por permissões globais. Apenas memberships diretamente associadas ao jogador.
  const [rows]=await pool.query<any[]>(`SELECT permission, value, server, world, expiry, contexts FROM ${perms} WHERE REPLACE(LOWER(uuid),'-','')=? AND permission IN ('group.vip','group.vip+','group.mega','group.mega+')`,[uuid])
  const now=Math.floor(Date.now()/1000)
  const allowed=new Set<string>()
  for(const r of rows){
   const group=String(r.permission||'').slice(6).toLowerCase()
   // Conservador: apenas grupo global, sem contexto de servidor/mundo, sem expiração vencida.
   if(!priority.includes(group)||Number(r.value)!==1)continue
   if(String(r.server||'global').toLowerCase()!=='global'||String(r.world||'global').toLowerCase()!=='global')continue
   if(Number(r.expiry||0)>0&&Number(r.expiry)<now)continue
   const cx=r.contexts
   if(cx!==null&&cx!==undefined&&String(cx).trim()!==''&&String(cx).trim()!=='[]'&&String(cx).trim()!=='{}')continue
   allowed.add(group)
  }
  const group=priority.find(g=>allowed.has(g))||null
  return {...link,group,roleId:group?map[group]:null,reason:group?'Grupo global ativo':'Nenhum grupo VIP global direto ativo'}
 }
 const check=async()=>{
  const [rows]=await pool.query<any[]>(`SHOW COLUMNS FROM ${perms}`)
  const cols=new Set(rows.map(r=>r.Field))
  for(const n of ['uuid','permission','value','server','world','expiry','contexts'])if(!cols.has(n))throw Error(`A tabela ${prefix}user_permissions não possui a coluna ${n}. Envie apenas os nomes das colunas para adaptação.`)
  // Verifica também que a tabela players existe; não é usada para obter membership.
  await pool.query(`SELECT uuid FROM ${players} LIMIT 1`)
 }
 const run=async(apply:boolean,filterId?:string)=>{
  if(active)return {done:0,changed:0,missing:0,failed:0,details:['Outra sincronização já está em andamento.']}
  active=true
  let done=0,changed=0,missing=0,failed=0
  const details:string[]=[]
  try{
   await check()
   const links=getLinkDB().links.filter(x=>!filterId||x.discordId===filterId)
   for(const link of links){
    try{
     const s=await query(link)
     if(s.reason==='UUID inválido'){failed++;details.push(`${link.name}: UUID inválido`);continue}
     const member=await guild.members.fetch(link.discordId).catch(()=>null)
     if(!member){missing++;continue}
     const held=roleIds.filter(id=>member.roles.cache.has(id))
     const add=s.roleId&&!held.includes(s.roleId)?s.roleId:null
     const remove=held.filter(id=>id!==s.roleId)
     // Vinculação nunca modificada; nenhum outro cargo é tocado.
     if(add||remove.length){
      if(apply){
       // Aplicar novo cargo antes de remover os antigos.
       if(add)await member.roles.add(add,'HEZZUZ VIP Sync: LuckPerms')
       for(const id of remove)await member.roles.remove(id,'HEZZUZ VIP Sync: LuckPerms')
       changed++
      }
      details.push(`${link.name}: ${s.group||'sem VIP'} | ${apply?'alterado':'prévia'} +${add?'1':'0'} -${remove.length}`)
     }
     done++
    }catch(e){failed++;details.push(`${link.name}: ERRO ${String(e).slice(0,85)}`)}
    await sleep(200)
   }
  }finally{active=false}
  return {done,changed,missing,failed,details}
 }
 const command=new SlashCommandBuilder().setName('vipsync').setDescription('HEZZUZ: sincronização VIP Minecraft ↔ Discord')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(s=>s.setName('verificar').setDescription('Testar conexão e consultar seu VIP sem alterar cargos'))
  .addSubcommand(s=>s.setName('previa').setDescription('Mostrar ajustes previstos sem mexer nos cargos'))
  .addSubcommand(s=>s.setName('sincronizar').setDescription('Sincronizar cargos de um jogador vinculado').addUserOption(o=>o.setName('usuario').setDescription('Jogador Discord vinculado').setRequired(true)))
  .addSubcommand(s=>s.setName('geral').setDescription('Sincronizar todos os jogadores vinculados'))
 try{const commands=await guild.commands.fetch();const existing=commands.find(c=>c.name==='vipsync');if(existing)await existing.edit(command.toJSON() as any);else await guild.commands.create(command.toJSON() as any)}catch(e){console.error('[HEZZUZ VIP Sync] Registro slash:',e)}
 client.on('interactionCreate',async interaction=>{
  if(!interaction.isChatInputCommand()||interaction.commandName!=='vipsync'||interaction.guildId!==cfg.guildId)return
  const member=await guild.members.fetch(interaction.user.id).catch(()=>null)
  if(!member?.permissions.has(PermissionFlagsBits.Administrator))return void await interaction.reply({content:'Apenas administradores.',flags:64})
  await interaction.deferReply({flags:64})
  try{
   const sub=interaction.options.getSubcommand()
   if(sub==='verificar'){
    await check();const link=getLinkDB().links.find(x=>x.discordId===interaction.user.id)
    const status=link?await query(link):null
    await interaction.editReply(`✅ MySQL LuckPerms conectado. ${status?`Seu grupo: **${status.group||'nenhum VIP global'}** (${status.reason}).`:'Sua conta Discord ainda não está vinculada.'}`)
    return
   }
   if((sub==='sincronizar'||sub==='geral')&&!cfg.syncEnabled){await interaction.editReply('🔒 Aplicação de cargos desativada. Configure syncEnabled: true após validar /vipsync previa.');return}
   const target=sub==='sincronizar'?interaction.options.getUser('usuario',true).id:undefined
   const result=await run(sub==='sincronizar'||sub==='geral',target)
   await interaction.editReply(`👑 VIP Sync ${sub}\nConferidos: ${result.done} | Alterados: ${result.changed} | Ausentes Discord: ${result.missing} | Erros: ${result.failed}\n${result.details.slice(0,12).join('\n')||'Nenhuma alteração necessária.'}`.slice(0,1950))
  }catch(e){console.error('[HEZZUZ VIP Sync]',e);await interaction.editReply('❌ Falha VIP Sync: '+String(e).slice(0,1500)).catch(()=>{})}
 })
 // Intervalo mínimo de 60 segundos para respeitar Discord, MySQL e redes maiores.
 const secs=Math.max(60,Number(cfg.intervalSeconds ?? ((cfg.intervalMinutes??15)*60))||900)
 const automatic=async()=>{
  if(active)return
  try{
   const s=await run(true)
   if(s.changed||s.failed)console.log('[HEZZUZ VIP Sync] Automático:',{conferidos:s.done,alterados:s.changed,erros:s.failed})
  }catch(e){console.error('[HEZZUZ VIP Sync] Automático:',String(e))}
 }
 if(cfg.syncEnabled){
  if(cfg.syncOnStartup!==false)setTimeout(()=>{void automatic()},5000).unref()
  setInterval(()=>{void automatic()},secs*1000).unref()
 }
 console.log('[HEZZUZ VIP Sync] Iniciado. Aplicação de cargos '+(cfg.syncEnabled?`ATIVA (a cada ${secs}s; início imediato: ${cfg.syncOnStartup!==false})`:'DESATIVADA (prévia)'))
})
