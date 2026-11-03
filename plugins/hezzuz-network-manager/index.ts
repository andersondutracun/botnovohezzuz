import {api,opendiscord} from '#opendiscord'
import {SlashCommandBuilder,PermissionFlagsBits,EmbedBuilder} from 'discord.js'
import {readFileSync} from 'node:fs'
const root='./plugins/hezzuz-network-manager/'
type Cfg={enabled:boolean;guildId:string;staleSeconds:number;alertChannelId:string;alertEnabled:boolean;pollSeconds:number}
type Entry={id:string;name:string;online:boolean;players:number}
type State={total:number;servers:Entry[];time:number}
function snapshot():State|null{try{const d=JSON.parse(readFileSync('./plugins/hezzuz-minecraft/telemetry.json','utf8'));if(!Number.isFinite(d.time)||!Array.isArray(d.servers))return null;return d}catch{return null}}
opendiscord.events.get('onConfigLoad').listen(m=>{m.add(new api.ODJsonConfig('hezzuz-network-manager:config','config.json',root))})
opendiscord.events.get('afterClientReady').listen(async()=>{
 const cfg=opendiscord.configs.get('hezzuz-network-manager:config')?.data as Cfg|undefined;if(!cfg?.enabled)return
 const guild=await opendiscord.client.client.guilds.fetch(cfg.guildId).catch(()=>null);if(!guild)return
 const cmd=new SlashCommandBuilder().setName('hezzrede').setDescription('Monitoramento dos reinos HEZZUZ').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
 try{const commands=await guild.commands.fetch();const old=commands.find(c=>c.name==='hezzrede');if(old)await old.edit(cmd.toJSON() as any);else await guild.commands.create(cmd.toJSON() as any)}catch(e){console.error('[HEZZUZ Network] slash',e)}
 const format=()=>{const d=snapshot(),fresh=d&&Date.now()-d.time<=Math.max(30,cfg.staleSeconds||180)*1000;const lines=!fresh?['⚪ Bridge sem telemetria recente. Não assumir servidor offline.']:(d?.servers||[]).slice(0,20).map(x=>`${x.online?'🟢':'🔴'} **${String(x.name).slice(0,40)}**: ${x.online?x.players+' jogador(es)':'offline'}`);return new EmbedBuilder().setTitle('🏰 HEZZUZ — Monitoramento da rede').setDescription([...lines,'',fresh?`Jogadores informados: **${d?.total||0}**`:'Estado desconhecido', 'TPS/MSPT: indisponíveis nesta integração'].join('\n')).setColor(fresh?0x41a879:0x777777).setTimestamp()}
 opendiscord.client.client.on('interactionCreate',async i=>{if(!i.isChatInputCommand()||i.commandName!=='hezzrede'||i.guildId!==cfg.guildId)return;const member=await guild.members.fetch(i.user.id).catch(()=>null);if(!member?.permissions.has(PermissionFlagsBits.Administrator))return void await i.reply({content:'Somente administradores.',flags:64});await i.reply({embeds:[format()],flags:64})})
 let previous='';let initialized=false
 const check=async()=>{if(!cfg.alertEnabled||!cfg.alertChannelId)return;const d=snapshot();const fresh=Boolean(d&&Date.now()-d.time<=Math.max(30,cfg.staleSeconds||180)*1000);const current=fresh?'online':'stale';if(!initialized){previous=current;initialized=true;return}if(current===previous)return;previous=current;const ch=await guild.channels.fetch(cfg.alertChannelId).catch(()=>null);if(ch&&'send'in ch)await (ch as any).send({content:current==='online'?'✅ HEZZUZ Bridge voltou a transmitir telemetria.':'⚠️ HEZZUZ Bridge não envia telemetria recente. Verificar conexão; estado dos servidores é desconhecido.',allowedMentions:{parse:[]}}).catch(()=>{})}
 setInterval(()=>{void check()},Math.max(30,cfg.pollSeconds||60)*1000).unref();console.log('[HEZZUZ Network] monitor somente leitura ativo')
})
