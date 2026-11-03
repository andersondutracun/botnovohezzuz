import {api,opendiscord} from '#opendiscord'
import {SlashCommandBuilder,PermissionFlagsBits,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder} from 'discord.js'
import {randomUUID,randomInt} from 'node:crypto'
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync,copyFileSync} from 'node:fs'
import {getLinkDB} from '../hezzuz-link/storage'
import {hangWords, HangWord, Difficulty} from './forca-words'

const root='./plugins/hezzuz-economy-games/'
const dbFile=root+'economy.json'
type Offer={coins:number;points:number}
type Config={enabled:boolean;guildId:string;currencyName:string;startingCoins:number;dailyCoins:number;dailyEarnCap:number;cooldownSeconds:number;redemptionEnabled:boolean;realDeliveryEnabled:boolean;redemptionsPerDay:number;redemptionOffers:Offer[];staffRoleIds:string[];adminLogChannelId:string;gameChannelIds:string[];publicGameMessages?:boolean;bossHp:number;bossResetHours:number;gamePanelChannelId?:string;gamePanelMessageId?:string;classicChannelIds?:string[];rpgChannelIds?:string[];classicPanelChannelId?:string;rpgPanelChannelId?:string;classicPanelMessageId?:string;rpgPanelMessageId?:string}
type TaskKind='quiz'|'minerar'|'duelo'|'tesouro'|'boss'
type P={balance:number;xp:number;level:number;inventory:Record<string,number>;equipment:string;lastDaily:string;cooldowns:Record<string,number>;day:string;dayEarned:number;week:string;weekProgress:Record<string,number>;dayProgress:Record<string,number>;missionsClaimed:Record<string,boolean>;lifetimeEarned:number;redemptions:string[]}
type Redemption={id:string;discordId:string;uuid:string;name:string;coins:number;points:number;status:'TEST_PENDING'|'CANCELLED'|'REVIEW'|'FULFILLED_MANUALLY';createdAt:number;updatedAt:number;note?:string}
type Battle={id:string;userId:string;enemy:string;hp:number;enemyHp:number;guard:boolean;turn:number;startedAt:number}
type Quiz={id:string;userId:string;answer:number;startedAt:number;question:string;choices:string[]}
type Boss={id:string;hp:number;maxHp:number;startedAt:number;endedAt:number;participants:Record<string,number>;lastAttack:Record<string,number>}
type Ttt={id:string;channelId:string;players:[string,string];board:string[];turn:number;created:number;finished:boolean}
type Sketch={id:string;channelId:string;artist:string;word:string;hint:string;imageUrl:string;created:number;solvedBy?:string}
type Rps={id:string;channelId:string;players:[string,string];choices:Record<string,string>;created:number}
type Hangman={id:string;channelId:string;word:string;hint:string;guessed:string[];wrong:number;created:number;finished:boolean;players:Record<string,number>;difficulty?:Difficulty;maxWrong?:number;category?:string}
type MemoryGame={id:string;owner:string;channelId:string;cards:string[];matched:number[];selected:number[];moves:number;created:number;finished:boolean}
type Naval={id:string;channelId:string;players:[string,string];boards:[number[],number[]];shots:[number[],number[]];turn:number;created:number;finished:boolean}
type Extra={ttt:Record<string,Ttt>;sketch:Record<string,Sketch>;rps:Record<string,Rps>;wins:Record<string,number>;lastRewards:Record<string,number>;hangman?:Record<string,Hangman>;memory?:Record<string,MemoryGame>;naval?:Record<string,Naval>;seasonWins?:Record<string,Record<string,number>>;recentHangWords?:string[]}
type Db={version:1;players:Record<string,P>;redemptions:Redemption[];battles:Record<string,Battle>;quizzes:Record<string,Quiz>;boss:Boss;transactions:{id:string;userId:string;delta:number;reason:string;time:number;balance:number}[];extra?:Extra}
const utcDate=()=>new Date().toISOString().slice(0,10)
const isoWeek=()=>{const d=new Date();d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));const year=d.getUTCFullYear();const y0=new Date(Date.UTC(year,0,1));return `${year}-W${String(Math.ceil((((d.getTime()-y0.getTime())/86400000)+1)/7)).padStart(2,'0')}`}
const freshBoss=(hp:number):Boss=>({id:randomUUID(),hp,maxHp:hp,startedAt:Date.now(),endedAt:0,participants:{},lastAttack:{}})
const freshDb=(cfg:Config):Db=>({version:1,players:{},redemptions:[],battles:{},quizzes:{},boss:freshBoss(cfg.bossHp||1000),transactions:[]})
let db:Db
const save=()=>{mkdirSync(root,{recursive:true});const tmp=dbFile+'.tmp';writeFileSync(tmp,JSON.stringify(db),{encoding:'utf8',mode:0o600});renameSync(tmp,dbFile)}
const load=(cfg:Config)=>{if(!existsSync(dbFile)){db=freshDb(cfg);save();return}try{const raw=JSON.parse(readFileSync(dbFile,'utf8'));if(raw?.version!==1||!raw.players||!Array.isArray(raw.redemptions)||!Array.isArray(raw.transactions))throw Error('estrutura inválida');db=raw as Db}catch(e){throw Error(`Banco da economia ilegível. Nenhuma gravação será realizada; restaure seu backup. ${String(e)}`)}}
const extra=():Extra=>{if(!db.extra)db.extra={ttt:{},sketch:{},rps:{},wins:{},lastRewards:{}};return db.extra}
const season=()=>new Date().toISOString().slice(0,7)
const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ')
const sketches=[{word:'diamante',hint:'Minério raro azul do Minecraft'},{word:'creeper',hint:'Mob que explode perto do jogador'},{word:'castelo',hint:'Construção medieval fortificada'},{word:'enderman',hint:'Mob alto que se teleporta'},{word:'portal',hint:'Passagem entre dimensões'},{word:'picareta',hint:'Ferramenta usada na mineração'},{word:'dragao',hint:'Chefe que habita o End'},{word:'espada',hint:'Arma de combate corpo a corpo'}]
const renderBoard=(g:Ttt)=>[0,1,2].map(y=>new ActionRowBuilder<ButtonBuilder>().addComponents([0,1,2].map(x=>{const k=y*3+x,cell=g.board[k];return new ButtonBuilder().setCustomId(`hezz_e:ttt:${g.id}:${k}`).setLabel(cell||'·').setStyle(cell==='X'?ButtonStyle.Primary:cell==='O'?ButtonStyle.Danger:ButtonStyle.Secondary).setDisabled(Boolean(cell)||g.finished)})))
const hangButtons=(h:Hangman)=>['abcdefghijklm','nopqrstuvwxyz'].map((letters,index)=>new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`hezz_e:hangselect:${h.id}:${index}`).setPlaceholder(index===0?'Escolher letra A–M':'Escolher letra N–Z').addOptions([...letters].map(letter=>({label:letter.toUpperCase(),value:letter,description:h.guessed.includes(letter)?'Já utilizada':'Selecionar letra'}))).setDisabled(h.finished)))
const memoryButtons=(g:MemoryGame)=>[0,1,2].map(row=>new ActionRowBuilder<ButtonBuilder>().addComponents([0,1,2,3].map(col=>{const idx=row*4+col;return new ButtonBuilder().setCustomId(`hezz_e:memory:${g.id}:${idx}`).setLabel(g.matched.includes(idx)||g.selected.includes(idx)?g.cards[idx]:'❔').setStyle(g.matched.includes(idx)?ButtonStyle.Success:ButtonStyle.Secondary).setDisabled(g.matched.includes(idx)||g.finished)})))
const navalButtons=(g:Naval)=>[0,1,2,3,4].map(row=>new ActionRowBuilder<ButtonBuilder>().addComponents([0,1,2,3,4].map(col=>{const idx=row*5+col,attacker=g.turn%2;return new ButtonBuilder().setCustomId(`hezz_e:naval:${g.id}:${idx}`).setLabel(g.shots[attacker].includes(idx)?(g.boards[1-attacker].includes(idx)?'💥':'🌊'):`${String.fromCharCode(65+col)}${row+1}`).setStyle(ButtonStyle.Secondary).setDisabled(g.shots[attacker].includes(idx)||g.finished)})))
const checkWinner=(b:string[])=>{for(const [a,c,d] of [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]])if(b[a]&&b[a]===b[c]&&b[c]===b[d])return b[a];return b.every(Boolean)?'draw':''}
const shuffled=<T>(arr:T[])=>{const a=[...arr];for(let i=a.length-1;i>0;i--){const j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a}
const memorySymbols=['⚔️','🏰','🛡️','🐉','💎','🧪']
const mkPlayer=(cfg:Config):P=>({balance:Math.max(0,cfg.startingCoins||0),xp:0,level:1,inventory:{'pocao':1},equipment:'espada_madeira',lastDaily:'',cooldowns:{},day:utcDate(),dayEarned:0,week:isoWeek(),weekProgress:{},dayProgress:{},missionsClaimed:{},lifetimeEarned:0,redemptions:[]})
const player=(id:string,cfg:Config):P=>{const p=db.players[id]||(db.players[id]=mkPlayer(cfg));if(p.day!==utcDate()){p.day=utcDate();p.dayEarned=0;p.dayProgress={}}if(p.week!==isoWeek()){p.week=isoWeek();p.weekProgress={}}return p}
const lvlNeed=(n:number)=>n*120
function gainXp(p:P,amt:number){p.xp+=amt;while(p.xp>=lvlNeed(p.level)){p.xp-=lvlNeed(p.level);p.level++}}
function logCoins(id:string,delta:number,reason:string,cfg:Config){const p=player(id,cfg);if(!Number.isSafeInteger(delta)||p.balance+delta<0||!Number.isSafeInteger(p.balance+delta))throw Error('Saldo inválido');p.balance+=delta;if(delta>0)p.lifetimeEarned+=delta;db.transactions.push({id:randomUUID(),userId:id,delta,reason,time:Date.now(),balance:p.balance});if(db.transactions.length>12000)db.transactions.splice(0,db.transactions.length-12000);return p.balance}
function earn(id:string,coins:number,xp:number,kind:TaskKind,cfg:Config){const p=player(id,cfg);const available=Math.max(0,Math.max(0,cfg.dailyEarnCap||500)-p.dayEarned);const paid=Math.min(Math.max(0,coins),available);if(paid){logCoins(id,paid,kind,cfg);p.dayEarned+=paid}gainXp(p,xp);p.dayProgress[kind]=(p.dayProgress[kind]||0)+1;p.weekProgress[kind]=(p.weekProgress[kind]||0)+1;save();return paid}
const cooldown=(p:P,k:string,seconds:number)=>{const wait=Math.ceil(((p.cooldowns[k]||0)-Date.now())/1000);if(wait>0)return wait;p.cooldowns[k]=Date.now()+Math.max(1,seconds)*1000;return 0}
const games=['quiz','minerar','duelo','tesouro','boss'] as const
const quests=[{kind:'quiz',n:3,coins:120,xp:80},{kind:'minerar',n:3,coins:100,xp:60},{kind:'duelo',n:2,coins:140,xp:100},{kind:'tesouro',n:2,coins:90,xp:70}]
const wkQuest={n:20,coins:300,xp:150}
const quizPool=[
 ['Qual bloco é usado para construir um portal do Nether?',['Obsidiana','Pedregulho','Arenito','Granito'],0],
 ['Qual criatura pode lançar bolas de fogo no Nether?',['Vaca','Ghast','Ovelha','Morcego'],1],
 ['Qual minério é necessário para fabricar uma mesa de encantamentos?',['Cobre','Ferro','Diamante','Quartzo'],2],
 ['Qual item permite respirar debaixo d’água por mais tempo?',['Poção de Respiração Aquática','Maçã','Bússola','Mapa'],0],
 ['Qual é a dimensão do Ender Dragon?',['Nether','Overworld','End','Deep Dark'],2],
 ['O que é necessário para fazer uma picareta de ferro?',['3 barras de ferro e 2 gravetos','2 barras e 3 gravetos','1 diamante','3 madeiras e 1 lã'],0],
 ['Qual mob solta pólvora?',['Creeper','Villager','Cavalo','Golem de Ferro'],0],
 ['Para que serve uma bússola comum?',['Apontar para o spawn do mundo','Encontrar diamantes','Encontrar portais','Ver a vida dos mobs'],0]
] as [string,string[],number][]
const fmt=(n:number)=>n.toLocaleString('pt-BR')
const row=(id:string,labels:string[],style:ButtonStyle=ButtonStyle.Primary)=>new ActionRowBuilder<ButtonBuilder>().addComponents(labels.map((label,i)=>new ButtonBuilder().setCustomId(`hezz_e:${id}:${i}`).setStyle(style).setLabel(label.slice(0,80))))

opendiscord.events.get('onConfigLoad').listen(m=>{m.add(new api.ODJsonConfig('hezzuz-economy-games:config','config.json',root))})
opendiscord.events.get('afterClientReady').listen(async()=>{
 const cfg=opendiscord.configs.get('hezzuz-economy-games:config')?.data as Config|undefined
 if(!cfg?.enabled)return
 if(cfg.realDeliveryEnabled){console.error('[HEZZUZ Economy] realDeliveryEnabled não é suportado nesta versão; recusando inicialização por segurança.');return}
 if(!cfg.guildId){console.error('[HEZZUZ Economy] Configure guildId.');return}
 try{load(cfg)}catch(e){console.error('[HEZZUZ Economy]',String(e));return}
 const client=opendiscord.client.client
 const guild=await client.guilds.fetch(cfg.guildId).catch(()=>null)
 if(!guild){console.error('[HEZZUZ Economy] Discord guild não encontrado');return}
 const commands=[
  new SlashCommandBuilder().setName('hezzsaldo').setDescription('Veja sua carteira e seu nível RPG'),
  new SlashCommandBuilder().setName('hezzdiario').setDescription('Resgate sua recompensa diária'),
  new SlashCommandBuilder().setName('hezztrabalhar').setDescription('Trabalhe no reino e ganhe moedas'),
  new SlashCommandBuilder().setName('hezzquiz').setDescription('Responda um quiz Minecraft'),
  new SlashCommandBuilder().setName('hezzminerar').setDescription('Minere recursos e ganhe HezzCoins'),
  new SlashCommandBuilder().setName('hezzduelo').setDescription('Enfrente um inimigo em turnos'),
  new SlashCommandBuilder().setName('hezztesouro').setDescription('Explore um local e encontre tesouros'),
  new SlashCommandBuilder().setName('hezzboss').setDescription('Participe da batalha cooperativa contra o chefe'),
  new SlashCommandBuilder().setName('hezzmissoes').setDescription('Veja suas missões e resgate recompensas'),
  new SlashCommandBuilder().setName('hezzinventario').setDescription('Veja seus equipamentos e itens'),
  new SlashCommandBuilder().setName('hezzloja').setDescription('Abra a loja de equipamentos e recompensas'),
  new SlashCommandBuilder().setName('hezzranking').setDescription('Ranking de HezzCoins'),
  new SlashCommandBuilder().setName('hezzvelha').setDescription('Desafie alguém para Jogo da Velha').addUserOption(o=>o.setName('oponente').setDescription('Jogador desafiado').setRequired(true)),
  new SlashCommandBuilder().setName('hezzjokenpo').setDescription('Desafie alguém em Pedra, Papel e Tesoura').addUserOption(o=>o.setName('oponente').setDescription('Jogador desafiado').setRequired(true)),
  new SlashCommandBuilder().setName('hezzdesenho').setDescription('Inicie Desenhe e Adivinhe com uma imagem sua').addAttachmentOption(o=>o.setName('imagem').setDescription('Desenho feito por você (PNG ou JPEG)').setRequired(true)),
  new SlashCommandBuilder().setName('hezzadivinhar').setDescription('Tente adivinhar o desenho da rodada').addStringOption(o=>o.setName('resposta').setDescription('Palavra que representa o desenho').setRequired(true).setMaxLength(50)),
  new SlashCommandBuilder().setName('hezzjogos').setDescription('Central de jogos e guia da HEZZUZ'),
  new SlashCommandBuilder().setName('hezzforca').setDescription('Forca multiplayer com categorias e dificuldade').addStringOption(o=>o.setName('dificuldade').setDescription('Nível da rodada').addChoices({name:'Fácil',value:'facil'},{name:'Médio',value:'medio'},{name:'Difícil',value:'dificil'})),
  new SlashCommandBuilder().setName('hezzmemoria').setDescription('Jogue memória com 12 cartas interativas'),
  new SlashCommandBuilder().setName('hezznaval').setDescription('Desafie alguém para batalha naval 5x5').addUserOption(o=>o.setName('oponente').setDescription('Adversário').setRequired(true)),
  new SlashCommandBuilder().setName('hezztemporada').setDescription('Ranking mensal da Arena HEZZUZ'),
  new SlashCommandBuilder().setName('hezzpainel').setDescription('Publicar guias dos jogos (staff)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o=>o.setName('tipo').setDescription('Qual guia publicar?').addChoices({name:'Jogos Clássicos',value:'classicos'},{name:'RPG',value:'rpg'},{name:'Geral',value:'geral'})),
  new SlashCommandBuilder().setName('hezzvitorias').setDescription('Veja o ranking de vitórias dos minijogos PvP'),
  new SlashCommandBuilder().setName('hezzresgatar').setDescription('Solicite troca de moedas por PlayerPoints (fila de teste)').addIntegerOption(o=>o.setName('pontos').setDescription('Quantidade de PlayerPoints da oferta').setRequired(true)),
  new SlashCommandBuilder().setName('hezzadmin').setDescription('Auditoria da economia (administradores)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
   .addSubcommand(s=>s.setName('resgates').setDescription('Lista últimas solicitações de resgate'))
   .addSubcommand(s=>s.setName('auditoria').setDescription('Últimas transações'))
   .addSubcommand(s=>s.setName('cancelar').setDescription('Cancelar resgate de teste e devolver moedas').addStringOption(o=>o.setName('pedido').setDescription('UUID do resgate de teste').setRequired(true)))
   .addSubcommand(s=>s.setName('creditar').setDescription('Creditar moedas manualmente').addUserOption(o=>o.setName('usuario').setDescription('Usuário').setRequired(true)).addIntegerOption(o=>o.setName('moedas').setDescription('Quantidade positiva').setRequired(true).setMinValue(1).setMaxValue(10000)).addStringOption(o=>o.setName('motivo').setDescription('Motivo').setRequired(true)))
   .addSubcommand(s=>s.setName('debitar').setDescription('Debitar moedas manualmente').addUserOption(o=>o.setName('usuario').setDescription('Usuário').setRequired(true)).addIntegerOption(o=>o.setName('moedas').setDescription('Quantidade positiva').setRequired(true).setMinValue(1).setMaxValue(10000)).addStringOption(o=>o.setName('motivo').setDescription('Motivo').setRequired(true)))
 ]
 try{const existing=await guild.commands.fetch();for(const cmd of commands){const old=existing.find(x=>x.name===cmd.name);if(old)await old.edit(cmd.toJSON() as any);else await guild.commands.create(cmd.toJSON() as any)}}catch(e){console.error('[HEZZUZ Economy] Registro de comandos:',e)}
 const sections=[
 ['⚔️ Combate RPG',`/hezzduelo — enfrente monstros usando Atacar, Defender e Poção.
/hezzboss — colabore para derrotar o chefe.
/hezzvelha — Jogo da Velha contra outro jogador.
/hezzjokenpo — desafie outro jogador.`],
 ['🧩 Raciocínio',`/hezzquiz — responda perguntas de Minecraft.
/hezzforca — adivinhe letras com a comunidade.
/hezzmemoria — encontre seis pares de cartas.
/hezznaval — desafio naval 5×5, com navios ocultos.`],
 ['🎨 Comunidade',`/hezzdesenho — publique seu desenho e uma dica.
/hezzadivinhar — tente acertar o desenho.
/hezzvitorias — maiores vencedores da Arena.
/hezztemporada — classificação mensal.`],
 ['🪙 Economia',`/hezzsaldo — saldo e nível.
/hezzdiario — recompensa diária.
/hezztrabalhar — atividade de trabalho.
/hezzminerar e /hezztesouro — aventuras.
/hezzmissoes, /hezzloja, /hezzinventario e /hezzranking.
/hezzresgatar — pedido de troca em modo de TESTE; não entrega PlayerPoints.`]
 ]
 const guide=(idx=-1)=> idx<0?`🏰 **HEZZUZ — CENTRAL DE JOGOS**

⚔️ Dispute partidas públicas, ganhe HezzCoins e suba de nível.
📜 Escolha uma categoria abaixo para aprender as regras.
🪙 Ganhos respeitam o teto diário; partidas combinadas não geram recompensas ilimitadas.
💎 Resgate em PlayerPoints continua em TESTE.

📍 Use os comandos no canal oficial da Arena.`:sections[idx][0]+'\n\n'+sections[idx][1]
 const guideButtons=()=>[new ActionRowBuilder<ButtonBuilder>().addComponents(sections.map((q,j)=>new ButtonBuilder().setCustomId(`hezz_e:guide:${j}`).setLabel(q[0].slice(0,75)).setStyle(ButtonStyle.Primary))),new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('hezz_e:guide:home').setLabel('🏰 Página inicial').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('hezz_e:guide:games').setLabel('🎮 Iniciar jogo').setStyle(ButtonStyle.Success))]
 const gameMenu=()=> `🎮 **ESCOLHA UM JOGO**

❎ /hezzvelha oponente:@Jogador
⚓ /hezznaval oponente:@Jogador
✊ /hezzjokenpo oponente:@Jogador
🧩 /hezzforca
🧠 /hezzmemoria
⚔️ /hezzduelo
📜 /hezzquiz
🎨 /hezzdesenho

Digite o comando indicado no canal da Arena.`
 const publicWin=(userId:string,kind:TaskKind,coins:number,xp:number)=>{const e=extra();e.wins[userId]=(e.wins[userId]||0)+1;const sw=e.seasonWins||(e.seasonWins={});const m=sw[season()]||(sw[season()]={});m[userId]=(m[userId]||0)+1;let paid=0;if(Date.now()-(e.lastRewards[userId]||0)>=3600000){paid=earn(userId,coins,xp,kind,cfg);e.lastRewards[userId]=Date.now()}save();return paid}
 const safe=(i:any)=>i.reply({content:'⚠️ Não foi possível concluir. Veja os logs do HEZZUZ Bot.',flags:64}).catch(()=>{})
 const reply=async(i:any,message:string,privateMsg=true,components?:any[])=>{const isPrivate=privateMsg||cfg.publicGameMessages===false;const prefix=isPrivate?'':`👑 <@${i.user.id}>\n`;const options:any={content:(prefix+message).slice(0,1950),...(isPrivate?{flags:64}:{}),allowedMentions:{parse:[]}};if(components)options.components=components;await i.reply(options)}
 const staff=async(userId:string)=>{const m=await guild.members.fetch(userId).catch(()=>null);return Boolean(m&&(m.permissions.has(PermissionFlagsBits.Administrator)||cfg.staffRoleIds.some(r=>m.roles.cache.has(r))))}
 const classicNames=new Set(['hezzquiz','hezzvelha','hezzjokenpo','hezzdesenho','hezzadivinhar','hezzvitorias','hezzforca','hezzmemoria','hezznaval','hezztemporada'])
 const rpgNames=new Set(['hezzsaldo','hezzdiario','hezztrabalhar','hezzminerar','hezzduelo','hezztesouro','hezzboss','hezzmissoes','hezzinventario','hezzloja','hezzranking','hezzresgatar'])
 const classicActions=new Set(['ttt','rps','hangselect','memory','naval','quiz'])
 const rpgActions=new Set(['duel','missions','shop'])
 const isAllowed=(channelId:string,kind:'classic'|'rpg')=>{const ids=kind==='classic'?cfg.classicChannelIds:cfg.rpgChannelIds;return Array.isArray(ids)&&ids.length>0?ids.includes(channelId):(!cfg.gameChannelIds?.length||cfg.gameChannelIds.includes(channelId))}
 const channelAllowed=(channelId:string,kind:'classic'|'rpg')=>isAllowed(channelId,kind)
 const logAdmin=async(s:string)=>{if(!cfg.adminLogChannelId)return;const ch=await guild.channels.fetch(cfg.adminLogChannelId).catch(()=>null);if(ch&&'send'in ch)await (ch as any).send({content:s.slice(0,1900),allowedMentions:{parse:[]}}).catch(()=>{})}
 const showMissions=(p:P)=>{const r=quests.map(q=>{const k=`${p.day}:${q.kind}`;return `• ${q.kind}: ${Math.min(q.n,p.dayProgress[q.kind]||0)}/${q.n} ${p.missionsClaimed[k]?'✅':'—'} (+${q.coins} moedas)`});const total=games.reduce((n,g)=>n+(p.weekProgress[g]||0),0);return `📜 **Missões**\n${r.join('\n')}\n• Semana: ${Math.min(wkQuest.n,total)}/${wkQuest.n} ${p.missionsClaimed[p.week+':all']?'✅':'—'} (+${wkQuest.coins} moedas)\nUse **Resgatar missões** para pegar recompensas concluídas.`}
 const missionClaim=(id:string)=>{const p=player(id,cfg);let c=0,xp=0;for(const q of quests){const k=p.day+':'+q.kind;if((p.dayProgress[q.kind]||0)>=q.n&&!p.missionsClaimed[k]){p.missionsClaimed[k]=true;c+=q.coins;xp+=q.xp}}const total=games.reduce((n,g)=>n+(p.weekProgress[g]||0),0);if(total>=wkQuest.n&&!p.missionsClaimed[p.week+':all']){p.missionsClaimed[p.week+':all']=true;c+=wkQuest.coins;xp+=wkQuest.xp}const cap=Math.max(0,cfg.dailyEarnCap-p.dayEarned);const actual=Math.min(c,cap);if(actual){p.dayEarned+=actual;logCoins(id,actual,'missões',cfg)}gainXp(p,xp);save();return {coins:actual,xp}}
 const shop=[{id:'espada_ferro',cost:400,title:'⚔️ Espada de Ferro (ataque +6)'},{id:'espada_diamante',cost:1200,title:'💎 Espada de Diamante (ataque +12)'},{id:'pocao',cost:180,title:'🧪 Poção de Cura (+35 PV)'},{id:'escudo',cost:500,title:'🛡️ Escudo (+defesa)'}]
 const clearBattle=(id:string)=>{delete db.battles[id];save()}
 const bossRefresh=()=>{const now=Date.now();if(db.boss.endedAt&&now-db.boss.endedAt>=Math.max(1,cfg.bossResetHours||24)*3600000){db.boss=freshBoss(cfg.bossHp||1000);save()}}
 client.on('interactionCreate',async i=>{
  if(i.guildId!==cfg.guildId||(!i.isChatInputCommand()&&!i.isButton()&&!i.isStringSelectMenu()))return
  if(i.isChatInputCommand()&&!i.commandName.startsWith('hezz'))return
  if((i.isButton()||i.isStringSelectMenu())&&!i.customId.startsWith('hezz_e:'))return
  try{
   const id=i.user.id,p=player(id,cfg),name=cfg.currencyName||'HezzCoins'
   const command=i.isChatInputCommand()?i.commandName:''
   const action=(!i.isChatInputCommand()?i.customId.split(':')[1]:'')
   const kind=classicNames.has(command)||classicActions.has(action)?'classic':rpgNames.has(command)||rpgActions.has(action)?'rpg':null
   if(kind&&!channelAllowed(i.channelId,kind))return void await reply(i,kind==='classic'?'🎲 Use o canal de Jogos Clássicos.':'⚔️ Use o canal de RPG.',true)
   if(i.isButton()||i.isStringSelectMenu()){
    const parts=i.customId.split(':'),action=parts[1],arg=parts[2]
    // Button interactions can only affect their initiator; ids are saved server-side.
    if(action==='guide'){
     const idx=arg==='home'?-1:arg==='games'?-2:Number(arg)
     const message=idx===-2?gameMenu():idx===-1?guide():sections[idx]?guide(idx):guide()
     return void await i.reply({content:message,components:idx===-2?[]:guideButtons(),flags:64,allowedMentions:{parse:[]}})
    }
    if(action==='hangselect'){
     const e=extra();const h=e.hangman?.[arg];if(!h||h.finished||h.channelId!==i.channelId||Date.now()-h.created>12*60000)return void await reply(i,'Forca encerrada ou expirada.',true)
     const letter=i.isStringSelectMenu()?i.values[0]:'';if(!/^[a-z]$/.test(letter)||h.guessed.includes(letter))return void await reply(i,'Letra já utilizada.',true)
     h.guessed.push(letter);if(!h.word.includes(letter))h.wrong++
     const won=[...h.word].every(c=>h.guessed.includes(c));h.finished=won||h.wrong>=(h.maxWrong||6)
     if(won){h.players[id]=(h.players[id]||0)+1;publicWin(id,'quiz',h.difficulty==='dificil'?100:h.difficulty==='medio'?65:30,30)}save()
     const board=[...h.word].map(c=>h.guessed.includes(c)||h.finished?c.toUpperCase():'▢').join(' ')
     return void await i.update({content:`🧩 **FORCA HEZZUZ**\nDica: ${h.hint}\n${board}\nCategoria: ${h.category||'Minecraft'} • Dificuldade: ${h.difficulty||'medio'}\nErros: ${h.wrong}/${h.maxWrong||6}\n${won?`🏆 <@${id}> resolveu a palavra!`:h.finished?'💀 Acabaram as tentativas!':'Escolha uma letra:'}`,components:h.finished?[]:hangButtons(h),allowedMentions:{parse:[]}})
    }
    if(action==='memory'){
     const e=extra(),g=e.memory?.[arg];if(!g||g.finished||g.channelId!==i.channelId||Date.now()-g.created>15*60000)return void await reply(i,'Memória encerrada ou expirada.',true)
     if(g.owner!==id)return void await reply(i,'Esta partida pertence a outro jogador.',true)
     const at=Number(parts[3]);if(!Number.isInteger(at)||at<0||at>11||g.matched.includes(at)||g.selected.includes(at))return void await reply(i,'Carta indisponível.',true)
     if(g.selected.length===2){g.selected=[]}
     g.selected.push(at);if(g.selected.length===2){g.moves++;if(g.cards[g.selected[0]]===g.cards[g.selected[1]]){g.matched.push(...g.selected);g.selected=[]}}
     if(g.matched.length===12){g.finished=true;publicWin(id,'quiz',75,40)}save()
     return void await i.update({content:`🧠 **MEMÓRIA HEZZUZ** — <@${id}>\nJogadas: ${g.moves} • Pares: ${g.matched.length/2}/6${g.finished?'\n🏆 Concluiu a memória!':''}`,components:memoryButtons(g),allowedMentions:{parse:[]}})
    }
    if(action==='naval'){
     const e=extra(),g=e.naval?.[arg];if(!g||g.finished||g.channelId!==i.channelId||Date.now()-g.created>20*60000)return void await reply(i,'Batalha encerrada ou expirada.',true)
     const acting=g.turn%2;if(g.players[acting]!==id)return void await reply(i,'Aguarde seu turno.',true)
     const n=Number(parts[3]);if(!Number.isInteger(n)||n<0||n>24||g.shots[acting].includes(n))return void await reply(i,'Alvo inválido.',true)
     g.shots[acting].push(n);const hit=g.boards[1-acting].includes(n);const won=g.boards[1-acting].every(x=>g.shots[acting].includes(x));g.turn++;if(won){g.finished=true;publicWin(id,'duelo',100,60)}save()
     return void await i.update({content:`⚓ **BATALHA NAVAL HEZZUZ**\n<@${g.players[0]}> ⚔️ <@${g.players[1]}>\nÚltimo tiro de <@${id}>: ${String.fromCharCode(65+n%5)}${Math.floor(n/5)+1} — ${hit?'💥 ACERTOU':'🌊 Água'}\n${won?`🏆 Vitória de <@${id}>!`:`🎯 Vez de <@${g.players[g.turn%2]}>`}`,components:g.finished?[]:navalButtons(g),allowedMentions:{parse:[]}})
    }
    if(action==='ttt'){
     const e=extra(),g=Object.values(e.ttt).find(x=>x.id===arg)
     if(!g||g.finished||g.channelId!==i.channelId||Date.now()-g.created>20*60000)return void await reply(i,'Jogo da Velha encerrado ou expirado.',true)
     if(g.players[g.turn%2]!==id)return void await reply(i,'⏳ Aguarde sua vez. Apenas os dois jogadores podem participar.',true)
     const pos=Number(parts[3]);if(!Number.isInteger(pos)||pos<0||pos>8||g.board[pos])return void await reply(i,'Jogada inválida.',true)
     g.board[pos]=g.turn%2===0?'X':'O';g.turn++
     const result=checkWinner(g.board);if(result){g.finished=true;if(result!=='draw'){const winner=g.players[result==='X'?0:1];e.wins[winner]=(e.wins[winner]||0)+1;const last=e.lastRewards[winner]||0;if(Date.now()-last>3600000){earn(winner,65,35,'duelo',cfg);e.lastRewards[winner]=Date.now()}}save()}
     else save()
     const msg=result?(result==='draw'?'🤝 **Empate!**':`🏆 Vitória de <@${g.players[result==='X'?0:1]}>! (+65 HezzCoins, se elegível)`):`🎮 Vez de <@${g.players[g.turn%2]}> (${g.turn%2?'O':'X'})`
     return void await i.update({content:`⚔️ **JOGO DA VELHA — HEZZUZ**
<@${g.players[0]}> ❎ vs <@${g.players[1]}> ⭕
${msg}`,components:renderBoard(g),allowedMentions:{parse:[]}})
    }
    if(action==='rps'){
     const e=extra(),g=Object.values(e.rps).find(x=>x.id===arg)
     if(!g||g.channelId!==i.channelId||Date.now()-g.created>10*60000)return void await reply(i,'Partida encerrada ou expirada.',true)
     if(!g.players.includes(id))return void await reply(i,'Você não faz parte desta partida.',true)
     if(g.choices[id])return void await reply(i,'Você já escolheu! Aguarde o adversário.',true)
     const pick=parts[3];if(!['pedra','papel','tesoura'].includes(pick))return void await reply(i,'Escolha inválida.',true)
     g.choices[id]=pick
     const [a,b]=g.players
     if(g.choices[a]&&g.choices[b]){
      const one=g.choices[a],two=g.choices[b],win=one===two?'':(one==='pedra'&&two==='tesoura'||one==='papel'&&two==='pedra'||one==='tesoura'&&two==='papel')?a:b
      delete e.rps[g.id]
      if(win){e.wins[win]=(e.wins[win]||0)+1;if(Date.now()-(e.lastRewards[win]||0)>3600000){earn(win,40,25,'duelo',cfg);e.lastRewards[win]=Date.now()}}save()
      await i.reply({content:'✅ Escolha registrada.',flags:64})
      const ch=i.channel;if(ch&&'send'in ch)await ch.send({content:`✊ **JOKENPÔ HEZZUZ**
<@${a}>: ${one} | <@${b}>: ${two}
${win?`🏆 Vitória de <@${win}>!`:'🤝 Empate!'}`,allowedMentions:{parse:[]}})
     }else{save();await reply(i,'✅ Sua escolha é secreta. Aguardando o oponente.',true)}return
    }
    if(action==='quiz'){
     const q=db.quizzes[id];if(!q||q.id!==arg||Date.now()-q.startedAt>10*60000){if(q&&q.id===arg){delete db.quizzes[id];save()}return void await reply(i,'Este quiz expirou ou já foi concluído.',true)}
     const picked=Number(parts[3]);delete db.quizzes[id];const correct=picked===q.answer
     let earned=0;if(correct)earned=earn(id,55,35,'quiz',cfg);else{gainXp(p,5);save()}
     return void await reply(i,correct?`✅ Resposta certa! +${earned} ${name} e +35 XP.`:`❌ Resposta incorreta! +5 XP pela tentativa. Resposta: **${q.choices[q.answer]}**.`,false)
    }
    if(action==='duel'){
     const b=db.battles[id];if(!b||b.id!==arg||Date.now()-b.startedAt>20*60000){if(b&&b.id===arg)clearBattle(id);return void await reply(i,'Combate expirado.',true)}
     if(b.turn>15){clearBattle(id);return void await reply(i,'⚔️ O duelo terminou por limite de turnos.',true)}
     const op=parts[3],bonus=p.equipment==='espada_diamante'?12:p.equipment==='espada_ferro'?6:0
     if(op==='atk'){b.enemyHp-=randomInt(15,26)+bonus;b.guard=false}
     else if(op==='def'){b.guard=true}
     else if(op==='pot'){if((p.inventory.pocao||0)<1)return void await reply(i,'Você não tem poções.',true);p.inventory.pocao--;b.hp=Math.min(100,b.hp+35);b.guard=false}
     else return void await reply(i,'Ação inválida.',true)
     b.turn++
     if(b.enemyHp<=0){delete db.battles[id];const paid=earn(id,90,60,'duelo',cfg);return void await reply(i,`🏆 Vitória sobre ${b.enemy}! +${paid} ${name}, +60 XP.`,false)}
     const hit=randomInt(8,20);b.hp-=Math.max(1,hit-(b.guard?10:0)-(p.equipment==='escudo'?4:0));b.guard=false
     if(b.hp<=0){delete db.battles[id];gainXp(p,10);save();return void await reply(i,`💀 Derrota contra ${b.enemy}. +10 XP pela coragem!`,false)}
     save();return void await reply(i,`⚔️ **${b.enemy}** — Inimigo: ${Math.max(0,b.enemyHp)} PV | Você: ${b.hp} PV\nEscolha seu próximo movimento:`,false,[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`hezz_e:duel:${b.id}:atk`).setLabel('⚔️ Atacar').setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId(`hezz_e:duel:${b.id}:def`).setLabel('🛡️ Defender').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`hezz_e:duel:${b.id}:pot`).setLabel('🧪 Poção').setStyle(ButtonStyle.Success))])
    }
    if(action==='missions'){const result=missionClaim(id);return void await reply(i,result.coins||result.xp?`📜 Missões resgatadas: +${result.coins} ${name} e +${result.xp} XP.`:'Ainda não há missões concluídas para resgatar.',false)}
    if(action==='shop'){const item=shop.find(x=>x.id===arg);if(!item)return void await reply(i,'Item não encontrado.',true);if(p.balance<item.cost)return void await reply(i,`Saldo insuficiente: precisa de ${item.cost} ${name}.`,true);if(item.id.startsWith('espada')||item.id==='escudo'){if(p.equipment===item.id)return void await reply(i,'Você já usa esse equipamento.',true);p.equipment=item.id}else p.inventory[item.id]=(p.inventory[item.id]||0)+1;logCoins(id,-item.cost,'compra '+item.id,cfg);save();return void await reply(i,`✅ Comprado: ${item.title}. Gastou ${item.cost} ${name}.`,false)}
    return
   }
   const cmd=i.commandName
   if(cmd==='hezzadmin'){
    if(!await staff(id))return void await reply(i,'Apenas administração.',true)
    const sub=i.options.getSubcommand()
    if(sub==='resgates'){const rows=db.redemptions.slice(-15).reverse();return void await reply(i,rows.length?'💎 **Solicitações**\n'+rows.map(x=>`${x.id.slice(0,8)} • ${x.name} • ${x.points} pontos • ${x.status}`).join('\n'):'Sem solicitações.',true)}
    if(sub==='auditoria'){const rows=db.transactions.slice(-15).reverse();return void await reply(i,rows.length?'📜 **Últimas transações**\n'+rows.map(x=>`${x.userId} • ${x.delta>0?'+':''}${x.delta} • ${x.reason}`).join('\n'):'Nenhuma transação.',true)}
    if(sub==='cancelar'){const ref=i.options.getString('pedido',true);const r=db.redemptions.find(x=>x.id===ref);if(!r||r.status!=='TEST_PENDING')return void await reply(i,'Pedido não encontrado ou não está pendente.',true);r.status='CANCELLED';r.updatedAt=Date.now();logCoins(r.discordId,r.coins,'DEVOLUÇÃO RESGATE '+r.id,cfg);save();await logAdmin(`↩️ Resgate ${r.id} cancelado por ${id}; ${r.coins} moedas devolvidas a ${r.discordId}.`);return void await reply(i,`✅ Resgate ${r.id} cancelado, ${r.coins} HezzCoins devolvidas.`,true)}
    const u=i.options.getUser('usuario',true),n=i.options.getInteger('moedas',true),reason=i.options.getString('motivo',true).trim();if(reason.length<4)return void await reply(i,'Informe um motivo de pelo menos 4 caracteres.',true)
    const delta=sub==='creditar'?n:-n;if(delta<0&&player(u.id,cfg).balance<n)return void await reply(i,'Saldo insuficiente.',true)
    logCoins(u.id,delta,`ADMIN ${id}: ${reason}`,cfg);save();await logAdmin(`🛡️ ADMIN ${id} ${sub} ${n} moedas para ${u.id}. Motivo: ${reason}`);return void await reply(i,`✅ ${sub}: ${n} ${name} para ${u.username}.`,true)
   }
   if(cmd==='hezzvelha'||cmd==='hezzjokenpo'){
    const opp=i.options.getUser('oponente',true);if(opp.bot||opp.id===id)return void await reply(i,'Desafie outro jogador humano.',true)
    const e=extra(),versus:[string,string]=[id,opp.id]
    if(cmd==='hezzvelha'){
     if(Object.values(e.ttt).some(g=>!g.finished&&Date.now()-g.created<20*60000&&g.players.some(u=>versus.includes(u))))return void await reply(i,'Um dos jogadores já está em uma partida de Jogo da Velha.',true)
     const g:Ttt={id:randomUUID(),channelId:i.channelId,players:versus,board:Array(9).fill(''),turn:0,created:Date.now(),finished:false};e.ttt[g.id]=g;save()
     return void await reply(i,`⚔️ **JOGO DA VELHA**
<@${id}> ❎ desafia <@${opp.id}> ⭕
🎮 Vez de <@${id}>.`,false,renderBoard(g))
    }
    if(Object.values(e.rps).some(g=>Date.now()-g.created<10*60000&&g.players.some(u=>versus.includes(u))))return void await reply(i,'Um dos jogadores já está disputando Jokenpô.',true)
    const g:Rps={id:randomUUID(),channelId:i.channelId,players:versus,choices:{},created:Date.now()};e.rps[g.id]=g;save()
    const row=new ActionRowBuilder<ButtonBuilder>().addComponents(['pedra','papel','tesoura'].map(v=>new ButtonBuilder().setCustomId(`hezz_e:rps:${g.id}:${v}`).setLabel(v).setStyle(ButtonStyle.Primary)))
    return void await reply(i,`✊ **PEDRA, PAPEL E TESOURA**
<@${id}> vs <@${opp.id}>
Escolham sem revelar a jogada!`,false,[row])
   }
   if(cmd==='hezzdesenho'){
    const e=extra(),active=Object.values(e.sketch).find(x=>x.channelId===i.channelId&&!x.solvedBy&&Date.now()-x.created<8*60000)
    if(active)return void await reply(i,'Já existe uma rodada de desenho ativa neste canal.',true)
    const file=i.options.getAttachment('imagem',true);if(!/^image\/(png|jpeg|webp)$/.test(file.contentType||'')||file.size>5*1024*1024)return void await reply(i,'Use uma imagem PNG, JPEG ou WebP de até 5 MB.',true)
    const w=sketches[randomInt(sketches.length)],g:Sketch={id:randomUUID(),channelId:i.channelId,artist:id,word:w.word,hint:w.hint,imageUrl:file.url,created:Date.now()};e.sketch[g.id]=g;save()
    return void await reply(i,`🎨 **DESENHE E ADIVINHE**
Artista: <@${id}>
🧩 Dica: **${w.hint}**
🖼️ ${file.url}
⏱️ Vocês têm 8 minutos. Tentem com **/hezzadivinhar**!
⚠️ O artista deve enviar um desenho próprio que corresponda à dica.`,false)
   }
   if(cmd==='hezzadivinhar'){
    const e=extra(),g=Object.values(e.sketch).filter(x=>x.channelId===i.channelId&&!x.solvedBy&&Date.now()-x.created<8*60000).sort((a,b)=>b.created-a.created)[0]
    if(!g)return void await reply(i,'Não existe rodada ativa neste canal.',true)
    if(g.artist===id)return void await reply(i,'O artista não pode adivinhar sua própria palavra.',true)
    const guess=normalize(i.options.getString('resposta',true));if(guess!==normalize(g.word))return void await reply(i,'❌ Não foi desta vez. Tente novamente!',true)
    g.solvedBy=id;e.wins[id]=(e.wins[id]||0)+1;const winPaid=Date.now()-(e.lastRewards[id]||0)>3600000;if(winPaid){earn(id,70,40,'quiz',cfg);e.lastRewards[id]=Date.now()}save()
    return void await reply(i,`🎨 **DESENHO DESVENDADO!**
🏆 <@${id}> acertou **${g.word}**! ${winPaid?'(+HezzCoins, sujeito ao teto diário)':'(Recompensa em cooldown)'}`,false)
   }
   if(cmd==='hezzvitorias'){
    const list=Object.entries(extra().wins).sort((a,b)=>b[1]-a[1]).slice(0,10)
    return void await reply(i,`🏆 **VITÓRIAS DA ARENA**
${list.map(([u,n],pos)=>`${pos+1}. <@${u}> — ${n} vitórias`).join('\n')||'Ainda não há vitórias.'}`,false)
   }
   if(cmd==='hezzjogos')return void await reply(i,guide(),false,guideButtons())
   if(cmd==='hezzpainel'){
    if(!await staff(id))return void await reply(i,'Apenas staff pode publicar o painel.',true)
    const type=i.options.getString('tipo')||'geral'
    const channelId=type==='classicos'?cfg.classicPanelChannelId||cfg.classicChannelIds?.[0]:type==='rpg'?cfg.rpgPanelChannelId||cfg.rpgChannelIds?.[0]:cfg.gamePanelChannelId
    const messageId=type==='classicos'?cfg.classicPanelMessageId:type==='rpg'?cfg.rpgPanelMessageId:cfg.gamePanelMessageId
    const target=channelId?await guild.channels.fetch(channelId).catch(()=>null):i.channel
    if(!target||!('send'in target)||!('messages'in target))return void await reply(i,'Configure o ID do canal do painel com um canal de texto válido.',true)
    const classicGuide=`🎲 **HEZZUZ — JOGOS CLÁSSICOS**\n\n`+
     `🧩 /hezzforca dificuldade:facil|medio|dificil — adivinhe a palavra em grupo.\n`+
     `❎ /hezzvelha — jogo da velha PvP.\n⚓ /hezznaval — batalha naval 5x5.\n`+
     `✊ /hezzjokenpo — pedra, papel e tesoura.\n🧠 /hezzmemoria — encontre os pares.\n`+
     `📜 /hezzquiz — perguntas de Minecraft.\n🎨 /hezzdesenho e /hezzadivinhar — jogo de desenho.\n`+
     `🏆 /hezzvitorias e /hezztemporada — rankings.\n\n`+
     `👑 Use os comandos neste canal. As partidas são públicas e recompensas possuem limites diários.`
    const rpgGuide=`⚔️ **HEZZUZ — AVENTURAS RPG**\n\n`+
     `🪙 /hezzsaldo — carteira e nível.\n🎁 /hezzdiario — prêmio diário.\n`+
     `🔨 /hezztrabalhar — ganhe HezzCoins.\n⛏️ /hezzminerar — encontre minérios.\n`+
     `⚔️ /hezzduelo — combata monstros.\n🏹 /hezztesouro — expedição.\n`+
     `🐉 /hezzboss — chefe cooperativo.\n📜 /hezzmissoes — objetivos.\n`+
     `🎒 /hezzinventario — itens.\n🏪 /hezzloja — equipamento.\n🏆 /hezzranking — riqueza.\n`+
     `💎 /hezzresgatar — solicitação experimental; **não entrega PlayerPoints reais**.\n\n`+
     `👑 Progrida com atividades no canal RPG. Ganhos respeitam o teto diário.`
    const content=type==='classicos'?classicGuide:type==='rpg'?rpgGuide:guide()
    const components=type==='geral'?guideButtons():[]
    let message:any=null
    if(messageId)message=await (target as any).messages.fetch(messageId).catch(()=>null)
    if(message&&message.author.id===client.user.id)await message.edit({content,components,allowedMentions:{parse:[]}})
    else message=await (target as any).send({content,components,allowedMentions:{parse:[]}})
    return void await reply(i,`✅ Guia ${type} publicado em <#${target.id}>. Mensagem: ${message.id}\nFixe a mensagem pelo Discord. Para atualizar sem duplicar, adicione ${type==='classicos'?'classicPanelMessageId':type==='rpg'?'rpgPanelMessageId':'gamePanelMessageId'} ao config.json com esse ID.`,true)
   }
   if(cmd==='hezzforca'){
    const e=extra();e.hangman||(e.hangman={});if(Object.values(e.hangman).some(x=>x.channelId===i.channelId&&!x.finished&&Date.now()-x.created<12*60000))return void await reply(i,'Já há uma forca ativa neste canal.',true)
    const difficulty=(i.options.getString('dificuldade')||'medio') as Difficulty
    const pool=hangWords.filter(w=>w.difficulty===difficulty)
    const recent=e.recentHangWords||(e.recentHangWords=[])
    const available=pool.filter(w=>!recent.includes(w.word))
    const w=(available.length?available:pool)[randomInt((available.length?available:pool).length)]
    e.recentHangWords=[...recent.filter(x=>x!==w.word),w.word].slice(-Math.min(120,Math.floor(hangWords.length/3)))
    const maxWrong=difficulty==='facil'?8:difficulty==='medio'?6:4
    const h:Hangman={id:randomUUID(),channelId:i.channelId,word:w.word,hint:w.hint,guessed:[],wrong:0,created:Date.now(),finished:false,players:{},difficulty,maxWrong,category:w.category};e.hangman[h.id]=h;save()
    return void await reply(i,`🧩 **FORCA HEZZUZ**\nCategoria: ${w.category} • Dificuldade: ${difficulty}\nDica: ${w.hint}\n${'▢ '.repeat(w.word.length)}\nErros: 0/${maxWrong} — Escolha uma letra!`,false,hangButtons(h))
   }
   if(cmd==='hezzmemoria'){
    const e=extra();e.memory||(e.memory={});const cards=shuffled([...memorySymbols,...memorySymbols]);const g:MemoryGame={id:randomUUID(),owner:id,channelId:i.channelId,cards,matched:[],selected:[],moves:0,created:Date.now(),finished:false};e.memory[g.id]=g;save()
    return void await reply(i,`🧠 **MEMÓRIA HEZZUZ** — <@${id}>\nEncontre seis pares de cartas. Apenas o criador pode jogar.`,false,memoryButtons(g))
   }
   if(cmd==='hezznaval'){
    const u=i.options.getUser('oponente',true);if(u.bot||u.id===id)return void await reply(i,'Selecione um jogador diferente de você.',true)
    const e=extra();e.naval||(e.naval={});const g:Naval={id:randomUUID(),channelId:i.channelId,players:[id,u.id],boards:[shuffled([...Array(25).keys()]).slice(0,4),shuffled([...Array(25).keys()]).slice(0,4)],shots:[[],[]],turn:0,created:Date.now(),finished:false};e.naval[g.id]=g;save()
    return void await reply(i,`⚓ **BATALHA NAVAL HEZZUZ**\n<@${id}> ⚔️ <@${u.id}>\nQuatro navios secretos por jogador. Tabuleiro 5×5. Vence quem descobrir os quatro do adversário primeiro.\n🎯 Vez de <@${id}>`,false,navalButtons(g))
   }
   if(cmd==='hezztemporada'){
    const wins=Object.entries(extra().seasonWins?.[season()]||{}).sort((a,b)=>b[1]-a[1]).slice(0,10)
    return void await reply(i,`🏆 **TEMPORADA ${season()}**\n${wins.map(([u,n],idx)=>`${idx+1}. <@${u}> — ${n} vitórias`).join('\n')||'Sem vitórias na temporada.'}\nReinicia a classificação a cada mês; moedas e níveis permanecem.`,false)
   }
   if(cmd==='hezzsaldo')return void await reply(i,`👑 **Sua carteira HEZZUZ**\n🪙 ${fmt(p.balance)} ${name}\n⭐ Nível ${p.level} • XP ${p.xp}/${lvlNeed(p.level)}\n📅 Hoje: ${p.dayEarned}/${cfg.dailyEarnCap} moedas ganhas em atividades.`,false)
   if(cmd==='hezzdiario'){if(p.lastDaily===p.day)return void await reply(i,'🕒 Recompensa diária já resgatada hoje (UTC).',true);p.lastDaily=p.day;const paid=earn(id,cfg.dailyCoins||75,30,'tesouro',cfg);return void await reply(i,`🎁 Recompensa diária: +${paid} ${name} e +30 XP!`,false)}
   if(cmd==='hezztrabalhar'){const wait=cooldown(p,'work',1800);if(wait)return void await reply(i,`⏳ Você poderá trabalhar novamente em ${wait} segundos.`,true);const paid=earn(id,randomInt(40,76),20,'tesouro',cfg);return void await reply(i,`🔨 Você ajudou a reconstruir as muralhas! +${paid} ${name} e +20 XP.`,false)}
   if(cmd==='hezzquiz'){const wait=cooldown(p,'quiz',cfg.cooldownSeconds||35);if(wait)return void await reply(i,`⏳ Próximo quiz em ${wait}s.`,true);const picked=quizPool[randomInt(quizPool.length)];const q:Quiz={id:randomUUID(),userId:id,answer:picked[2],startedAt:Date.now(),question:picked[0],choices:picked[1]};db.quizzes[id]=q;save();return void await reply(i,`🧠 **Quiz HEZZUZ**\n${q.question}`,false,[new ActionRowBuilder<ButtonBuilder>().addComponents(q.choices.map((x,idx)=>new ButtonBuilder().setCustomId(`hezz_e:quiz:${q.id}:${idx}`).setLabel(x.slice(0,75)).setStyle(ButtonStyle.Secondary)))])}
   if(cmd==='hezzminerar'){const wait=cooldown(p,'mining',cfg.cooldownSeconds||35);if(wait)return void await reply(i,`⏳ Aguarde ${wait}s antes de minerar novamente.`,true);const dice=randomInt(100);const ore=dice<55?'carvao':dice<82?'ferro':dice<96?'ouro':'diamante';const coins=ore==='diamante'?100:ore==='ouro'?65:ore==='ferro'?35:15;p.inventory[ore]=(p.inventory[ore]||0)+1;const paid=earn(id,coins,25,'minerar',cfg);return void await reply(i,`⛏️ Você encontrou **${ore}**! +${paid} ${name} e +25 XP.`,false)}
   if(cmd==='hezzduelo'){const current=db.battles[id];if(current&&Date.now()-current.startedAt<20*60000)return void await reply(i,'Você já tem um duelo ativo. Termine-o antes de iniciar outro.',true);const wait=cooldown(p,'duel',120);if(wait)return void await reply(i,`⏳ Próximo duelo em ${wait}s.`,true);const b:Battle={id:randomUUID(),userId:id,enemy:['Esqueleto Sombrio','Saqueador do Norte','Cavaleiro das Sombras'][randomInt(3)],hp:100,enemyHp:65,guard:false,turn:0,startedAt:Date.now()};db.battles[id]=b;save();return void await reply(i,`⚔️ **${b.enemy}** desafiou você!\n❤️ Seus PV: 100 • PV do inimigo: 65`,false,[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`hezz_e:duel:${b.id}:atk`).setLabel('⚔️ Atacar').setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId(`hezz_e:duel:${b.id}:def`).setLabel('🛡️ Defender').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`hezz_e:duel:${b.id}:pot`).setLabel('🧪 Poção').setStyle(ButtonStyle.Success))])}
   if(cmd==='hezztesouro'){const wait=cooldown(p,'treasure',600);if(wait)return void await reply(i,`⏳ Nova expedição em ${wait}s.`,true);const scene=['Ruínas de Valdoria','Cripta dos Antigos','Floresta Nebulosa'][randomInt(3)];const paid=earn(id,randomInt(30,91),30,'tesouro',cfg);return void await reply(i,`🏹 Você explorou **${scene}** e encontrou um baú abandonado. +${paid} ${name}, +30 XP.`,false)}
   if(cmd==='hezzboss'){bossRefresh();const boss=db.boss;if(boss.endedAt)return void await reply(i,'🐉 O chefe já foi derrotado. Um novo chefe surgirá após o período de descanso.',true);const wait=Math.ceil(((boss.lastAttack[id]||0)+30000-Date.now())/1000);if(wait>0)return void await reply(i,`⏳ Aguarde ${wait}s para atacar novamente.`,true);const hit=randomInt(12,31)+(p.equipment==='espada_diamante'?12:p.equipment==='espada_ferro'?6:0);boss.lastAttack[id]=Date.now();boss.participants[id]=(boss.participants[id]||0)+hit;boss.hp=Math.max(0,boss.hp-hit);const paid=earn(id,20,25,'boss',cfg);if(boss.hp===0){boss.endedAt=Date.now();for(const uid of Object.keys(boss.participants)){const pp=player(uid,cfg);gainXp(pp,75)}save();await logAdmin(`🐉 Chefe derrotado. Participantes: ${Object.keys(boss.participants).length}.`)}return void await reply(i,`🐉 Você causou **${hit} dano**! Chefe: ${boss.hp}/${boss.maxHp} PV. +${paid} ${name} e +25 XP.${boss.endedAt?'\n🏆 Chefe derrotado! Todos os participantes ganharam +75 XP.':''}`,false)}
   if(cmd==='hezzmissoes')return void await reply(i,showMissions(p),false,[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('hezz_e:missions:claim').setLabel('📜 Resgatar missões').setStyle(ButtonStyle.Success))])
   if(cmd==='hezzinventario')return void await reply(i,`🎒 **Inventário HEZZUZ**\nEquipamento: **${p.equipment}**\n${Object.entries(p.inventory).filter(([,n])=>n>0).map(([k,v])=>`${k}: ${v}`).join('\n')||'Vazio'}`,false)
   if(cmd==='hezzloja')return void await reply(i,`🏪 **Arsenal dos Reinos**\nSaldo: ${fmt(p.balance)} ${name}\n${shop.map((x,idx)=>`${idx+1}. ${x.title} — ${x.cost} moedas`).join('\n')}\nItens são cosméticos da economia do bot / equipamentos dos minijogos.`,false,shop.map(x=>new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`hezz_e:shop:${x.id}`).setLabel(`Comprar ${x.id} (${x.cost})`).setStyle(ButtonStyle.Success))))
   if(cmd==='hezzranking'){const rank=Object.entries(db.players).sort((a,b)=>b[1].balance-a[1].balance).slice(0,10);return void await reply(i,`🏆 **Mais ricos da HEZZUZ**\n${rank.map(([uid,ps],ix)=>`${ix+1}. <@${uid}> — ${fmt(ps.balance)} ${name}`).join('\n')||'Nenhum registro.'}`,false)}
   if(cmd==='hezzresgatar'){
    if(!cfg.redemptionEnabled)return void await reply(i,'Resgates temporariamente indisponíveis.',true)
    const pts=i.options.getInteger('pontos',true),offer=cfg.redemptionOffers.find(o=>o.points===pts&&o.coins>0&&o.points>0&&Number.isSafeInteger(o.coins)&&Number.isSafeInteger(o.points));if(!offer)return void await reply(i,'Oferta não encontrada. Opções: '+cfg.redemptionOffers.map(o=>`${fmt(o.coins)} moedas → ${o.points} pontos`).join('; '),true)
    const links=getLinkDB().links.filter(x=>x.discordId===id);if(links.length!==1)return void await reply(i,'É necessário ter exatamente uma conta Minecraft vinculada pelo HEZZUZ Link.',true)
    const link=links[0];if(db.redemptions.some(r=>r.uuid===link.uuid&&r.status==='TEST_PENDING'))return void await reply(i,'Você já possui um resgate em análise. Não é possível fazer outro.',true)
    if(db.redemptions.filter(r=>r.discordId===id&&new Date(r.createdAt).toISOString().slice(0,10)===utcDate()&&r.status!=='CANCELLED').length>=Math.max(1,cfg.redemptionsPerDay||1))return void await reply(i,'Limite diário de resgates atingido.',true)
    if(p.balance<offer.coins)return void await reply(i,`Saldo insuficiente: ${fmt(p.balance)}/${fmt(offer.coins)} ${name}.`,true)
    logCoins(id,-offer.coins,`RESGATE TESTE ${pts} PlayerPoints`,cfg)
    const redemption:Redemption={id:randomUUID(),discordId:id,uuid:link.uuid,name:link.name,coins:offer.coins,points:pts,status:'TEST_PENDING',createdAt:Date.now(),updatedAt:Date.now()};db.redemptions.push(redemption);p.redemptions.push(redemption.id);save();await logAdmin(`💎 Resgate de TESTE ${redemption.id}: ${link.name} (${id}) solicitou ${pts} PlayerPoints por ${offer.coins} ${name}. Nenhuma entrega automática.`)
    return void await reply(i,`💎 **Resgate registrado para conferência**\nPedido: \`${redemption.id}\`\nJogador: **${link.name}**\nCusto: ${fmt(offer.coins)} ${name}\nRecompensa pretendida: **${pts} PlayerPoints**\n⏳ Status: **TEST_PENDING**. **Nenhum ponto foi creditado no Survival.**`,true)
   }
  }catch(e){console.error('[HEZZUZ Economy] interação:',e);if(i.isRepliable()&&!i.replied&&!i.deferred)await safe(i)}
 })
 console.log('[HEZZUZ Economy & Games] RPG iniciado. Entrega real de PlayerPoints DESATIVADA; resgates em fila de teste.')
})
