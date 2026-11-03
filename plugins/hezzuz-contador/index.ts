import { api, opendiscord } from '#opendiscord'
import { Events, EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const folder='./plugins/hezzuz-contador/'
type Cfg = {enabled:boolean;guildId:string;staffRoleIds:string[];logsChannelId:string;[key:string]:any}
opendiscord.events.get('onConfigLoad').listen(manager=>{manager.add(new api.ODJsonConfig('hezzuz-contador:config','config.json',folder))})
opendiscord.events.get('afterClientReady').listen(async()=>{
 const cfg=opendiscord.configs.get('hezzuz-contador:config')?.data as Cfg|undefined
 if(!cfg?.enabled)return
 const client=opendiscord.client.client
 const guild=await client.guilds.fetch(cfg.guildId).catch(()=>null)
 if(!guild)return
 const staff=async(i:any)=>{if(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return true;const m=await guild.members.fetch(i.user.id).catch(()=>null);return !!m&&cfg.staffRoleIds.some((id:string)=>m.roles.cache.has(id))}
 const reply=async(i:any,message:string)=>{if(i.deferred||i.replied)await i.followUp({content:message,ephemeral:true});else await i.reply({content:message,ephemeral:true})}
 const load=()=>{try{return JSON.parse(readFileSync(folder+'data.json','utf8'))}catch{return {}}}
 const save=(data:any)=>writeFileSync(folder+'data.json',JSON.stringify(data,null,2))

if(!cfg.channelId)return
client.on(Events.MessageCreate,async m=>{if(m.guildId!==cfg.guildId||m.channelId!==cfg.channelId||m.author.bot)return;const db=load();const last=db.last||0;const n=Number(m.content.trim());if(!/^\d+$/.test(m.content.trim())||!Number.isSafeInteger(n)||n!==last+1||m.author.id===db.lastUser){await m.react('❌').catch(()=>{});return}db.last=n;db.lastUser=m.author.id;db.scores=db.scores||{};db.scores[m.author.id]=(db.scores[m.author.id]||0)+1;save(db);await m.react('✅').catch(()=>{})})
const cmd=new SlashCommandBuilder().setName('rankingcontador').setDescription('Ranking da contagem');try{const all=await guild.commands.fetch();const old=all.find(x=>x.name==='rankingcontador');if(old)await old.edit(cmd.toJSON() as any);else await guild.commands.create(cmd.toJSON() as any)}catch(e){opendiscord.log('Contador: '+String(e),'error')}
client.on(Events.InteractionCreate,async i=>{if(!i.isChatInputCommand()||i.guildId!==cfg.guildId||i.commandName!=='rankingcontador')return;const db=load();const top=Object.entries(db.scores||{}).sort((a:any,b:any)=>b[1]-a[1]).slice(0,10).map(([id,n],ix)=>`${ix+1}. <@${id}> — ${n}`).join('\n');await reply(i,`Último: ${db.last||0}\n${top||'Sem pontuações.'}`)})

})
