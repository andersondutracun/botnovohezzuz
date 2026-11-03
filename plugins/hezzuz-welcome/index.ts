import {api, opendiscord} from "#opendiscord"
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, GuildMember, TextChannel, ChannelType } from "discord.js"

interface WelcomeConfig {
  enabled: boolean
  guildId: string
  welcomeChannelId: string
  registrationChannelId: string
  memberRoleId: string
  title: string
  color: string
  footer: string
  bannerUrl: string
  showMemberCount: boolean
}

opendiscord.events.get("onConfigLoad").listen((manager) => {
  manager.add(new api.ODJsonConfig("hezzuz-welcome:config", "config.json", "./plugins/hezzuz-welcome/"))
})

opendiscord.events.get("afterClientReady").listen(() => {
  const config = opendiscord.configs.get("hezzuz-welcome:config")?.data as WelcomeConfig | undefined
  if (!config?.enabled) return
  const client = opendiscord.client.client
  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    if (member.guild.id !== config.guildId || member.user.bot) return
    try {
      const channel = await member.guild.channels.fetch(config.welcomeChannelId)
      if (!channel || channel.type !== ChannelType.GuildText) {
        opendiscord.log("HEZZUZ Boas-vindas: canal inválido ou sem acesso.","warning")
        return
      }
      const embed = new EmbedBuilder()
        .setColor(config.color as `#${string}`)
        .setTitle(config.title)
        .setDescription([
          `Saudações, **${member.displayName}**!`,
          '',
          '🏰 **Os portões da nossa fortaleza estão abertos para você.**',
          'Sua história começa como uma nova aventura entre guerreiros, construtores e exploradores.',
          '',
          '📜 **Primeiro passo:** leia as regras e conclua o registro para receber o cargo **Jogadores**.',
          '🎭 A apresentação é opcional — escolha os cargos que desejar.',
          '⚒️ Depois, prepare-se para explorar a **Rede HEZZUZ**.',
          '',
          config.showMemberCount ? `👥 **Você é o aventureiro nº ${member.guild.memberCount.toLocaleString("pt-BR")} da comunidade!**` : '',
          '',
          '✨ **Que sua jornada seja lendária!**'
        ].filter(Boolean).join('\n'))
        .setThumbnail(member.user.displayAvatarURL({size:256}))
        .setFooter({text: config.footer})
        .setTimestamp()
      if (config.bannerUrl?.startsWith('https://')) embed.setImage(config.bannerUrl)
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel('📜 Iniciar minha jornada')
          .setURL(`https://discord.com/channels/${config.guildId}/${config.registrationChannelId}`)
      )
      await (channel as TextChannel).send({
        content: `🎉 **Bem-vindo(a), ${member}!**`,
        embeds: [embed], components: [row], allowedMentions: {users:[member.id]}
      })
    } catch (error) {
      opendiscord.log(`HEZZUZ Boas-vindas: falha ao enviar mensagem: ${String(error)}`,"error")
    }
  })
  opendiscord.log("HEZZUZ Boas-vindas: módulo ativo.","plugin")
})
