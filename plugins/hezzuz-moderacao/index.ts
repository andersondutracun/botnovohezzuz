import { api, opendiscord } from '#opendiscord'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import {
  Events, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, MessageFlags,
  type Guild, type GuildMember, type TextChannel, type ChatInputCommandInteraction,
  type Message, type PartialMessage, type User, type ApplicationCommandData
} from 'discord.js'

type Config = {
  enabled: boolean; guildId: string; generalLogsChannelId: string;
  moderationLogsChannelId: string; ticketLogsChannelId: string;
  moderatorRoleIds: string[]; administratorRoleIds: string[];
  trackMessageEdits: boolean; trackMessageDeletes: boolean;
  trackMemberRoles: boolean; trackJoinsAndLeaves: boolean;
  storeWarningsFile: string;
  historyFile?: string; appealChannelId?: string;
  progressive?: { enabled: boolean; timeoutAtWarnings: Record<string, number> }
}
type Warning = { id: number; reason: string; moderatorId: string; createdAt: string }
type WarningDB = Record<string, Warning[]>

opendiscord.events.get('onConfigLoad').listen(manager => {
  manager.add(new api.ODJsonConfig('hezzuz-moderacao:config', 'config.json', './plugins/hezzuz-moderacao/'))
})

opendiscord.events.get('afterClientReady').listen(async () => {
  const config = opendiscord.configs.get('hezzuz-moderacao:config')?.data as Config | undefined
  if (!config?.enabled) return
  const client = opendiscord.client.client
  const guild = await client.guilds.fetch(config.guildId).catch(() => null)
  if (!guild) { opendiscord.log('HEZZUZ Moderação: servidor não encontrado', 'error'); return }
  const flag = MessageFlags.Ephemeral
  const path = config.storeWarningsFile || './plugins/hezzuz-moderacao/warnings.json'
  const load = (): WarningDB => {
    try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as WarningDB : {} }
    catch { opendiscord.log('HEZZUZ Moderação: falha lendo warnings.json', 'error'); return {} }
  }
  const save = (db: WarningDB) => writeFileSync(path, JSON.stringify(db, null, 2), 'utf8')
  type HistoryRecord = { userId: string; moderatorId: string; action: string; reason: string; date: string; details?: string }
  const historyPath = config.historyFile || './plugins/hezzuz-moderacao/history.json'
  const historyLoad = (): HistoryRecord[] => {
    try { return existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, 'utf8')) as HistoryRecord[] : [] }
    catch { opendiscord.log('HEZZUZ Moderação: falha ao ler histórico', 'error'); return [] }
  }
  const recordHistory = (data: Omit<HistoryRecord, 'date'>) => {
    try {
      const all = historyLoad()
      all.push({ ...data, date: new Date().toISOString() })
      writeFileSync(historyPath, JSON.stringify(all.slice(-10000), null, 2), 'utf8')
    } catch (err) { opendiscord.log(`HEZZUZ Moderação: falha ao salvar histórico: ${String(err)}`, 'error') }
  }
  const log = async (channelId: string, title: string, content: string, color = 0xD4A747) => {
    if (!channelId) return
    const channel = await guild.channels.fetch(channelId).catch(() => null)
    if (!channel?.isTextBased() || !('send' in channel)) return
    const embed = new EmbedBuilder().setTitle(title).setDescription(content.slice(0, 3900))
      .setColor(color).setTimestamp()
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {})
  }
  const general = (title: string, body: string) => log(config.generalLogsChannelId, title, body)
  const modlog = (title: string, body: string) => log(config.moderationLogsChannelId, title, body, 0xCC3333)
  // Notificações privadas: falhas de DM nunca bloqueiam uma punição.
  const notifyMember = async (user: User, action: string, reason: string, moderatorName: string, duration?: string) => {
    const embed = new EmbedBuilder()
      .setColor(0xB33636)
      .setTitle(`🛡️ HEZZUZ — ${action}`)
      .setDescription('Você recebeu uma notificação da equipe de moderação da **Rede HEZZUZ**.')
      .addFields(
        { name: 'Motivo', value: reason.slice(0, 1024) || 'Não informado' },
        { name: 'Responsável', value: moderatorName.slice(0, 1024) }
      )
      .setFooter({ text: 'Para solicitar revisão, entre em contato com a equipe de suporte da HEZZUZ.' })
      .setTimestamp()
    if (duration) embed.addFields({ name: 'Duração', value: duration })
    if (config.appealChannelId) embed.addFields({ name: 'Solicitar revisão', value: `Acesse o canal <#${config.appealChannelId}> no Discord da HEZZUZ e abra um ticket de recurso.` })
    try {
      await user.send({ embeds: [embed], allowedMentions: { parse: [] } })
      return true
    } catch {
      return false // DMs bloqueadas, usuário desativado ou bot sem acesso.
    }
  }
  const dmStatus = (sent: boolean) => sent ? '✅ DM enviada' : '⚠️ DM não entregue (privacidade/indisponível)'
  const canModerate = (interaction: ChatInputCommandInteraction) => {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
        interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) return true
    const roles = (interaction.member && 'roles' in interaction.member) ? interaction.member.roles : null
    const ids: string[] = roles ? (Array.isArray(roles) ? roles : roles.cache.map(r => r.id)) : []
    return ids.some(id => [...(config.moderatorRoleIds || []), ...(config.administratorRoleIds || [])].includes(id))
  }
  const commands = [
    new SlashCommandBuilder().setName('warn').setDescription('Adverte um membro')
      .addUserOption(o => o.setName('usuario').setDescription('Membro').setRequired(true))
      .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true)),
    new SlashCommandBuilder().setName('warnings').setDescription('Lista advertências')
      .addUserOption(o => o.setName('usuario').setDescription('Membro').setRequired(true)),
    new SlashCommandBuilder().setName('unwarn').setDescription('Remove uma advertência')
      .addUserOption(o => o.setName('usuario').setDescription('Membro').setRequired(true))
      .addIntegerOption(o => o.setName('id').setDescription('Número da advertência').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder().setName('kick').setDescription('Expulsa um membro')
      .addUserOption(o => o.setName('usuario').setDescription('Membro').setRequired(true))
      .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true)),
    new SlashCommandBuilder().setName('ban').setDescription('Bane um usuário')
      .addUserOption(o => o.setName('usuario').setDescription('Usuário').setRequired(true))
      .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true)),
    new SlashCommandBuilder().setName('timeout').setDescription('Silencia um membro temporariamente')
      .addUserOption(o => o.setName('usuario').setDescription('Membro').setRequired(true))
      .addIntegerOption(o => o.setName('minutos').setDescription('Duração (1 a 40320 minutos)').setRequired(true).setMinValue(1).setMaxValue(40320))
      .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true)),
    new SlashCommandBuilder().setName('untimeout').setDescription('Remove o timeout')
      .addUserOption(o => o.setName('usuario').setDescription('Membro').setRequired(true)),
    new SlashCommandBuilder().setName('modhistory').setDescription('Consulta histórico de moderação (staff)')
      .addUserOption(o => o.setName('usuario').setDescription('Usuário').setRequired(true)),
    new SlashCommandBuilder().setName('appealinfo').setDescription('Instruções para recorrer de uma punição'),
    new SlashCommandBuilder().setName('clear').setDescription('Exclui mensagens recentes (até 100, menos de 14 dias)')
      .addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade (1 a 100)').setRequired(true).setMinValue(1).setMaxValue(100))
  ]
  try {
    const existing = await guild.commands.fetch()
    for (const command of commands) {
      const current = existing.find(c => c.name === command.name)
      // Use a API-compatible payload. Builder.options contains builder types,
      // not the serialized API options expected by the create endpoint.
      const data = command.toJSON()
      if (current) await current.edit(data as ApplicationCommandData)
      else await guild.commands.create(data)
    }
  } catch (error) { opendiscord.log(`HEZZUZ Moderação: falha ao registrar comandos: ${String(error)}`, 'error') }

  client.on(Events.InteractionCreate, async event => {
    if (!event.isChatInputCommand() || event.guildId !== config.guildId || !commands.some(c => c.name === event.commandName)) return
    const interaction = event
    if (!canModerate(interaction)) {
      await interaction.reply({ content: '⛔ Você não tem permissão de moderação.', flags: flag }); return
    }
    try {
      await interaction.deferReply({ flags: flag })
      const target = interaction.options.getUser('usuario')
      const reason = interaction.options.getString('motivo') || 'Sem motivo informado'
      const actor = await guild.members.fetch(interaction.user.id).catch(() => null)
      const moderatorName = actor?.displayName || interaction.user.globalName || interaction.user.username
      const member = target ? await guild.members.fetch(target.id).catch(() => null) : null
      const okTarget = (): string | null => {
        if (!target || !member) return 'Membro não encontrado neste servidor.'
        if (target.id === guild.ownerId || target.id === interaction.user.id) return 'Você não pode aplicar essa ação a esse membro.'
        if (!member.moderatable || (actor && actor.id !== guild.ownerId && actor.roles.highest.comparePositionTo(member.roles.highest) <= 0))
          return 'Hierarquia ou permissões impedem essa ação.'
        return null
      }
      let result = ''
      const cmd = interaction.commandName
      if (cmd === 'appealinfo') {
        result = config.appealChannelId
          ? `📩 Para recorrer, acesse <#${config.appealChannelId}> e abra um ticket. Explique sua situação e informe a punição.`
          : '📩 Entre em contato com a equipe de suporte para solicitar revisão de punições.'
      } else if (cmd === 'modhistory' && target) {
        const entries = historyLoad().filter(e => e.userId === target.id).slice(-12).reverse()
        result = entries.length
          ? entries.map(e => `**${e.action}** — ${e.date.slice(0, 16).replace('T', ' ')} UTC\n${e.reason.slice(0, 90)} • <@${e.moderatorId}>${e.details ? ` • ${e.details}` : ''}`).join('\n').slice(0, 1900)
          : 'Nenhum registro encontrado (ações anteriores à atualização não são importadas).'
      } else if (cmd === 'warn' && target) {
        const error = okTarget()
        if (error) result = error
        else {
          const db = load(); const list = db[target.id] || []
          const next = Math.max(0, ...list.map(w => w.id)) + 1
          list.push({ id: next, reason, moderatorId: interaction.user.id, createdAt: new Date().toISOString() })
          db[target.id] = list; save(db)
          recordHistory({ userId: target.id, moderatorId: interaction.user.id, action: 'Advertência', reason, details: `#${next}` })
          const dm = await notifyMember(target, `Advertência #${next}`, reason, moderatorName)
          result = `✅ Advertência #${next} aplicada a ${target.username}. ${dmStatus(dm)}`
          const threshold = config.progressive?.enabled ? config.progressive.timeoutAtWarnings[String(list.length)] : undefined
          if (threshold && member && member.moderatable && threshold > 0 && threshold <= 40320) {
            try {
              await member.timeout(threshold * 60_000, `Advertências acumuladas: ${list.length}`)
              recordHistory({ userId: target.id, moderatorId: interaction.user.id, action: 'Timeout progressivo', reason: `Acúmulo de ${list.length} advertências`, details: `${threshold} minutos` })
              const progressDM = await notifyMember(target, 'Timeout progressivo', `Acúmulo de ${list.length} advertências`, moderatorName, `${threshold} minutos`)
              result += `\n🔇 Timeout progressivo: ${threshold} min. ${dmStatus(progressDM)}`
            } catch (err) { result += '\n⚠️ Falha no timeout progressivo; advertência preservada.' }
          }
          await modlog('⚠️ Advertência', `Usuário: <@${target.id}>\nModerador: <@${interaction.user.id}>\nMotivo: ${reason}\nID: ${next}\nNotificação: ${dmStatus(dm)}`)
        }
      } else if (cmd === 'warnings' && target) {
        const list = load()[target.id] || []
        result = list.length ? list.map(w => `#${w.id} — ${w.reason} (por <@${w.moderatorId}>)`).join('\n').slice(0, 1900) : 'Nenhuma advertência registrada.'
      } else if (cmd === 'unwarn' && target) {
        const id = interaction.options.getInteger('id', true)
        const db = load(); const old = db[target.id] || []
        db[target.id] = old.filter(w => w.id !== id)
        if (db[target.id].length === old.length) result = 'Advertência não encontrada.'
        else { save(db); recordHistory({userId: target.id, moderatorId: interaction.user.id, action:'Advertência removida', reason: `Advertência #${id} removida`}); result = `✅ Advertência #${id} removida.`; await modlog('✅ Advertência removida', `Usuário: <@${target.id}>\nID: ${id}\nModerador: <@${interaction.user.id}>`) }
      } else if (cmd === 'kick') {
        const error = okTarget()
        if (error) result = error
        else {
          const dm = await notifyMember(target!, 'Expulsão', reason, moderatorName)
          await member!.kick(reason)
          recordHistory({userId: target!.id, moderatorId: interaction.user.id, action:'Expulsão', reason})
          result = `✅ Membro expulso. ${dmStatus(dm)}`
          await modlog('👢 Expulsão', `<@${target!.id}> por <@${interaction.user.id}>\n${reason}\nNotificação: ${dmStatus(dm)}`)
        }
      } else if (cmd === 'ban' && target) {
        if (target.id === guild.ownerId || target.id === interaction.user.id) result = 'Esse usuário não pode ser banido.'
        else if (member && okTarget()) result = okTarget()!
        else if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) result = 'Você precisa da permissão Banir Membros.'
        else {
          const dm = await notifyMember(target, 'Banimento', reason, moderatorName)
          await guild.members.ban(target.id, { reason, deleteMessageSeconds: 0 })
          recordHistory({userId: target.id, moderatorId: interaction.user.id, action:'Banimento', reason})
          result = `✅ Usuário banido. ${dmStatus(dm)}`
          await modlog('🔨 Banimento', `<@${target.id}> por <@${interaction.user.id}>\n${reason}\nNotificação: ${dmStatus(dm)}`)
        }
      } else if (cmd === 'timeout' && target) {
        const error = okTarget(); const minutes = interaction.options.getInteger('minutos', true)
        if (error) result = error
        else {
          await member!.timeout(minutes * 60_000, reason)
          recordHistory({userId: target.id, moderatorId: interaction.user.id, action:'Timeout', reason, details: `${minutes} minutos`})
          const dm = await notifyMember(target, 'Silenciamento temporário', reason, moderatorName, `${minutes} minuto(s)`)
          result = `✅ Timeout aplicado por ${minutes} minuto(s). ${dmStatus(dm)}`
          await modlog('🔇 Timeout', `<@${target.id}> por <@${interaction.user.id}>\n${minutes} min.\n${reason}\nNotificação: ${dmStatus(dm)}`)
        }
      } else if (cmd === 'untimeout') {
        const error = okTarget()
        if (error) result = error
        else {
          await member!.timeout(null, `Removido por ${moderatorName}`)
          recordHistory({userId: target!.id, moderatorId: interaction.user.id, action:'Timeout removido', reason:'Removido manualmente'})
          const dm = await notifyMember(target!, 'Silenciamento removido', 'Sua restrição de comunicação foi encerrada.', moderatorName)
          result = `✅ Timeout removido. ${dmStatus(dm)}`
          await modlog('🔊 Timeout removido', `<@${target!.id}> por <@${interaction.user.id}>\nNotificação: ${dmStatus(dm)}`)
        }
      } else if (cmd === 'clear') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) result = 'Você precisa da permissão Gerenciar Mensagens.'
        else if (!interaction.channel || !('bulkDelete' in interaction.channel)) result = 'Este canal não permite exclusão em lote.'
        else {
          const n = interaction.options.getInteger('quantidade', true)
          const deleted = await (interaction.channel as TextChannel).bulkDelete(n, true)
          result = `✅ ${deleted.size} mensagem(ns) apagada(s).`
          await modlog('🧹 Limpeza', `${deleted.size} mensagens em <#${interaction.channelId}> por <@${interaction.user.id}>`)
        }
      }
      await interaction.editReply({ content: result || 'Nenhuma ação realizada.' })
    } catch (error) {
      opendiscord.log(`HEZZUZ Moderação: ${String(error)}`, 'error')
      await interaction.editReply({ content: '❌ Falha ao executar. Verifique as permissões e o console.' }).catch(() => {})
    }
  })
  if (config.trackJoinsAndLeaves) {
    client.on(Events.GuildMemberAdd, async m => { if (m.guild.id === config.guildId) await general('📥 Entrada', `<@${m.id}> entrou no servidor.`) })
    client.on(Events.GuildMemberRemove, async m => { if (m.guild.id === config.guildId) await general('📤 Saída', `<@${m.id}> saiu do servidor.`) })
  }
  if (config.trackMemberRoles) client.on(Events.GuildMemberUpdate, async (oldM, newM) => {
    if (newM.guild.id !== config.guildId) return
    const added = newM.roles.cache.filter(r => !oldM.roles.cache.has(r.id))
    const removed = oldM.roles.cache.filter(r => !newM.roles.cache.has(r.id))
    if (added.size || removed.size) await general('🎭 Cargos alterados', `Membro: <@${newM.id}>\nAdicionados: ${added.map(r => r.name).join(', ') || '—'}\nRemovidos: ${removed.map(r => r.name).join(', ') || '—'}`)
  })
  if (config.trackMessageDeletes) client.on(Events.MessageDelete, async (m: Message | PartialMessage) => {
    if (m.guildId !== config.guildId || m.author?.bot || m.channelId === config.generalLogsChannelId) return
    await general('🗑️ Mensagem excluída', `Canal: <#${m.channelId}>\nAutor: ${m.author ? `<@${m.author.id}>` : 'Indisponível'}\nTexto (se disponível): ${(m.content || 'Indisponível').slice(0, 1000)}`)
  })
  if (config.trackMessageEdits) client.on(Events.MessageUpdate, async (oldM, newM) => {
    if (newM.guildId !== config.guildId || newM.author?.bot || newM.channelId === config.generalLogsChannelId || oldM.content === newM.content) return
    if (!oldM.content || !newM.content) return
    await general('✏️ Mensagem editada', `Canal: <#${newM.channelId}>\nAutor: <@${newM.author?.id}>\nAntes: ${oldM.content.slice(0, 850)}\nDepois: ${newM.content.slice(0, 850)}`)
  })
  opendiscord.log('HEZZUZ Moderação: módulo carregado.', 'info')
})
