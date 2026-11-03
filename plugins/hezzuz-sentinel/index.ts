import {api,opendiscord} from '#opendiscord'
import {PermissionFlagsBits,SlashCommandBuilder} from 'discord.js'
const root='./plugins/hezzuz-sentinel/'
type Cfg={enabled:boolean;guildId:string;alertChannelId:string;maxJoinsPerMinute:number;maxMessagesPerMinute:number;alertCooldownSeconds:number}
opendiscord.events.get('onConfigLoad').listen(m=>{m.add(new api.ODJsonConfig('hezzuz-sentinel:config','config.json',root))})
opendiscord.events.get('afterClientReady').listen(async()=>{
 const cfg=opendiscord.configs.get('hezzuz-sentinel:config')?.data as Cfg|undefined;if(!cfg?.enabled)return
 const client=opendiscord.client.client,guild=await client.guilds.fetch(cfg.guildId).catch(()=>null);if(!guild)return
 const joins:number[]=[];const messages=new Map<string,number[]>();const alerted=new Map<string,number>();let alertCount=0
 const warn=async(key:string,detail:string)=>{const now=Date.now();if(now-(alerted.get(key)||0)<Math.max(60,cfg.alertCooldownSeconds||300)*1000)return;alerted.set(key,now);const channel=await guild.channels.fetch(cfg.alertChannelId).catch(()=>null);if(!channel||!('send' in channel))return;await (channel as any).send({content:`🛡️ **HEZZUZ Sentinel — Alerta (sem punição automática)**\n${detail}`,allowedMentions:{parse:[]}}).then(()=>alertCount++).catch(()=>{})}
 const cmd=new SlashCommandBuilder().setName('hezzsentinel').setDescription('Resumo de alertas do Sentinel').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
 try{const cmds=await guild.commands.fetch();const old=cmds.find(c=>c.name==='hezzsentinel');if(old)await old.edit(cmd.toJSON() as any);else await guild.commands.create(cmd.toJSON() as any)}catch(e){console.warn('[Sentinel] slash:',String(e))}
 client.on('interactionCreate',async i=>{if(!i.isChatInputCommand()||i.commandName!=='hezzsentinel'||i.guildId!==cfg.guildId)return;const member=await guild.members.fetch(i.user.id).catch(()=>null);if(!member?.permissions.has(PermissionFlagsBits.Administrator))return void await i.reply({content:'Somente administradores.',flags:64});await i.reply({content:`🛡️ Sentinel ativo. Alertas enviados desde o início: ${alertCount}. Não aplica punições automaticamente.`,flags:64})})
 client.on('guildMemberAdd',m=>{if(m.guild.id!==cfg.guildId)return;const now=Date.now();joins.push(now);while(joins.length&&joins[0]<now-60000)joins.shift();if(joins.length>=Math.max(3,cfg.maxJoinsPerMinute||10))void warn('join','Muitos membros entraram em 60 segundos ('+joins.length+'). Verificar possíveis raids.')})
 client.on('messageCreate',m=>{if(m.guildId!==cfg.guildId||m.author.bot)return;const now=Date.now(),list=messages.get(m.author.id)||[];list.push(now);while(list.length&&list[0]<now-60000)list.shift();messages.set(m.author.id,list);if(list.length>=Math.max(5,cfg.maxMessagesPerMinute||25))void warn('spam-'+m.author.id,`Volume elevado de mensagens de <@${m.author.id}>: ${list.length} em 60 segundos.`)})
 console.log('[Sentinel] Monitoramento passivo iniciado (sem banimento ou mute automático).')
})
