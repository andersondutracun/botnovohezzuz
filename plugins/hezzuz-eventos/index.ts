import { api, opendiscord } from '#opendiscord'
import { Events, EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const folder='./plugins/hezzuz-eventos/'
type Cfg = {enabled:boolean;guildId:string;staffRoleIds:string[];logsChannelId:string;[key:string]:any}
opendiscord.events.get('onConfigLoad').listen(manager=>{manager.add(new api.ODJsonConfig('hezzuz-eventos:config','config.json',folder))})
opendiscord.events.get('afterClientReady').listen(async()=>{
 const cfg=opendiscord.configs.get('hezzuz-eventos:config')?.data as Cfg|undefined
 if(!cfg?.enabled)return
 const client=opendiscord.client.client
 const guild=await client.guilds.fetch(cfg.guildId).catch(()=>null)
 if(!guild)return
 const staff=async(i:any)=>{if(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return true;const m=await guild.members.fetch(i.user.id).catch(()=>null);return !!m&&cfg.staffRoleIds.some((id:string)=>m.roles.cache.has(id))}
 const reply=async(i:any,message:string)=>{if(i.deferred||i.replied)await i.followUp({content:message,ephemeral:true});else await i.reply({content:message,ephemeral:true})}
 const load=()=>{try{return JSON.parse(readFileSync(folder+'data.json','utf8'))}catch{return {}}}
 const save=(data:any)=>writeFileSync(folder+'data.json',JSON.stringify(data,null,2))

 const cmd=new SlashCommandBuilder().setName('eventohezzuz').setDescription('Eventos da HEZZUZ').addSubcommand(s=>s.setName('criar').setDescription('Abrir inscrições').addStringOption(o=>o.setName('titulo').setDescription('Evento').setRequired(true)).addStringOption(o=>o.setName('data').setDescription('Data e horário').setRequired(true)).addChannelOption(o=>o.setName('canal').setDescription('Canal').setRequired(true))).addSubcommand(s=>s.setName('inscritos').setDescription('Listar inscritos').addStringOption(o=>o.setName('id').setDescription('ID do evento').setRequired(true)))
 try{const commands=await guild.commands.fetch();const old=commands.find(x=>x.name==='eventohezzuz');if(old)await old.edit(cmd.toJSON() as any);else await guild.commands.create(cmd.toJSON() as any)}catch(e){opendiscord.log('Eventos: '+String(e),'error')}
 client.on(Events.InteractionCreate,async i=>{try{if(i.isButton()&&i.guildId===cfg.guildId&&i.customId.startsWith('hezzuz_evento:')){const id=i.customId.split(':')[1],db=load(),e=db[id];if(!e)return void await reply(i,'Evento não encontrado.');const ix=e.people.indexOf(i.user.id);if(ix<0)e.people.push(i.user.id);else e.people.splice(ix,1);save(db);return void await reply(i,ix<0?'Inscrição confirmada.':'Inscrição removida.')}if(!i.isChatInputCommand()||i.guildId!==cfg.guildId||i.commandName!=='eventohezzuz')return;const sub=i.options.getSubcommand();if(sub==='inscritos'){const e=load()[i.options.getString('id',true)];return void await reply(i,e?`**${e.title}**: ${e.people.length} inscritos
${e.people.slice(0,30).map((x:string)=>'<@'+x+'>').join(', ')}`:'Evento não encontrado.')}if(!await staff(i))return void await reply(i,'Sem permissão.');const ch=i.options.getChannel('canal');if(!ch||!('send'in ch))return void await reply(i,'Canal inválido.');const title=i.options.getString('titulo',true),date=i.options.getString('data',true);const msg=await (ch as any).send({content:`⚔️ **${title}**
📅 ${date}`});await msg.edit({components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('hezzuz_evento:'+msg.id).setLabel('Inscrever / Sair').setStyle(ButtonStyle.Success))]});const db=load();db[msg.id]={title,date,people:[]};save(db);await reply(i,'Evento criado: '+msg.id)}catch(e){opendiscord.log('Eventos: '+String(e),'error');if(i.isRepliable())await reply(i,'Erro ao processar evento.').catch(()=>{})}})

})
