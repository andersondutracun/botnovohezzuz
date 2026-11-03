import { api, opendiscord } from "#opendiscord";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  type ButtonInteraction,
  type TextChannel,
} from "discord.js";

type Choice = {
  id: string;
  label: string;
  description?: string;
  emoji?: string;
};
type Category = {
  key: string;
  label: string;
  placeholder: string;
  roles: Choice[];
};
type Config = {
  enabled: boolean;
  guildId: string;
  registrationChannelId: string;
  presentationChannelId: string;
  inhabitantsRoleId: string;
  playersRoleId: string;
  rulesText: string[];
  rulesChannelId: string;
  logsChannelId: string;
  embedColor: string;
  presentationCategories: Category[];
};
const PREFIX = "hezzuz-register-v1";

opendiscord.events.get("onConfigLoad").listen((manager) => {
  manager.add(
    new api.ODJsonConfig(
      "hezzuz-registro:config",
      "config.json",
      "./plugins/hezzuz-registro/",
    ),
  );
});

opendiscord.events.get("afterClientReady").listen(async () => {
  const config = opendiscord.configs.get("hezzuz-registro:config")?.data as
    | Config
    | undefined;
  if (!config?.enabled) return;
  const client = opendiscord.client.client;
  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) {
    opendiscord.log("HEZZUZ Registro: servidor não encontrado.", "error");
    return;
  }

  // Guild-specific command: aparece imediatamente no servidor, sem registrar comandos globalmente.
  try {
    const cmd = new SlashCommandBuilder()
      .setName("hezzuz-registro")
      .setDescription("Publica os painéis de registro da HEZZUZ")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sub) =>
        sub
          .setName("publicar")
          .setDescription("Publica um dos painéis")
          .addStringOption((opt) =>
            opt
              .setName("painel")
              .setDescription("Painel para publicar")
              .setRequired(true)
              .addChoices(
                { name: "Regras", value: "regras" },
                { name: "Apresentação", value: "apresentacao" },
              ),
          ),
      );
    const commands = await guild.commands.fetch();
    const existing = commands.find((c) => c.name === "hezzuz-registro");
    if (existing)
      await existing.edit({
        description: "Publica os painéis de registro da HEZZUZ",
        defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
        options: [
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "publicar",
            description: "Publica um dos painéis",
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: "painel",
                description: "Painel para publicar",
                required: true,
                choices: [
                  { name: "Regras", value: "regras" },
                  { name: "Apresentação", value: "apresentacao" },
                ],
              },
            ],
          },
        ],
      });
    else await guild.commands.create(cmd.toJSON());
  } catch (err) {
    opendiscord.log(
      `HEZZUZ Registro: falha ao criar comando: ${String(err)}`,
      "error",
    );
  }

  const ephemeral = MessageFlags.Ephemeral;
  const color = (config.embedColor || "#D4A747") as `#${string}`;

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.inGuild() || interaction.guildId !== config.guildId)
      return;
    try {
      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "hezzuz-registro"
      ) {
        const cmd = interaction as ChatInputCommandInteraction;
        if (!cmd.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await cmd.reply({
            content: "⛔ Apenas a administração pode publicar os painéis.",
            flags: ephemeral,
          });
          return;
        }
        const which = cmd.options.getString("painel", true);
        const channelId =
          which === "regras"
            ? config.registrationChannelId
            : config.presentationChannelId;
        if (!channelId) {
          await cmd.reply({
            content:
              "Configure primeiro o ID do canal deste painel em config.json.",
            flags: ephemeral,
          });
          return;
        }
        const channel = await cmd.guild?.channels
          .fetch(channelId)
          .catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildText) {
          await cmd.reply({
            content: "Canal inválido ou inacessível.",
            flags: ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder().setColor(color);
        const components: ActionRowBuilder<any>[] = [];
        if (which === "regras") {
          const rules = (config.rulesText || []).filter(
            (line) => line.trim().length > 0,
          );
          if (!rules.length) {
            await cmd.reply({
              content:
                "❌ Adicione o texto oficial das regras em rulesText no config.json antes de publicar.",
              flags: ephemeral,
            });
            return;
          }
          const rulesBody = [
            "⚔️ **Antes de iniciar sua jornada, leia e aceite as regras da HEZZUZ.**",
            "",
            ...rules,
            "",
            "⭐ Ao clicar em **Aceitar regras**, você confirma que leu e concorda com o texto acima e recebe o cargo **Habitantes**.",
          ].join("\n");
          if (rulesBody.length > 4096) {
            await cmd.reply({
              content:
                "❌ O texto ultrapassa 4.096 caracteres (limite do embed do Discord). Resuma as regras ou divida o conteúdo.",
              flags: ephemeral,
            });
            return;
          }
          embed
            .setTitle("📜 INÍCIO DA JORNADA • HEZZUZ")
            .setDescription(rulesBody)
            .setFooter({
              text: "REDE HEZZUZ • Respeito, comunidade e aventura",
            });
          const buttons = new ActionRowBuilder<ButtonBuilder>();
          if (config.rulesChannelId)
            buttons.addComponents(
              new ButtonBuilder()
                .setLabel("📖 Ler regras")
                .setStyle(ButtonStyle.Link)
                .setURL(
                  `https://discord.com/channels/${config.guildId}/${config.rulesChannelId}`,
                ),
            );
          buttons.addComponents(
            new ButtonBuilder()
              .setLabel("⭐ Aceitar regras")
              .setStyle(ButtonStyle.Success)
              .setCustomId(`${PREFIX}:accept`),
          );
          components.push(buttons);
        } else {
          const categories = config.presentationCategories.filter(
            (c) => c.roles?.length,
          );
          if (!categories.length) {
            await cmd.reply({
              content:
                "Adicione os IDs dos cargos nas categorias de apresentação do config.json antes de publicar.",
              flags: ephemeral,
            });
            return;
          }
          if (categories.length > 5) {
            await cmd.reply({
              content: "O Discord aceita no máximo cinco menus por mensagem.",
              flags: ephemeral,
            });
            return;
          }
          if (
            categories.some(
              (c) => c.roles.length > 24 || !/^[a-z_]{1,24}$/.test(c.key),
            )
          ) {
            await cmd.reply({
              content:
                "Cada categoria deve ter uma chave curta e no máximo 24 cargos.",
              flags: ephemeral,
            });
            return;
          }
          embed
            .setTitle("🎭 APRESENTE-SE • HEZZUZ")
            .setDescription(
              "Personalize seu perfil escolhendo os cargos que desejar. **Tudo aqui é opcional.** Você pode mudar ou retirar suas escolhas quando quiser.",
            )
            .setFooter({ text: "REDE HEZZUZ • Sua identidade, suas escolhas" });
          for (const category of categories) {
            const menu = new StringSelectMenuBuilder()
              .setCustomId(`${PREFIX}:choice:${category.key}`)
              .setPlaceholder(category.placeholder || category.label)
              .setMinValues(1)
              .setMaxValues(1)
              .addOptions([
                {
                  label: "Remover minha escolha",
                  value: "clear",
                  description: "Retirar os cargos desta categoria",
                },
                ...category.roles.map((role) => ({
                  label: role.label.slice(0, 100),
                  value: role.id,
                  description: role.description?.slice(0, 100),
                })),
              ]);
            components.push(
              new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                menu,
              ),
            );
          }
        }
        await cmd.deferReply({ flags: ephemeral });
        await (channel as TextChannel).send({ embeds: [embed], components });
        await cmd.editReply(
          `✅ Painel de ${which === "regras" ? "regras" : "apresentação"} publicado em <#${channelId}>.`,
        );
        return;
      }

      if (
        interaction.isButton() &&
        interaction.customId === `${PREFIX}:accept`
      ) {
        const btn = interaction as ButtonInteraction;
        await btn.deferReply({ flags: ephemeral });
        const member = await btn.guild!.members.fetch(btn.user.id);
        const inhabitants = await btn
          .guild!.roles.fetch(config.inhabitantsRoleId)
          .catch(() => null);
        const playersId = config.playersRoleId;
        const players = playersId
          ? await btn.guild!.roles.fetch(playersId).catch(() => null)
          : null;
        if (!inhabitants) {
          await btn.editReply(
            "❌ O cargo Habitantes não foi encontrado. Avise a staff.",
          );
          return;
        }
        if (!playersId || !players) {
          await btn.editReply(
            "❌ O cargo Jogadores não foi encontrado ou não está configurado. Avise a staff.",
          );
          return;
        }
        // Verifique as permissões antes de alterar qualquer cargo.
        if (
          (!member.roles.cache.has(inhabitants.id) && !inhabitants.editable) ||
          (member.roles.cache.has(players.id) && !players.editable)
        ) {
          await btn.editReply(
            "❌ Não tenho permissão para realizar a troca de cargos. Coloque meu cargo acima de Jogadores e Habitantes e conceda Gerenciar Cargos.",
          );
          return;
        }
        const hadInhabitants = member.roles.cache.has(inhabitants.id);
        const hadPlayers = member.roles.cache.has(players.id);
        if (!hadInhabitants)
          await member.roles.add(inhabitants, "HEZZUZ: aceitação das regras");
        if (hadPlayers)
          await member.roles.remove(
            players,
            "HEZZUZ: registro concluído, troca para Habitantes",
          );
        await btn.editReply(
          hadInhabitants && !hadPlayers
            ? "✅ Você já possui **Habitantes** e não tem o cargo Jogadores. Boa aventura!"
            : "⚔️ **Sua jornada começou!** Seu cargo foi atualizado para **Habitantes**. Bem-vindo(a) à HEZZUZ!",
        );
        const role = inhabitants;
        if (config.logsChannelId) {
          const logs = await btn
            .guild!.channels.fetch(config.logsChannelId)
            .catch(() => null);
          if (logs?.type === ChannelType.GuildText) {
            await (logs as TextChannel)
              .send({
                content: `📜 Registro concluído: <@${member.id}> recebeu <@&${role.id}>.`,
                allowedMentions: { parse: [] },
              })
              .catch(() => {});
          }
        }
        return;
      }

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(`${PREFIX}:choice:`)
      ) {
        const select = interaction as StringSelectMenuInteraction;
        await select.deferReply({ flags: ephemeral });
        const key = select.customId.split(":")[2];
        const category = config.presentationCategories.find(
          (c) => c.key === key,
        );
        if (!category?.roles?.length) {
          await select.editReply("❌ Essa categoria não está configurada.");
          return;
        }
        const member = await select.guild!.members.fetch(select.user.id);
        const selected = select.values[0];
        const allowedIds = category.roles.map((r) => r.id);
        if (selected !== "clear" && !allowedIds.includes(selected)) {
          await select.editReply("❌ Cargo não autorizado.");
          return;
        }
        const old = allowedIds.filter(
          (id) => member.roles.cache.has(id) && id !== selected,
        );
        const changes = [...old, ...(selected !== "clear" ? [selected] : [])];
        for (const id of changes) {
          const role = await select.guild!.roles.fetch(id).catch(() => null);
          if (!role || !role.editable) {
            await select.editReply(
              "❌ Um cargo está ausente ou acima do bot. Avise a staff.",
            );
            return;
          }
        }
        if (old.length)
          await member.roles.remove(old, "HEZZUZ: atualização de apresentação");
        if (selected !== "clear" && !member.roles.cache.has(selected))
          await member.roles.add(selected, "HEZZUZ: apresentação opcional");
        await select.editReply(
          selected === "clear"
            ? "✅ Sua escolha foi removida."
            : "✅ Sua apresentação foi atualizada!",
        );
      }
    } catch (err) {
      opendiscord.log(`HEZZUZ Registro: ${String(err)}`, "error");
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied)
          await interaction
            .editReply("❌ Ocorreu um erro. Avise a staff.")
            .catch(() => {});
        else
          await interaction
            .reply({
              content: "❌ Ocorreu um erro. Avise a staff.",
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
      }
    }
  });
  opendiscord.log("HEZZUZ Registro: módulo ativo.", "plugin");
});
