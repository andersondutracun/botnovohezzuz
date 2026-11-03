import { api, opendiscord } from '#opendiscord'
import { Events, EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const folder='./plugins/hezzuz-sorteios/'
type Cfg = {enabled:boolean;guildId:string;staffRoleIds:string[];logsChannelId:string;[key:string]:any}
opendiscord.events.get('onConfigLoad').listen(manager=>{manager.add(new api.ODJsonConfig('hezzuz-sorteios:config','config.json',folder))})
opendiscord.events.get('afterClientReady').listen(async()=>{
 const cfg=opendiscord.configs.get('hezzuz-sorteios:config')?.data as Cfg|undefined
 if(!cfg?.enabled)return
 const client=opendiscord.client.client
 const guild=await client.guilds.fetch(cfg.guildId).catch(()=>null)
 if(!guild)return
 const staff=async(i:any)=>{if(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return true;const m=await guild.members.fetch(i.user.id).catch(()=>null);return !!m&&cfg.staffRoleIds.some((id:string)=>m.roles.cache.has(id))}
 const reply=async(i:any,message:string)=>{if(i.deferred||i.replied)await i.followUp({content:message,ephemeral:true});else await i.reply({content:message,ephemeral:true})}
 const load=()=>{try{return JSON.parse(readFileSync(folder+'data.json','utf8'))}catch{return {}}}
 const save=(data:any)=>writeFileSync(folder+'data.json',JSON.stringify(data,null,2))

 const cmd=new SlashCommandBuilder().setName('sorteio').setDescription('Sorteios HEZZUZ').addSubcommand(s=>s.setName('criar').setDescription('Criar sorteio').addStringOption(o=>o.setName('premio').setDescription('Prêmio').setRequired(true)).addIntegerOption(o=>o.setName('minutos').setDescription('Duração').setMinValue(1).setMaxValue(43200).setRequired(true)).addChannelOption(o=>o.setName('canal').setDescription('Canal').setRequired(true))).addSubcommand(s=>s.setName('encerrar').setDescription('Encerrar sorteio').addStringOption(o=>o.setName('id').setDescription('ID da mensagem').setRequired(true)))
 try{const commands=await guild.commands.fetch();const old=commands.find(x=>x.name==='sorteio');if(old)await old.edit(cmd.toJSON() as any);else await guild.commands.create(cmd.toJSON() as any)}catch(e){opendiscord.log('Sorteios: '+String(e),'error')}
 const finish=async(id:string)=>{const db=load(),g=db[id];if(!g||g.ended)return false;g.ended=true;save(db);const ch=await guild.channels.fetch(g.channelId).catch(()=>null);const w=g.people.length?g.people[Math.floor(Math.random()*g.people.length)]:null;if(ch&&'send'in ch)await (ch as any).send({content:w?`🎉 **${g.prize}** — vencedor: <@${w}>`:`🎉 **${g.prize}** — sem participantes.`,allowedMentions:{users:w?[w]:[]}}).catch(()=>{});return true}
 client.on(Events.InteractionCreate,async i=>{try{if(i.isButton()&&i.guildId===cfg.guildId&&i.customId.startsWith('hezzuz_sorteio:')){const id=i.customId.split(':')[1],db=load(),g=db[id];if(!g||g.ended||Date.now()>g.endsAt)return void await reply(i,'Sorteio encerrado ou não encontrado.');const ix=g.people.indexOf(i.user.id);if(ix===-1)g.people.push(i.user.id);else g.people.splice(ix,1);save(db);return void await reply(i,ix===-1?'Inscrição confirmada!':'Você saiu do sorteio.')}if(!i.isChatInputCommand()||i.guildId!==cfg.guildId||i.commandName!=='sorteio')return;if(!await staff(i))return void await reply(i,'Sem permissão.');const sub=i.options.getSubcommand();if(sub==='encerrar')return void await reply(i,await finish(i.options.getString('id',true))?'Sorteio encerrado.':'Sorteio não encontrado ou encerrado.');const ch=i.options.getChannel('canal');if(!ch||!('send'in ch))return void await reply(i,'Canal inválido.');const prize=i.options.getString('premio',true),end=Date.now()+i.options.getInteger('minutos',true)*60000;const msg=await (ch as any).send({content:`🎉 **SORTEIO HEZZUZ**
Prêmio: **${prize}**
Termina: <t:${Math.floor(end/1000)}:R>`});const row=new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('hezzuz_sorteio:'+msg.id).setLabel('Participar / Sair').setStyle(ButtonStyle.Primary));await msg.edit({components:[row]});const db=load();db[msg.id]={channelId:ch.id,prize,endsAt:end,people:[],ended:false};save(db);await reply(i,'Sorteio criado: '+msg.id)}catch(e){opendiscord.log('Sorteios: '+String(e),'error');if(i.isRepliable())await reply(i,'Erro no sorteio.').catch(()=>{})}})
 const timer=setInterval(async()=>{for(const [id,g] of Object.entries(load()) as [string,any][])if(!g.ended&&Date.now()>=g.endsAt)await finish(id)},30000);timer.unref()

})
