import { api, opendiscord } from '#opendiscord'
import { Events, EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const folder='./plugins/hezzuz-logs/'
type Cfg = {enabled:boolean;guildId:string;staffRoleIds:string[];logsChannelId:string;[key:string]:any}
opendiscord.events.get('onConfigLoad').listen(manager=>{manager.add(new api.ODJsonConfig('hezzuz-logs:config','config.json',folder))})
opendiscord.events.get('afterClientReady').listen(async()=>{
 const cfg=opendiscord.configs.get('hezzuz-logs:config')?.data as Cfg|undefined
 if(!cfg?.enabled)return
 const client=opendiscord.client.client
 const guild=await client.guilds.fetch(cfg.guildId).catch(()=>null)
 if(!guild)return
 const staff=async(i:any)=>{if(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return true;const m=await guild.members.fetch(i.user.id).catch(()=>null);return !!m&&cfg.staffRoleIds.some((id:string)=>m.roles.cache.has(id))}
 const reply=async(i:any,message:string)=>{if(i.deferred||i.replied)await i.followUp({content:message,ephemeral:true});else await i.reply({content:message,ephemeral:true})}
 const load=()=>{try{return JSON.parse(readFileSync(folder+'data.json','utf8'))}catch{return {}}}
 const save=(data:any)=>writeFileSync(folder+'data.json',JSON.stringify(data,null,2))

const log=async(title:string,content:string)=>{if(!cfg.logsChannelId)return;const channel=await guild.channels.fetch(cfg.logsChannelId).catch(()=>null);if(channel&&'send'in channel)await (channel as any).send({embeds:[new EmbedBuilder().setTitle(title).setDescription(content.slice(0,3500)).setColor(0xbb9955).setTimestamp()],allowedMentions:{parse:[]}}).catch(()=>{})}
client.on(Events.GuildMemberAdd,async m=>{if(m.guild.id===cfg.guildId)await log('Membro entrou',`ID: ${m.id}`)})
client.on(Events.GuildMemberRemove,async m=>{if(m.guild.id===cfg.guildId)await log('Membro saiu',`ID: ${m.id}`)})
client.on(Events.MessageDelete,async m=>{if(m.guildId===cfg.guildId&&!m.author?.bot&&cfg.logDeletedMessages)await log('Mensagem excluída',`Canal: <#${m.channelId}>\nAutor: ${m.author?.id||'não identificado'}`)})

})
