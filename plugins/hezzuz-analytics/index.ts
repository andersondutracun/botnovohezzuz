import {api,opendiscord} from '#opendiscord'
import {SlashCommandBuilder,PermissionFlagsBits} from 'discord.js'
import {readFileSync} from 'node:fs'
import {getLinkDB} from '../hezzuz-link/storage'
const root='./plugins/hezzuz-analytics/'
type Cfg={enabled:boolean;guildId:string;ticketPrefixes:string[];reportChannelId:string;dailyReportEnabled:boolean}
type Order={status:string;production?:boolean;test?:boolean;amount:number;created:number;paymentId?:string}
const readOrders=():Order[]=>{try{const v=JSON.parse(readFileSync('./plugins/hezzuz-donate/orders.json','utf8'));return Array.isArray(v.orders)?v.orders:[]}catch{return []}}
const money=(n:number)=>'R$ '+(n/100).toFixed(2).replace('.',',')
const sum=(a:Order[])=>money(a.reduce((s,o)=>s+Math.round(Number(o.amount||0)*100),0))
opendiscord.events.get('onConfigLoad').listen(m=>{m.add(new api.ODJsonConfig('hezzuz-analytics:config','config.json',root))})
opendiscord.events.get('afterClientReady').listen(async()=>{
 const cfg=opendiscord.configs.get('hezzuz-analytics:config')?.data as Cfg|undefined;if(!cfg?.enabled)return
 const client=opendiscord.client.client;const guild=await client.guilds.fetch(cfg.guildId).catch(()=>null);if(!guild)return
 const cmd=new SlashCommandBuilder().setName('hezzuzrelatorio').setDescription('Indicadores internos HEZZUZ').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
 try{const all=await guild.commands.fetch();const old=all.find(c=>c.name==='hezzuzrelatorio');if(old)await old.edit(cmd.toJSON() as any);else await guild.commands.create(cmd.toJSON() as any)}catch(e){console.error('[HEZZUZ Analytics] Slash:',e)}
 const report=async()=>{
  const channels=await guild.channels.fetch().catch(()=>null)
  const prefixes=(cfg.ticketPrefixes||['duvida-','donate-','financeiro-','recurso-']).map(x=>x.toLowerCase())
  const all=channels?[...channels.values()].filter(Boolean):[]
  const tickets=all.filter(ch=>prefixes.some(p=>String(ch?.name||'').toLowerCase().startsWith(p)))
  const db=readOrders().filter(o=>o.production===true&&!o.test&&o.paymentId&&o.paymentId!=='TEST-SEM-PAGAMENTO')
  const delivered=db.filter(o=>o.status==='delivered')
  const approved=db.filter(o=>o.status==='approved')
  const pending=db.filter(o=>o.status==='pending')
  const now=Date.now(),recent=db.filter(o=>Number(o.created)>=now-86400000)
  return `📊 **HEZZUZ Analytics — relatório**\n🔗 Contas vinculadas: **${getLinkDB().links.length}**\n🎫 Canais de ticket encontrados: **${tickets.length}** (fotografia atual; não é total histórico)\n💎 Pedidos reais locais: **${db.length}**\n✅ Entregues: **${delivered.length}** — ${sum(delivered)}\n⏳ Aguardando entrega: **${approved.length}**\n💳 Aguardando pagamento: **${pending.length}**\n📅 Pedidos criados nas últimas 24h: **${recent.length}**\n\n⚠️ Dados operacionais locais, não contabilidade oficial. Não inclui jogadores online, economia ou vendas sem registro no Donate.\n🕐 <t:${Math.floor(now/1000)}:f>`
 }
 client.on('interactionCreate',async i=>{
  if(!i.isChatInputCommand()||i.guildId!==cfg.guildId||i.commandName!=='hezzuzrelatorio')return
  const member=await guild.members.fetch(i.user.id).catch(()=>null)
  if(!member?.permissions.has(PermissionFlagsBits.Administrator))return void await i.reply({flags:64,content:'Apenas administradores.'})
  await i.deferReply({flags:64})
  try{await i.editReply(await report())}catch(e){console.error('[HEZZUZ Analytics]',e);await i.editReply('Falha ao montar relatório.').catch(()=>{})}
 })
 if(cfg.dailyReportEnabled&&cfg.reportChannelId){
  let lastDay=''
  const tick=async()=>{const day=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});if(day===lastDay)return;const hour=new Date().toLocaleString('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',hour12:false});if(Number(hour)<9)return
   try{const ch=await guild.channels.fetch(cfg.reportChannelId);if(ch&&'send' in ch){await (ch as any).send({content:await report(),allowedMentions:{parse:[]}});lastDay=day}}catch(e){console.error('[HEZZUZ Analytics] Report diário:',e)}
  }
  setInterval(()=>{void tick()},60000).unref()
 }
 console.log('[HEZZUZ Analytics] Iniciado.')
})
