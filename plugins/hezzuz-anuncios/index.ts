import { api, opendiscord } from '#opendiscord'
import { Events, EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const folder='./plugins/hezzuz-anuncios/'
type Cfg = {enabled:boolean;guildId:string;staffRoleIds:string[];logsChannelId:string;[key:string]:any}
opendiscord.events.get('onConfigLoad').listen(manager=>{manager.add(new api.ODJsonConfig('hezzuz-anuncios:config','config.json',folder))})
opendiscord.events.get('afterClientReady').listen(async()=>{
 const cfg=opendiscord.configs.get('hezzuz-anuncios:config')?.data as Cfg|undefined
 if(!cfg?.enabled)return
 const client=opendiscord.client.client
 const guild=await client.guilds.fetch(cfg.guildId).catch(()=>null)
 if(!guild)return
 const staff=async(i:any)=>{if(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return true;const m=await guild.members.fetch(i.user.id).catch(()=>null);return !!m&&cfg.staffRoleIds.some((id:string)=>m.roles.cache.has(id))}
 const reply=async(i:any,message:string)=>{if(i.deferred||i.replied)await i.followUp({content:message,ephemeral:true});else await i.reply({content:message,ephemeral:true})}
 const load=()=>{try{return JSON.parse(readFileSync(folder+'data.json','utf8'))}catch{return {}}}
 const save=(data:any)=>writeFileSync(folder+'data.json',JSON.stringify(data,null,2))

const command=new SlashCommandBuilder().setName('anunciar').setDescription('Publica comunicado HEZZUZ').addChannelOption(o=>o.setName('canal').setDescription('Destino').setRequired(true)).addStringOption(o=>o.setName('titulo').setDescription('Título').setRequired(true)).addStringOption(o=>o.setName('texto').setDescription('Conteúdo').setRequired(true))
try{const commands=await guild.commands.fetch();const old=commands.find(x=>x.name==='anunciar');if(old)await old.edit(command.toJSON() as any);else await guild.commands.create(command.toJSON() as any)}catch(e){opendiscord.log('Anuncios: '+String(e),'error')}
client.on(Events.InteractionCreate,async i=>{if(!i.isChatInputCommand()||i.guildId!==cfg.guildId||i.commandName!=='anunciar')return;try{if(!await staff(i))return void await reply(i,'Sem permissão.');const ch=i.options.getChannel('canal');if(!ch||!('send'in ch))return void await reply(i,'Escolha um canal de texto.');await (ch as any).send({embeds:[new EmbedBuilder().setColor(0xc89b48).setTitle(i.options.getString('titulo',true).slice(0,256)).setDescription(i.options.getString('texto',true).slice(0,4096)).setTimestamp()],allowedMentions:{parse:[]}});await reply(i,'Anúncio publicado.')}catch(e){opendiscord.log('Anuncios: '+String(e),'error');await reply(i,'Erro ao publicar.')}})

})
