import { api, opendiscord } from '#opendiscord'
import { Events, EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const folder='./plugins/hezzuz-antispam/'
type Cfg = {enabled:boolean;guildId:string;staffRoleIds:string[];logsChannelId:string;[key:string]:any}
opendiscord.events.get('onConfigLoad').listen(manager=>{manager.add(new api.ODJsonConfig('hezzuz-antispam:config','config.json',folder))})
opendiscord.events.get('afterClientReady').listen(async()=>{
 const cfg=opendiscord.configs.get('hezzuz-antispam:config')?.data as Cfg|undefined
 if(!cfg?.enabled)return
 const client=opendiscord.client.client
 const guild=await client.guilds.fetch(cfg.guildId).catch(()=>null)
 if(!guild)return
 const staff=async(i:any)=>{if(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return true;const m=await guild.members.fetch(i.user.id).catch(()=>null);return !!m&&cfg.staffRoleIds.some((id:string)=>m.roles.cache.has(id))}
 const reply=async(i:any,message:string)=>{if(i.deferred||i.replied)await i.followUp({content:message,ephemeral:true});else await i.reply({content:message,ephemeral:true})}
 const load=()=>{try{return JSON.parse(readFileSync(folder+'data.json','utf8'))}catch{return {}}}
 const save=(data:any)=>writeFileSync(folder+'data.json',JSON.stringify(data,null,2))

const seen=new Map<string,number[]>()
client.on(Events.MessageCreate,async m=>{if(m.guildId!==cfg.guildId||m.author.bot||cfg.exemptChannelIds.includes(m.channelId))return;const member=m.member;if(!member||member.permissions.has(PermissionFlagsBits.ManageMessages)||cfg.staffRoleIds.some((id:string)=>member.roles.cache.has(id)))return;try{if(cfg.blockInvites&&/discord(?:\.gg|\.com\/invite)\/[a-z0-9-]+/i.test(m.content)){await m.delete().catch(()=>{});return}const key=m.channelId+':'+m.author.id,now=Date.now(),arr=(seen.get(key)||[]).filter(t=>t>now-cfg.windowSeconds*1000);arr.push(now);seen.set(key,arr);if(arr.length>=cfg.maxMessages){seen.delete(key);await member.timeout(cfg.timeoutMinutes*60000,'HEZZUZ antispam').catch(()=>{})}}catch(e){opendiscord.log('Antispam: '+String(e),'error')}})

})
