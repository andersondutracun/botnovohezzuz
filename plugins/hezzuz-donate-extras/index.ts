import {api,opendiscord} from '#opendiscord'
import {SlashCommandBuilder,PermissionFlagsBits} from 'discord.js'
import {readFileSync} from 'node:fs'
const root='./plugins/hezzuz-donate-extras/'
type Config={enabled:boolean;guildId:string;maxHistory:number;hideBuyerNamesInReports:boolean}
type Order={ref:string;discordId:string;name?:string;amount?:number;points?:number;status:string;created:number;test?:boolean;production?:boolean;paymentId?:string}
const orders=():Order[]=>{try{const v=JSON.parse(readFileSync('./plugins/hezzuz-donate/orders.json','utf8'));return Array.isArray(v.orders)?v.orders:[]}catch{return []}}
const fmt=(c:number)=>'R$ '+(c/100).toFixed(2).replace('.',',')
const cents=(v:number)=>Math.round((Number(v)||0)*100)
const when=(x:number)=>new Date(x).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})
const valid=(v:Order)=>v.production===true&&!v.test&&Number.isFinite(v.amount)&&Number(v.amount)>0&&Boolean(v.paymentId)&&v.paymentId!=='TEST-SEM-PAGAMENTO'
opendiscord.events.get('onConfigLoad').listen(m=>{m.add(new api.ODJsonConfig('hezzuz-donate-extras:config','config.json',root))})
opendiscord.events.get('afterClientReady').listen(async()=>{
 const cfg=opendiscord.configs.get('hezzuz-donate-extras:config')?.data as Config|undefined;if(!cfg?.enabled)return
 const client=opendiscord.client.client;const guild=await client.guilds.fetch(cfg.guildId).catch(()=>null);if(!guild)return
 const command=new SlashCommandBuilder().setName('donate').setDescription('HEZZUZ Donate 2.0: compras e auditoria')
  .addSubcommand(s=>s.setName('minhascompras').setDescription('Seus últimos pedidos (somente você vê)'))
  .addSubcommand(s=>s.setName('pedido').setDescription('Consultar seu pedido por referência').addStringOption(o=>o.setName('referencia').setDescription('Referência hezzuz-...').setRequired(true)))
  .addSubcommand(s=>s.setName('relatorio').setDescription('Resumo financeiro restrito à administração'))
  .addSubcommand(s=>s.setName('pendencias').setDescription('Pedidos pendentes de entrega (admin)'))
 try{const all=await guild.commands.fetch();const old=all.find(c=>c.name==='donate');if(old)await old.edit(command.toJSON() as any);else await guild.commands.create(command.toJSON() as any)}catch(e){console.error('[HEZZUZ Donate Extras] Slash:',e)}
 client.on('interactionCreate',async i=>{
  if(!i.isChatInputCommand()||i.guildId!==cfg.guildId||i.commandName!=='donate')return
  try{
   const sub=i.options.getSubcommand(),db=orders();const own=db.filter(x=>x.discordId===i.user.id&&valid(x));
   if(sub==='minhascompras'){
    const rows=own.slice(-Math.min(20,Math.max(1,Number(cfg.maxHistory)||10))).reverse()
    return void await i.reply({flags:64,content:rows.length?`💎 **Suas compras HEZZUZ**\n`+rows.map(o=>`\`${o.ref}\` • ${fmt(cents(o.amount||0))} • ${o.points||0} pontos • **${o.status}** • ${when(o.created)}`).join('\n').slice(0,1900):'Você ainda não possui compras reais registradas.'})
   }
   if(sub==='pedido'){
    const ref=i.options.getString('referencia',true).trim();const o=own.find(x=>x.ref===ref)
    return void await i.reply({flags:64,content:o?`💎 Pedido \`${o.ref}\`\nValor: **${fmt(cents(o.amount||0))}**\nPontos: **${o.points||0}**\nEstado: **${o.status}**\nCriado: ${when(o.created)}\n\nSe houver divergência, abra um ticket Financeiro.`:'Pedido não encontrado entre suas compras. Abra um ticket Financeiro se precisar de ajuda.'})
   }
   const member=await guild.members.fetch(i.user.id).catch(()=>null)
   if(!member?.permissions.has(PermissionFlagsBits.Administrator))return void await i.reply({flags:64,content:'Comando restrito à administração.'})
   const real=db.filter(valid);const paid=real.filter(x=>x.status==='approved'||x.status==='delivered');const delivered=real.filter(x=>x.status==='delivered');const risk=real.filter(x=>x.status==='refunded'||x.status==='review');
   if(sub==='relatorio'){
    const sum=(arr:Order[])=>arr.reduce((n,x)=>n+cents(x.amount||0),0)
    return void await i.reply({flags:64,content:`📊 **HEZZUZ Donate — relatório interno**\nPedidos reais registrados: **${real.length}**\nAprovados ou entregues: **${paid.length}** (${fmt(sum(paid))})\nEntregues: **${delivered.length}** (${fmt(sum(delivered))})\nPendentes de pagamento: **${real.filter(x=>x.status==='pending').length}**\nRevisão/estorno: **${risk.length}**\n\n⚠️ Valores são registros locais, **não** extrato, liquidação ou saldo bancário. Não confundir receita com saque disponível.`})
   }
   const todo=real.filter(x=>x.status==='approved').slice(-15)
   return void await i.reply({flags:64,content:todo.length?'🚨 **Entregas aprovadas ainda pendentes**\n'+todo.map(o=>`\`${o.ref}\` • ${o.points||0} pontos • ${when(o.created)}`).join('\n').slice(0,1900):'✅ Nenhuma entrega aprovada pendente no histórico local.'})
  }catch(e){console.error('[HEZZUZ Donate Extras]',e);if(!i.replied&&!i.deferred)await i.reply({flags:64,content:'Não foi possível consultar os pedidos agora.'}).catch(()=>{})}
 })
 console.log('[HEZZUZ Donate Extras] Comandos de leitura iniciados. Não altera cobranças nem entregas.')
})
