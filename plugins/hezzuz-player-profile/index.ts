import {api,opendiscord} from '#opendiscord'
import {SlashCommandBuilder,PermissionFlagsBits} from 'discord.js'
import {getLinkDB} from '../hezzuz-link/storage'
const root='./plugins/hezzuz-player-profile/'
type Cfg={enabled:boolean;guildId:string;roles:Record<string,string>;allowPublicLookup:boolean}
const rank=['mega+','mega','vip+','vip']
opendiscord.events.get('onConfigLoad').listen(m=>{m.add(new api.ODJsonConfig('hezzuz-player-profile:config','config.json',root))})
opendiscord.events.get('afterClientReady').listen(async()=>{
 const cfg=opendiscord.configs.get('hezzuz-player-profile:config')?.data as Cfg|undefined;if(!cfg?.enabled)return
 const client=opendiscord.client.client;const guild=await client.guilds.fetch(cfg.guildId).catch(()=>null);if(!guild)return
 const cmd=new SlashCommandBuilder().setName('perfilhezzuz').setDescription('Perfil de conta vinculada HEZZUZ')
 .addUserOption(o=>o.setName('usuario').setDescription('Conta Discord (omita para seu perfil)').setRequired(false))
 try{const all=await guild.commands.fetch();const old=all.find(c=>c.name==='perfilhezzuz');if(old)await old.edit(cmd.toJSON() as any);else await guild.commands.create(cmd.toJSON() as any)}catch(e){console.error('[HEZZUZ Profile] Slash:',e)}
 client.on('interactionCreate',async i=>{
  if(!i.isChatInputCommand()||i.guildId!==cfg.guildId||i.commandName!=='perfilhezzuz')return
  try{
   const requested=i.options.getUser('usuario')||i.user
   if(requested.id!==i.user.id&&!cfg.allowPublicLookup){const self=await guild.members.fetch(i.user.id).catch(()=>null);if(!self?.permissions.has(PermissionFlagsBits.Administrator))return void await i.reply({flags:64,content:'Consulta de outros perfis restrita à staff.'})}
   const link=getLinkDB().links.find(p=>p.discordId===requested.id)
   if(!link)return void await i.reply({flags:64,content:'🔗 Esta conta não está vinculada ao Minecraft. Use o painel HEZZUZ Link.'})
   const member=await guild.members.fetch(requested.id).catch(()=>null)
   const vip=rank.find(g=>Boolean(cfg.roles[g])&&member?.roles.cache.has(cfg.roles[g]))
   const profile=`🏰 **Perfil HEZZUZ**\n🎮 Jogador: **${String(link.name).slice(0,16)}**\n🔗 Discord: <@${requested.id}>\n💠 Vinculação: **Ativa**\n👑 VIP Discord: **${vip?.toUpperCase()||'Nenhum'}**\n📅 Vinculado em: <t:${Math.floor(Number(link.linkedAt||0)/1000)}:d>\n\nℹ️ VIP reflete o cargo atual do Discord (VIP Sync), não uma consulta ao saldo/benefício no Minecraft. Dinheiro CMI, PlayerPoints e AuraSkills ainda não têm leitura integrada; não exibimos valores inventados.`
   return void await i.reply({flags:64,content:profile})
  }catch(e){console.error('[HEZZUZ Profile]',e);if(!i.replied)await i.reply({flags:64,content:'Falha ao consultar perfil.'}).catch(()=>{})}
 })
 console.log('[HEZZUZ Profile] Iniciado.')
})
