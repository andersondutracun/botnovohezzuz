import { api, opendiscord } from '#opendiscord'
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } from 'discord.js'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const ROOT = './plugins/hezzuz-admin/'
type Cfg = {enabled: boolean; guildId: string; staffRoleIds?: string[]; linkedRoleId: string; linkStoragePath: string; minecraftConfigPath: string; minecraftStatePath: string; maxSyncPerRun?: number}
const readJson = (file: string): any => JSON.parse(readFileSync(file, 'utf8'))
const allModules = (): {id:string; enabled:boolean; valid:boolean}[] => {
  const root = './plugins/'
  return readdirSync(root, {withFileTypes:true}).filter(x=>x.isDirectory() && x.name.startsWith('hezzuz-')).map(x=>{
    const file = `${root}${x.name}/plugin.json`
    try {const p=readJson(file);return {id:x.name,enabled:p.enabled!==false,valid:true}}
    catch{return {id:x.name,enabled:false,valid:false}}
  })
}
const shorten = (s:string,n=1900)=>s.length>n?s.slice(0,n-20)+'\n...(resumo truncado)':s

opendiscord.events.get('onConfigLoad').listen(manager=>{ manager.add(new api.ODJsonConfig('hezzuz-admin:config','config.json',ROOT)) })
opendiscord.events.get('afterClientReady').listen(async()=>{
  const cfg=opendiscord.configs.get('hezzuz-admin:config')?.data as Cfg|undefined
  if(!cfg?.enabled) return
  const client=opendiscord.client.client
  const resolvedGuild=await client.guilds.fetch(cfg.guildId).catch(()=>null)
  if(!resolvedGuild){console.warn('[HEZZUZ Admin] Servidor Discord nao encontrado.');return}
  const guild=resolvedGuild
  const isStaff=async (i:any):Promise<boolean>=>{
    if(i.memberPermissions?.has(PermissionFlagsBits.Administrator) || i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return true
    if(!cfg.staffRoleIds?.length)return false
    const member=await guild.members.fetch(i.user.id).catch(()=>null)
    return !!member && cfg.staffRoleIds.some(id=>member.roles.cache.has(id))
  }
  const respond=async (i:any, content:string)=>{
    if(i.deferred||i.replied) await i.editReply({content:shorten(content)})
    else await i.reply({content:shorten(content),ephemeral:true})
  }
  const commands = new SlashCommandBuilder().setName('hezzuz').setDescription('Central de administracao HEZZUZ')
    .addSubcommand(x=>x.setName('ajuda').setDescription('Lista comandos e modulos'))
    .addSubcommand(x=>x.setName('status').setDescription('Resumo do bot e integracoes'))
    .addSubcommand(x=>x.setName('versao').setDescription('Versao da central e modulos'))
    .addSubcommand(x=>x.setName('diagnostico').setDescription('Verifica configuracoes e arquivos locais'))
    .addSubcommand(x=>x.setName('painel').setDescription('Painel administrativo privado'))
    .addSubcommand(x=>x.setName('sincronizar').setDescription('Reconcilia cargo de contas vinculadas').addBooleanOption(o=>o.setName('confirmar').setDescription('Necessario verdadeiro para aplicar alteracoes').setRequired(true)))
  try{
    const list=await guild.commands.fetch()
    const prior=list.find(x=>x.name==='hezzuz')
    if(prior) await prior.edit(commands.toJSON() as any)
    else await guild.commands.create(commands.toJSON() as any)
  }catch(e){console.error('[HEZZUZ Admin] Registro de comando falhou:',e)}

  function diag():string {
    const modules=allModules()
    const malformed=modules.filter(m=>!m.valid).map(m=>m.id)
    let links='indisponivel', minecraft='indisponivel', panel='nao verificado'
    try {const db=readJson(cfg!.linkStoragePath);links=Array.isArray(db.links)?String(db.links.length)+' vinculos':'estrutura inesperada'}catch{}
    try {const mc=readJson(cfg!.minecraftConfigPath);minecraft=mc.enabled?'habilitado':'desabilitado';if(mc.channelId)panel='canal configurado'}catch{}
    let snapshot='arquivo nao encontrado'
    try {const state=readJson(cfg!.minecraftStatePath);snapshot='presente (sem garantia de atualizacao recente)';if(state?.updatedAt && Number.isFinite(Number(state.updatedAt)))snapshot+='; timestamp '+new Date(Number(state.updatedAt)).toISOString()}catch{}
    return `🛡️ **HEZZUZ — Diagnostico local**\nPlugins HEZZUZ: ${modules.length} (${modules.filter(m=>m.enabled).length} habilitados)\nJSON de plugins invalido: ${malformed.length?malformed.join(', '):'nenhum'}\nVinculacoes: ${links}\nMinecraft: ${minecraft}; painel: ${panel}\nEstado local Minecraft: ${snapshot}\n⚠️ Verifica arquivos locais; nao testa conectividade HTTPS, Velocity ou permissao de todos os canais.`
  }
  function list():string {
    const mods=allModules();return `👑 **HEZZUZ — Modulos instalados**\n`+mods.map(m=>`${m.valid?(m.enabled?'✅':'⏸️'):'⚠️'} ${m.id}`).join('\n')
  }
  const helpText=`📜 **Guia rapido da HEZZUZ**\n• Moderação: /warn, /warnings, /unwarn, /kick, /ban, /timeout, /untimeout, /clear, /modhistory, /appealinfo\n• Minecraft: /minecrafthezzuz, /vincular, /conta, /desvincular\n• Comunidade: /sorteio, /eventohezzuz, /anunciar, /cargoopcional, /estatisticashezzuz, /rankingcontador\n• Administracao: /hezzuz status, /hezzuz diagnostico, /hezzuz versao, /hezzuz painel, /hezzuz sincronizar\nO Discord mostra somente os comandos efetivamente registrados e autorizados.`
  async function syncRoles():Promise<string>{
    const db=readJson(cfg!.linkStoragePath)
    if(!Array.isArray(db.links))return 'Arquivo de vinculos invalido.'
    const role=await guild.roles.fetch(cfg!.linkedRoleId).catch(()=>null)
    const self=await guild.members.fetchMe().catch(()=>null)
    if(!role||!self)return 'Cargo vinculado ou permissao do bot indisponivel.'
    if(!self.permissions.has(PermissionFlagsBits.ManageRoles) || self.roles.highest.comparePositionTo(role)<=0)return 'O bot precisa de Gerenciar Cargos e estar acima do cargo vinculado.'
    let added=0, removed=0, skipped=0, failed=0
    const pairs=new Set<string>(db.links.filter((x:any)=>typeof x.discordId==='string').map((x:any)=>x.discordId))
    const max=Math.min(500,Math.max(1,cfg!.maxSyncPerRun||100))
    const links=db.links.slice(0,max)
    // Reconcilia somente vinculados conhecidos; nao remove cargos de desconhecidos por seguranca.
    for(const entry of links){
      if(!entry||typeof entry.discordId!=='string'){skipped++;continue}
      const member=await guild.members.fetch(entry.discordId).catch(()=>null)
      if(!member){skipped++;continue}
      if(member.roles.cache.has(cfg!.linkedRoleId)){skipped++;continue}
      try{await member.roles.add(role,'HEZZUZ Admin: reconciliacao de vinculo Minecraft');added++}catch{failed++}
    }
    return `🔗 **Sincronizacao finalizada**\nVinculos lidos: ${db.links.length}; processados: ${links.length}\nCargos adicionados: ${added}; ja corretos/ausentes: ${skipped}; falhas: ${failed}\nNenhum cargo foi removido. Para remover cargos de desvinculados, use /desvincular ou execute uma auditoria separada. ${db.links.length>max?'\n⚠️ Limite por execucao atingido.':''}`
  }
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('hezzuz_admin:status').setLabel('Status').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('hezzuz_admin:diag').setLabel('Diagnostico').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('hezzuz_admin:modules').setLabel('Modulos').setStyle(ButtonStyle.Secondary)
  )
  client.on(Events.InteractionCreate, async i=>{
    if(i.guildId!==cfg.guildId)return
    if(i.isButton() && i.customId.startsWith('hezzuz_admin:')){
      if(!await isStaff(i))return void await respond(i,'Sem permissao.')
      const action=i.customId.split(':')[1]
      return void await respond(i,action==='diag'?diag():action==='modules'?list():`✅ HEZZUZ Bot conectado ao Discord.\n${list()}`)
    }
    if(!i.isChatInputCommand()||i.commandName!=='hezzuz')return
    try{
      const sub=i.options.getSubcommand()
      if(sub==='ajuda')return void await respond(i,helpText)
      if(!await isStaff(i))return void await respond(i,'🔒 Central reservada a administradores e cargos autorizados.')
      if(sub==='diagnostico')return void await respond(i,diag())
      if(sub==='status')return void await respond(i,`✅ Bot conectado ao Discord.\n${list()}`)
      if(sub==='versao')return void await respond(i,'HEZZUZ Admin 3.1.0 | Open Ticket 4.1.x | Diagnostico local (sem consulta remota).')
      if(sub==='sincronizar'){
        if(!i.options.getBoolean('confirmar',true))return void await respond(i,'Nada alterado. Informe confirmar: verdadeiro para sincronizar.')
        await i.deferReply({ephemeral:true})
        return void await respond(i,await syncRoles())
      }
      if(sub==='painel')return void await i.reply({ephemeral:true,embeds:[new EmbedBuilder().setColor(0xD4AF37).setTitle('👑 HEZZUZ | Central de Administracao').setDescription('Painel privado de consulta. A sincronizacao de cargos exige comando e confirmacao.')],components:[actions]})
    }catch(err){console.error('[HEZZUZ Admin]',err);if(i.isRepliable()){
      if(i.deferred||i.replied)await i.editReply({content:'Nao foi possivel concluir a operacao.'}).catch(()=>{})
      else await i.reply({content:'Nao foi possivel concluir a operacao.',ephemeral:true}).catch(()=>{})
    }}
  })
})
