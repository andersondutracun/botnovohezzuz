import { api, opendiscord } from '#opendiscord'
import { Events, EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const folder='./plugins/hezzuz-autoroles/'
type Cfg = {enabled:boolean;guildId:string;staffRoleIds:string[];logsChannelId:string;[key:string]:any}
opendiscord.events.get('onConfigLoad').listen(manager=>{manager.add(new api.ODJsonConfig('hezzuz-autoroles:config','config.json',folder))})
opendiscord.events.get('afterClientReady').listen(async()=>{
 const cfg=opendiscord.configs.get('hezzuz-autoroles:config')?.data as Cfg|undefined
 if(!cfg?.enabled)return
 const client=opendiscord.client.client
 const guild=await client.guilds.fetch(cfg.guildId).catch(()=>null)
 if(!guild)return
 const staff=async(i:any)=>{if(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return true;const m=await guild.members.fetch(i.user.id).catch(()=>null);return !!m&&cfg.staffRoleIds.some((id:string)=>m.roles.cache.has(id))}
 const reply=async(i:any,message:string)=>{if(i.deferred||i.replied)await i.followUp({content:message,ephemeral:true});else await i.reply({content:message,ephemeral:true})}
 const load=()=>{try{return JSON.parse(readFileSync(folder+'data.json','utf8'))}catch{return {}}}
 const save=(data:any)=>writeFileSync(folder+'data.json',JSON.stringify(data,null,2))

const command=new SlashCommandBuilder().setName('cargoopcional').setDescription('Gerenciar seus cargos opcionais').addStringOption(o=>o.setName('nome').setDescription('Nome da opção; vazio para listar').setRequired(false))
try{const commands=await guild.commands.fetch();const old=commands.find(x=>x.name==='cargoopcional');if(old)await old.edit(command.toJSON() as any);else await guild.commands.create(command.toJSON() as any)}catch(e){opendiscord.log('Autoroles: '+String(e),'error')}
client.on(Events.InteractionCreate,async i=>{if(!i.isChatInputCommand()||i.guildId!==cfg.guildId||i.commandName!=='cargoopcional')return;try{const name=i.options.getString('nome');const entries=cfg.roles||[];if(!name)return void await reply(i,entries.length?entries.map((r:any)=>r.name).join(', '):'Nenhum cargo opcional definido.');const entry=entries.find((r:any)=>r.name.toLowerCase()===name.toLowerCase());if(!entry)return void await reply(i,'Cargo não listado.');const role=await guild.roles.fetch(entry.id).catch(()=>null);const me=await guild.members.fetchMe();if(!role||role.managed||role.position>=me.roles.highest.position||role.permissions.has(PermissionFlagsBits.Administrator)||role.permissions.has(PermissionFlagsBits.ManageRoles)||role.permissions.has(PermissionFlagsBits.ManageGuild)||role.permissions.has(PermissionFlagsBits.BanMembers)||role.permissions.has(PermissionFlagsBits.KickMembers))return void await reply(i,'Cargo não permitido.');const member=await guild.members.fetch(i.user.id);const has=member.roles.cache.has(role.id);if(has)await member.roles.remove(role);else await member.roles.add(role);await reply(i,has?'Cargo removido.':'Cargo adicionado.')}catch(e){opendiscord.log('Autoroles: '+String(e),'error');await reply(i,'Erro ao atualizar cargo.')}})

})
