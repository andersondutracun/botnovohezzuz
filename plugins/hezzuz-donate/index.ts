import { api, opendiscord } from "#opendiscord";
import {
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual, createHmac } from "node:crypto";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { getLinkDB } from "../hezzuz-link/storage";

const base = "./plugins/hezzuz-donate/";
type Cfg = {
  enabled: boolean;
  paymentsEnabled: boolean;
  guildId: string;
  donorRoleId: string;
  channelId: string;
  logsChannelId: string;
  packagesBRL: number[];
  pointsPerBRL: number;
  pollSeconds: number;
  receiverHost: string;
  receiverPort: number;
  minBridgeTokenLength: number;
  bridgeToken?: string;
  adminTestEnabled?: boolean;
  maxTestPoints?: number;
  autoCloseMinutes?: number;
  mercadoPago?: {
    testAccessToken?: string;
    testWebhookSecret?: string;
    testEnabled?: boolean;
    productionAccessToken?: string;
    productionWebhookSecret?: string;
    productionEnabled?: boolean;
  };
};
type Order = {
  ref: string;
  paymentId: string;
  discordId: string;
  uuid: string;
  name: string;
  amount: number;
  points: number;
  status:
    | "pending"
    | "approved"
    | "delivered"
    | "refunded"
    | "cancelled"
    | "review";
  created: number;
  updated: number;
  deliveredAt?: number;
  deliveryId?: string;
  reported?: boolean;
  test?: boolean;
  createdBy?: string;
  production?: boolean;
  ticketChannelId?: string;
  approvedNotifiedAt?: number;
  deliveredNotifiedAt?: number;
  closeAt?: number;
  autoClosedAt?: number;
};
type Db = { orders: Order[] };
const dbPath = base + "orders.json";
const readDb = (): Db => {
  try {
    const x = JSON.parse(readFileSync(dbPath, "utf8"));
    if (!x || !Array.isArray(x.orders)) {
      throw new Error("Estrutura inválida em orders.json; entregas e cobranças bloqueadas até restaurar o backup.");
    }
    return { orders: x.orders };
  } catch (error) {
    // Nunca substituir silenciosamente o histórico financeiro por um banco vazio.
    throw new Error("HEZZUZ Donate: não foi possível carregar orders.json. Operação interrompida para proteger pagamentos. " + String(error));
  }
};
const saveDb = (db: Db) => {
  const temp = dbPath + ".tmp";
  writeFileSync(temp, JSON.stringify(db, null, 2), { mode: 0o600 });
  renameSync(temp, dbPath);
};
const token = (cfg: Cfg) =>
  String(
    process.env.HEZZUZ_DONATE_BRIDGE_TOKEN || cfg.bridgeToken || "",
  ).trim();
const mpToken = (cfg: Cfg) =>
  String(
    process.env.MP_ACCESS_TOKEN || cfg.mercadoPago?.productionAccessToken || "",
  ).trim();
const productionSecret = (cfg: Cfg) =>
  String(
    process.env.MP_WEBHOOK_SECRET ||
      cfg.mercadoPago?.productionWebhookSecret ||
      "",
  ).trim();
const live = (cfg: Cfg) =>
  cfg.paymentsEnabled === true &&
  cfg.mercadoPago?.productionEnabled === true &&
  Boolean(mpToken(cfg) && productionSecret(cfg));
const testMpToken = (cfg: Cfg) =>
  String(
    process.env.MP_TEST_ACCESS_TOKEN || cfg.mercadoPago?.testAccessToken || "",
  ).trim();
const testWebhookSecret = (cfg: Cfg) =>
  String(
    process.env.MP_TEST_WEBHOOK_SECRET ||
      cfg.mercadoPago?.testWebhookSecret ||
      "",
  ).trim();
const eq = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const reply = (res: ServerResponse, status: number, body: any) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
};
const body = (req: IncomingMessage): Promise<any> =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c: Buffer) => {
      raw += c.toString();
      if (raw.length > 8192) {
        reject(Error("body too long"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
const money = (n: number) => "R$ " + n.toFixed(2).replace(".", ",");
const validPackage = (n: number, cfg: Cfg) =>
  Number.isInteger(n) && cfg.packagesBRL.includes(n) && n > 0;

// Sandbox separado de orders.json: nunca participa do receptor /donate/next.
type MpSandboxOrder = {
  id: string;
  ref: string;
  discordId: string;
  amount: number;
  created: number;
  status: string;
  paymentStatus: string;
};
const mpSandboxDbPath = base + "mp-sandbox-orders.json";
const readMpSandbox = (): MpSandboxOrder[] => {
  try {
    const x = JSON.parse(readFileSync(mpSandboxDbPath, "utf8"));
    return Array.isArray(x.orders) ? x.orders : [];
  } catch {
    return [];
  }
};
const saveMpSandbox = (orders: MpSandboxOrder[]) => {
  const tmp = mpSandboxDbPath + ".tmp";
  writeFileSync(tmp, JSON.stringify({ orders }, null, 2), { mode: 0o600 });
  renameSync(tmp, mpSandboxDbPath);
};
async function mpSandbox(
  cfg: Cfg,
  path: string,
  method: "GET" | "POST",
  payload?: any,
  idem?: string,
): Promise<any> {
  const access = testMpToken(cfg);
  if (!cfg.mercadoPago?.testEnabled || !access)
    throw Error("Credencial de teste ausente ou sandbox desativado");
  const headers: Record<string, string> = {
    Authorization: "Bearer " + access,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (idem) headers["X-Idempotency-Key"] = idem;
  const ctrl = new AbortController(),
    timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch("https://api.mercadopago.com" + path, {
      method,
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: ctrl.signal,
    });
    const out: any = await res.json().catch(() => ({}));
    if (!res.ok)
      throw Error(
        "Mercado Pago teste HTTP " +
          res.status +
          ": " +
          String(out.message || out.error || out.code || "sem detalhes").slice(
            0,
            150,
          ),
      );
    return out;
  } finally {
    clearTimeout(timer);
  }
}

async function mp(
  cfg: Cfg,
  path: string,
  method: "GET" | "POST",
  payload?: any,
  idem?: string,
) {
  const access = mpToken(cfg);
  if (!access) throw Error("Credencial de produção ausente");
  const headers: any = {
    Authorization: "Bearer " + access,
    "Content-Type": "application/json",
  };
  if (idem) headers["X-Idempotency-Key"] = idem;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch("https://api.mercadopago.com" + path, {
      method,
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: ctrl.signal,
    });
    const data: any = await res.json();
    if (!res.ok)
      throw Error(
        "Mercado Pago HTTP " +
          res.status +
          ": " +
          String(data.message || data.error || "sem detalhes"),
      );
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

opendiscord.events.get("onConfigLoad").listen((manager) => {
  manager.add(
    new api.ODJsonConfig("hezzuz-donate:config", "config.json", base),
  );
});
opendiscord.events.get("afterClientReady").listen(async () => {
  const cfg = opendiscord.configs.get("hezzuz-donate:config")?.data as
    | Cfg
    | undefined;
  if (!cfg?.enabled) return;
  const client = opendiscord.client.client;
  const guild = await client.guilds.fetch(cfg.guildId).catch(() => null);
  if (!guild) {
    console.warn("[HEZZUZ Donate] Guild não encontrado");
    return;
  }
  const logs = async (text: string) => {
    console.log("[HEZZUZ Donate] " + text);
    if (cfg.logsChannelId) {
      const ch = await guild.channels
        .fetch(cfg.logsChannelId)
        .catch(() => null);
      if (ch && "send" in ch)
        await (ch as any)
          .send({
            content: text.slice(0, 1800),
            allowedMentions: { parse: [] },
          })
          .catch(() => {});
    }
  };
  // Testes administrativos sem Pix, com limite e sem cargo Doador.
  const testCommand = new SlashCommandBuilder()
    .setName("donateteste")
    .setDescription("HEZZUZ: teste controlado de entrega PlayerPoints")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) =>
      s
        .setName("entregar")
        .setDescription("Cria uma única entrega de teste por conta vinculada")
        .addUserOption((o) =>
          o
            .setName("usuario")
            .setDescription("Conta Discord vinculada ao Minecraft")
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("pontos")
            .setDescription("Pontos de teste (1 a 1000)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(1000),
        )
        .addBooleanOption((o) =>
          o
            .setName("confirmar")
            .setDescription("Confirme para creditar pontos REAIS no Survival")
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("status")
        .setDescription("Exibe entregas de teste e seus estados"),
    )
    .addSubcommand((s) =>
      s
        .setName("mpcredenciais")
        .setDescription("Verifica credencial Mercado Pago de teste sem cobrar"),
    )
    .addSubcommand((s) =>
      s
        .setName("pixcriar")
        .setDescription("Cria order Pix SANDBOX sem crédito no Minecraft")
        .addIntegerOption((o) =>
          o
            .setName("valor")
            .setDescription("Valor fictício em reais: pacote permitido")
            .setRequired(true)
            .addChoices(
              { name: "R$ 5", value: 5 },
              { name: "R$ 10", value: 10 },
              { name: "R$ 20", value: 20 },
              { name: "R$ 30", value: 30 },
              { name: "R$ 50", value: 50 },
              { name: "R$ 100", value: 100 },
            ),
        )
        .addBooleanOption((o) =>
          o
            .setName("confirmar")
            .setDescription("Confirmo criação de ordem de teste, sem entrega")
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("pixstatus")
        .setDescription("Consulta a última order Pix SANDBOX na API oficial"),
    );
  try {
    const cmds = await guild.commands.fetch();
    const prior = cmds.find((c) => c.name === "donateteste");
    if (prior) await prior.edit(testCommand.toJSON() as any);
    else await guild.commands.create(testCommand.toJSON() as any);
  } catch (e) {
    console.error("[HEZZUZ Donate] comando de teste:", e);
  }
  client.on("interactionCreate", async (i) => {
    if (
      !i.isChatInputCommand() ||
      i.commandName !== "donateteste" ||
      i.guildId !== cfg.guildId
    )
      return;
    try {
      // Verificar permissão no servidor, não somente visibilidade do slash.
      const staff = await guild.members.fetch(i.user.id).catch(() => null);
      if (!staff?.permissions.has(PermissionFlagsBits.Administrator))
        return void (await i.reply({
          content: "Somente administradores.",
          ephemeral: true,
        }));
      const sub = i.options.getSubcommand();
      if (sub === "status") {
        const items = readDb()
          .orders.filter((o) => o.test)
          .slice(-10);
        return void (await i.reply({
          ephemeral: true,
          content: items.length
            ? "🧪 Testes (mais recentes):\n" +
              items
                .map(
                  (o) =>
                    `\`${o.ref}\` • ${o.name} • ${o.points} pontos • **${o.status}**`,
                )
                .join("\n")
            : "Nenhum teste registrado.",
        }));
      }
      if (sub === "mpcredenciais") {
        if (!cfg.mercadoPago?.testEnabled)
          return void (await i.reply({
            content: "Habilite mercadoPago.testEnabled no config.json.",
            ephemeral: true,
          }));
        const credential = testMpToken(cfg);
        if (!credential)
          return void (await i.reply({
            content: "Credencial Mercado Pago de TESTE ausente.",
            ephemeral: true,
          }));
        await i.deferReply({ ephemeral: true });
        const controller = new AbortController(),
          timer = setTimeout(() => controller.abort(), 12000);
        try {
          const result = await fetch(
            "https://api.mercadopago.com/v1/payment_methods",
            {
              headers: { Authorization: "Bearer " + credential },
              signal: controller.signal,
            },
          );
          const payload: any = await result.json().catch(() => null);
          const okay = result.ok && Array.isArray(payload);
          return void (await i.editReply(
            okay
              ? "✅ A API Mercado Pago aceitou a credencial. Nenhum pagamento foi criado e nenhum ponto foi creditado."
              : `❌ A API Mercado Pago respondeu HTTP ${result.status}; confira a credencial e a aplicação. Nenhum pagamento criado.`,
          ));
        } catch (e) {
          console.warn("[HEZZUZ Donate] teste de credencial:", String(e));
          return void (await i.editReply(
            "❌ Falha ao consultar Mercado Pago. Veja os logs locais.",
          ));
        } finally {
          clearTimeout(timer);
        }
      }
      if (sub === "pixcriar" || sub === "pixstatus") {
        if (!cfg.mercadoPago?.testEnabled || !testMpToken(cfg))
          return void (await i.reply({
            ephemeral: true,
            content: "Configure mercadoPago.testEnabled e testAccessToken.",
          }));
        if (cfg.paymentsEnabled)
          return void (await i.reply({
            ephemeral: true,
            content: "Desative paymentsEnabled antes de testar Pix sandbox.",
          }));
        if (sub === "pixcriar") {
          if (i.options.getBoolean("confirmar", true) !== true)
            return void (await i.reply({
              ephemeral: true,
              content: "Operação cancelada.",
            }));
          const valor = i.options.getInteger("valor", true);
          if (!validPackage(valor, cfg))
            return void (await i.reply({
              ephemeral: true,
              content: "Pacote não permitido.",
            }));
          const previous = readMpSandbox().filter(
            (o) =>
              o.discordId === i.user.id &&
              Date.now() - o.created < 10 * 60 * 1000,
          );
          if (previous.length)
            return void (await i.reply({
              ephemeral: true,
              content:
                "Já existe um sandbox criado nos últimos 10 minutos. Use /donateteste pixstatus.",
            }));
          await i.deferReply({ ephemeral: true });
          // O Mercado Pago usa o primeiro nome APRO em testes predefinidos para simular aprovação.
          const ref = "hezzuz-sandbox-" + randomUUID();
          const payload = {
            type: "online",
            processing_mode: "automatic",
            external_reference: ref,
            total_amount: valor.toFixed(2),
            payer: { email: "test@testuser.com", first_name: "APRO" },
            transactions: {
              payments: [
                {
                  amount: valor.toFixed(2),
                  payment_method: { id: "pix", type: "bank_transfer" },
                },
              ],
            },
          };
          const order = await mpSandbox(
            cfg,
            "/v1/orders",
            "POST",
            payload,
            ref,
          );
          if (!order?.id || String(order.external_reference) !== ref)
            throw Error(
              "Resposta da order sandbox sem ID ou referência consistente",
            );
          const tx = order.transactions?.payments?.[0];
          const orders = readMpSandbox();
          orders.push({
            id: String(order.id),
            ref,
            discordId: i.user.id,
            amount: valor,
            created: Date.now(),
            status: String(order.status || "unknown"),
            paymentStatus: String(tx?.status || "unknown"),
          });
          saveMpSandbox(orders);
          const ticket = String(tx?.payment_method?.ticket_url || "");
          const safeTicket = ticket.startsWith(
            "https://www.mercadopago.com.br/sandbox/",
          )
            ? ticket
            : "";
          await i.editReply(
            "🧪 **Pix SANDBOX criado**\nOrder: `" +
              String(order.id) +
              "`\nValor fictício: **" +
              money(valor) +
              "**\nStatus inicial: `" +
              String(order.status || "unknown") +
              "`\nTransação: `" +
              String(tx?.status || "unknown") +
              "`" +
              (safeTicket
                ? "\n[Ver página sandbox do Mercado Pago](" + safeTicket + ")"
                : "") +
              "\n\n⚠️ Não pague QR codes de teste. Esta order fica fora de orders.json, não credita PlayerPoints e não dá cargo Doador. Use `/donateteste pixstatus`.",
          );
          return;
        }
        await i.deferReply({ ephemeral: true });
        const last = readMpSandbox()
          .filter((o) => o.discordId === i.user.id)
          .at(-1);
        if (!last)
          return void (await i.editReply(
            "Nenhuma order sandbox criada para sua conta. Use /donateteste pixcriar.",
          ));
        const order = await mpSandbox(
          cfg,
          "/v1/orders/" + encodeURIComponent(last.id),
          "GET",
        );
        if (
          String(order.id) !== last.id ||
          String(order.external_reference) !== last.ref ||
          Math.round(Number(order.total_amount) * 100) !== last.amount * 100
        )
          throw Error("Divergência na order de teste; revise manualmente.");
        const payment = order.transactions?.payments?.[0];
        const state = String(order.status || "unknown"),
          transaction = String(payment?.status || "unknown");
        const orders = readMpSandbox(),
          idx = orders.findIndex((x) => x.id === last.id);
        if (idx >= 0) {
          orders[idx].status = state;
          orders[idx].paymentStatus = transaction;
          saveMpSandbox(orders);
        }
        return void (await i.editReply(
          "🧪 **Consulta oficial da order sandbox**\nOrder: `" +
            last.id +
            "`\nStatus: `" +
            state +
            "`\nPagamento: `" +
            transaction +
            "`\n\n🔒 Sandbox isolado: **nenhum PlayerPoints/cargo Doador será liberado**, mesmo que o status fique aprovado.",
        ));
      }
      if (!cfg.adminTestEnabled)
        return void (await i.reply({
          content:
            "Modo administrativo desativado. Configure adminTestEnabled: true temporariamente no config.json e reinicie.",
          ephemeral: true,
        }));
      if (cfg.paymentsEnabled)
        return void (await i.reply({
          content: "Por segurança, desligue paymentsEnabled para testar.",
          ephemeral: true,
        }));
      if (i.options.getBoolean("confirmar", true) !== true)
        return void (await i.reply({
          content: "Teste cancelado: confirmar precisa ser verdadeiro.",
          ephemeral: true,
        }));
      const user = i.options.getUser("usuario", true),
        pts = i.options.getInteger("pontos", true);
      const max = Math.min(1000, Math.max(1, Number(cfg.maxTestPoints || 100)));
      if (pts < 1 || pts > max)
        return void (await i.reply({
          content: `Limite deste ambiente: ${max} pontos por teste.`,
          ephemeral: true,
        }));
      const link = getLinkDB().links.find((x) => x.discordId === user.id);
      if (!link)
        return void (await i.reply({
          content: "Este usuário ainda não vinculou a conta Minecraft.",
          ephemeral: true,
        }));
      // Não deixar testes repetidos para o mesmo Discord/UUID, nem enquanto a entrega estiver pendente.
      const db = readDb();
      if (
        db.orders.some(
          (o) => o.test && (o.discordId === user.id || o.uuid === link.uuid),
        )
      )
        return void (await i.reply({
          content:
            "Já existe um pedido de teste para essa conta Minecraft/Discord. Consulte /donateteste status; não criamos uma segunda entrega automaticamente.",
          ephemeral: true,
        }));
      const now = Date.now(),
        ref = "hezzuz-" + randomUUID();
      db.orders.push({
        ref,
        paymentId: "TEST-SEM-PAGAMENTO",
        discordId: user.id,
        uuid: link.uuid,
        name: link.name,
        amount: 0,
        points: pts,
        status: "approved",
        created: now,
        updated: now,
        test: true,
        createdBy: i.user.id,
      });
      saveDb(db);
      await logs(
        `TESTE ADMIN CRIADO ${ref}: ${pts} pontos para ${link.name} por ${i.user.id}. Sem Pix e sem cargo Doador.`,
      );
      await i.reply({
        ephemeral: true,
        content: `🧪 Teste registrado: \`${ref}\` • ${pts} Cash para **${link.name}**. Aguarde o receptor do Survival (até ${Math.max(20, cfg.pollSeconds || 30)}s) e consulte /donateteste status. Não cria cobrança nem atribui o cargo Doador.`,
      });
    } catch (e) {
      console.error("[HEZZUZ Donate] teste administrativo:", e);
      if (i.isRepliable()) {
        if (i.replied || i.deferred)
          await i.editReply({ content: "Erro no teste." }).catch(() => {});
        else
          await i
            .reply({ content: "Erro ao criar teste.", ephemeral: true })
            .catch(() => {});
      }
    }
  });
  const syncDonor = async (discordId: string) => {
    try {
      const m = await guild.members.fetch(discordId);
      if (!m.roles.cache.has(cfg.donorRoleId))
        await m.roles.add(cfg.donorRoleId, "HEZZUZ Donate: Pix aprovado");
    } catch (e) {
      await logs(
        "Não foi possível aplicar cargo Doador para " +
          discordId +
          ": " +
          String(e),
      );
    }
  };
  // Mensagens e encerramento são controlados pelo pedido persistido, não por timers em memória.
  // Repetimos após reinicialização, mas somente para tickets de pagamento real identificado.
  let noticesRunning = false;
  const processNotices = async () => {
    if (noticesRunning) return;
    noticesRunning = true;
    try {
      const snapshot = readDb().orders.filter(
        (o) =>
          o.production === true &&
          !o.test &&
          Boolean(o.ticketChannelId) &&
          ["approved", "delivered"].includes(o.status),
      );
      for (const item of snapshot) {
        const ch = await guild.channels
          .fetch(item.ticketChannelId!)
          .catch(() => null);
        if (!ch || !("send" in ch) || !isDonateTicket(ch)) {
          continue;
        }
        const persistField = (
          field: "approvedNotifiedAt" | "deliveredNotifiedAt" | "autoClosedAt",
          value: number,
        ) => {
          const db = readDb(),
            row = db.orders.find((o) => o.ref === item.ref);
          if (!row || row[field]) return;
          row[field] = value;
          saveDb(db);
        };
        if (
          ["approved", "delivered"].includes(item.status) &&
          !item.approvedNotifiedAt
        ) {
          // Apenas o pagamento confirmado na API coloca o pedido no estado approved.
          await (ch as any).send({
            content: `✅ **Pagamento Pix aprovado!**\nPedido: \`${item.ref}\`\nValor: **${money(item.amount)}**\n💎 **${item.points.toLocaleString("pt-BR")} Cash** para **${item.name}**.\n⏳ A entrega está sendo processada no Survival. Avisaremos aqui quando houver confirmação.`,
            allowedMentions: { parse: [] },
          });
          persistField("approvedNotifiedAt", Date.now());
        }
        if (item.status === "delivered" && !item.deliveredNotifiedAt) {
          const minutes = Math.max(
            1,
            Math.min(1440, Number(cfg.autoCloseMinutes ?? 30)),
          );
          const due =
            item.closeAt || (item.deliveredAt || Date.now()) + minutes * 60000;
          await (ch as any).send({
            content: `🎉 **Entrega confirmada no Survival!**\nPedido: \`${item.ref}\`\n✅ **${item.points.toLocaleString("pt-BR")} Cash** enviados para **${item.name}**.\n🏅 Cargo **Doador**: processamento automático.\n🔒 Este ticket será encerrado automaticamente <t:${Math.floor(due / 1000)}:R>. Se houver algum problema, avise a equipe antes do encerramento.`,
            allowedMentions: { parse: [] },
          });
          const db = readDb(),
            row = db.orders.find((o) => o.ref === item.ref);
          if (row && !row.deliveredNotifiedAt) {
            row.deliveredNotifiedAt = Date.now();
            row.closeAt = due;
            saveDb(db);
          }
        }
        const fresh = readDb().orders.find((o) => o.ref === item.ref);
        if (
          !fresh ||
          fresh.status !== "delivered" ||
          !fresh.deliveredNotifiedAt ||
          !fresh.closeAt ||
          fresh.autoClosedAt ||
          Date.now() < fresh.closeAt
        )
          continue;
        // Não encerra um ticket que tenha outra compra ainda aguardando pagamento/entrega.
        if (
          readDb().orders.some(
            (o) =>
              o.ref !== fresh.ref &&
              o.ticketChannelId === fresh.ticketChannelId &&
              o.production === true &&
              ["pending", "approved", "review"].includes(o.status),
          )
        )
          continue;
        const ticket = opendiscord.tickets.get(ch.id);
        if (!ticket) {
          await logs(
            "Ticket não encontrado no Open Ticket para encerrar " +
              item.ref +
              " canal " +
              ch.id,
          );
          continue;
        }
        try {
          // Ação oficial do Open Ticket preserva status/histórico/transcrições.
          await opendiscord.actions
            .get("opendiscord:close-ticket")
            .run("autoclose", {
              guild,
              channel: ch as any,
              user: client.user!,
              ticket,
              reason:
                "HEZZUZ Donate: entrega confirmada e prazo de atendimento encerrado",
              sendMessage: true,
            });
          persistField("autoClosedAt", Date.now());
          await logs(
            "Ticket Donate encerrado automaticamente " +
              item.ref +
              " canal " +
              ch.id,
          );
        } catch (e) {
          await logs(
            "Não foi possível encerrar ticket " + item.ref + ": " + String(e),
          );
        }
      }
    } catch (e) {
      console.warn("[HEZZUZ Donate] avisos/encerramentos:", String(e));
    } finally {
      noticesRunning = false;
    }
  };
  const syncOne = async (order: Order) => {
    if (order.test || !order.production || !live(cfg)) return;
    const payment = await mp(
      cfg,
      "/v1/payments/" + encodeURIComponent(order.paymentId),
      "GET",
    );
    if (
      String(payment.id) !== order.paymentId ||
      String(payment.external_reference) !== order.ref ||
      Math.round(Number(payment.transaction_amount) * 100) !==
        Math.round(order.amount * 100) ||
      String(payment.payment_method_id) !== "pix" ||
      String(payment.live_mode) !== "true" ||
      order.points !== order.amount * cfg.pointsPerBRL
    ) {
      order.status = "review";
      order.updated = Date.now();
      await logs("REVISÃO: divergência no pagamento " + order.ref);
      return;
    }
    if (payment.status === "approved" && order.status === "pending") {
      order.status = "approved";
      order.updated = Date.now();
      await logs(
        "Pagamento aprovado " +
          order.ref +
          "; " +
          order.points +
          " pontos pendentes de entrega.",
      );
    }
    if (
      ["refunded", "charged_back"].includes(payment.status) &&
      order.status !== "refunded"
    ) {
      order.status = "refunded";
      order.updated = Date.now();
      await logs(
        "ESTORNO/CHARGEBACK em " +
          order.ref +
          " — análise manual, NÃO banir automaticamente.",
      );
    }
    if (
      ["cancelled", "rejected"].includes(payment.status) &&
      order.status === "pending"
    ) {
      order.status = "cancelled";
      order.updated = Date.now();
    }
    if (payment.status !== "approved" && order.status === "approved") {
      order.status = "review";
      order.updated = Date.now();
      await logs("REVISÃO: pagamento deixou de estar aprovado " + order.ref);
    }
  };
  const sync = async () => {
    if (!live(cfg)) return;
    const db = readDb();
    let changed = false;
    for (const item of db.orders
      .filter(
        (x) =>
          x.status === "pending" ||
          x.status === "approved" ||
          x.status === "delivered",
      )
      .slice(-150)) {
      // Não recarregar todas as entregas antigas, mas revisar estornos recentes.
      if (
        item.status === "delivered" &&
        Date.now() - item.updated > 7 * 86400000
      )
        continue;
      try {
        const old = item.status;
        await syncOne(item);
        if (old !== item.status) changed = true;
      } catch (e) {
        console.warn("[HEZZUZ Donate] Verificação:", String(e));
      }
    }
    if (changed) saveDb(db);
  };
  // Apenas tickets Open Ticket com prefixo exclusivo. Sem comandos públicos /doar.
  const isDonateTicket = (ch: any) =>
    Boolean(
      ch &&
      ch.guildId === cfg.guildId &&
      ch.isTextBased?.() &&
      ch.name?.toLowerCase().startsWith("donate-"),
    );
  const ticketPanel = () => ({
    embeds: [
      new EmbedBuilder()
        .setTitle("💎 HEZZUZ — Tesouro dos Reinos")
        .setDescription(
          "**Contribuições com Cash**\n\n1. Vincule sua conta Minecraft no painel HEZZUZ Link.\n2. Escolha seu pacote abaixo.\n3. Pague pelo Pix gerado.\n4. Aguarde a confirmação oficial do Mercado Pago.\n\n**R$ 1,00 = 1.000 Cash**. O cargo Doador é permanente. Comprovantes não liberam pontos.",
        )
        .setColor(0xe0ad4e),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("hezzuz_donate_packages")
          .setLabel("💎 Escolher pacote")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("hezzuz_donate_status")
          .setLabel("🔄 Verificar pedido")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
  const installPanel = async (ch: any) => {
    if (!isDonateTicket(ch) || !("send" in ch) || !("messages" in ch)) return;
    // Evita duplicações após reinício, consultando mensagens recentes do próprio bot.
    const recent = await ch.messages.fetch({ limit: 30 }).catch(() => null);
    if (
      recent?.some(
        (m: any) =>
          m.author?.id === client.user?.id &&
          m.components?.some((row: any) =>
            row.components?.some(
              (c: any) => c.customId === "hezzuz_donate_packages",
            ),
          ),
      )
    )
      return;
    await ch
      .send({ ...ticketPanel(), allowedMentions: { parse: [] } })
      .catch((err: any) =>
        console.warn("[HEZZUZ Donate] painel:", String(err)),
      );
  };
  client.on("channelCreate", (ch: any) => {
    if (isDonateTicket(ch))
      setTimeout(() => {
        void installPanel(ch);
      }, 2500);
  });
  // Encontra tickets Donate abertos antes da inicialização, sem republicar o painel.
  const fullGuild = await client.guilds.fetch(cfg.guildId).catch(() => null);
  if (fullGuild) {
    const channels = await fullGuild.channels.fetch().catch(() => null);
    if (channels)
      for (const ch of channels.values())
        if (isDonateTicket(ch)) await installPanel(ch);
  }
  client.on("interactionCreate", async (i) => {
    if (
      i.guildId !== cfg.guildId ||
      !i.isRepliable() ||
      !isDonateTicket(i.channel)
    )
      return;
    try {
      if (i.isButton() && i.customId === "hezzuz_donate_packages") {
        return void (await i.reply({
          ephemeral: true,
          content: "Escolha um pacote:",
          components: [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId("hezzuz_donate_select")
                .setPlaceholder("Selecione o valor")
                .addOptions(
                  cfg.packagesBRL.map((p) => ({
                    label:
                      money(p) +
                      " — " +
                      (p * cfg.pointsPerBRL).toLocaleString("pt-BR") +
                      " pontos",
                    value: String(p),
                  })),
                ),
            ),
          ],
        }));
      }
      if (i.isButton() && i.customId === "hezzuz_donate_status") {
        await i.deferReply({ ephemeral: true });
        if (live(cfg)) await sync();
        const item = readDb()
          .orders.filter((o) => o.discordId === i.user.id)
          .at(-1);
        return void (await i.editReply(
          item
            ? `Pedido: \`${item.ref}\`\nPagamento/entrega: **${item.status}**\nPontos: **${item.points}**`
            : "Nenhuma contribuição encontrada para esta conta.",
        ));
      }
      if (i.isStringSelectMenu() && i.customId === "hezzuz_donate_select") {
        if (!live(cfg))
          return void (await i.reply({
            content: "Pix real ainda não habilitado.",
            ephemeral: true,
          }));
        const amount = Number(i.values[0]);
        if (!validPackage(amount, cfg))
          return void (await i.reply({
            content: "Pacote inválido.",
            ephemeral: true,
          }));
        const modal = new ModalBuilder()
          .setCustomId("hezzuz_donate_email_" + amount)
          .setTitle("HEZZUZ Pix - comprador");
        const field = new TextInputBuilder()
          .setCustomId("email")
          .setLabel("E-mail do comprador")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(150);
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(field),
        );
        return void (await i.showModal(modal));
      }
      if (!i.isModalSubmit() || !i.customId.startsWith("hezzuz_donate_email_"))
        return;
      const buyerEmail = i.fields
        .getTextInputValue("email")
        .trim()
        .toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail))
        return void (await i.reply({
          content: "Informe um e-mail válido.",
          ephemeral: true,
        }));
      const reais = Number(i.customId.slice("hezzuz_donate_email_".length));
      await i.deferReply({ ephemeral: true });
      if (!live(cfg))
        return void (await i.editReply("Pix real ainda não habilitado."));
      if (!validPackage(reais, cfg))
        return void (await i.editReply("Pacote inválido."));
      const link = getLinkDB().links.find((x) => x.discordId === i.user.id);
      if (!link)
        return void (await i.editReply(
          "Vincule primeiro sua conta Minecraft no painel HEZZUZ Link.",
        ));
      const db = readDb();
      if (
        db.orders.some(
          (o) =>
            o.discordId === i.user.id &&
            o.status === "pending" &&
            Date.now() - o.created < 30 * 60000,
        )
      )
        return void (await i.editReply(
          "Você já possui um Pix pendente. Clique em Verificar pedido.",
        ));
      const ref = "hezzuz-" + randomUUID(),
        points = reais * cfg.pointsPerBRL;
      const response = await mp(
        cfg,
        "/v1/payments",
        "POST",
        {
          transaction_amount: reais,
          description: `HEZZUZ - ${points} Cash`,
          payment_method_id: "pix",
          payer: { email: buyerEmail },
          external_reference: ref,
          notification_url:
            "https://donate.hezzuz.com/mercadopago/webhook/production",
        },
        ref,
      );
      const payment = response.point_of_interaction?.transaction_data || {};
      if (!response.id || !payment.qr_code)
        throw Error("Resposta sem ID ou QR Pix");
      const now = Date.now();
      db.orders.push({
        ref,
        paymentId: String(response.id),
        discordId: i.user.id,
        uuid: link.uuid,
        name: link.name,
        amount: reais,
        points,
        status: "pending",
        created: now,
        updated: now,
        production: true,
        ticketChannelId: i.channelId ?? undefined,
      });
      saveDb(db);
      const content = `💎 **HEZZUZ Pix**\nValor: **${money(reais)}** • **${points} Cash**\nPedido: \`${ref}\`\n\n**Pix Copia e Cola:**\n\`\`\`\n${String(payment.qr_code).slice(0, 1600)}\n\`\`\`\nA entrega ocorre apenas após confirmação do Mercado Pago.`;
      if (payment.qr_code_base64) {
        const bytes = Buffer.from(String(payment.qr_code_base64), "base64");
        if (bytes.length < 6e6)
          return void (await i.editReply({
            content,
            files: [new AttachmentBuilder(bytes, { name: "hezzuz-pix.jpg" })],
          }));
      }
      await i.editReply({ content });
    } catch (e) {
      console.error("[HEZZUZ Donate] ticket:", e);
      if (i.isRepliable()) {
        if (i.deferred || i.replied)
          await i
            .editReply(
              "Erro na operação. Antes de tentar novamente, consulte o status do pedido ou peça ajuda à staff.",
            )
            .catch(() => {});
        else
          await i
            .reply({
              ephemeral: true,
              content: "Não foi possível completar a operação.",
            })
            .catch(() => {});
      }
    }
  });
  // API do receptor Paper. Nenhuma operação de administração exposta pela API.
  const key = token(cfg);
  if (key.length >= Math.max(32, cfg.minBridgeTokenLength || 32)) {
    const server = createServer(async (req, res) => {
      // Webhook de TESTE é isolado: apenas autentica e registra o recebimento.
      // Nunca muda pedido, não cria cobrança e não libera PlayerPoints.
      if (
        req.method === "POST" &&
        new URL(req.url || "/", "http://localhost").pathname ===
          "/mercadopago/webhook/test"
      ) {
        if (!cfg.mercadoPago?.testEnabled)
          return reply(res, 404, { error: "not found" });
        const secret = testWebhookSecret(cfg);
        if (!secret)
          return reply(res, 503, { error: "test webhook not configured" });
        const signature = String(req.headers["x-signature"] || ""),
          requestId = String(req.headers["x-request-id"] || "");
        const ts = signature.match(/(?:^|,)\s*ts=([^,]+)/)?.[1] || "";
        const hash =
          signature.match(/(?:^|,)\s*v1=([a-f0-9]{64})(?:,|$)/i)?.[1] || "";
        const url = new URL(req.url || "/", "http://localhost");
        let notification: any;
        try {
          notification = await body(req);
        } catch {
          return reply(res, 400, { error: "invalid body" });
        }
        const dataId = String(
          url.searchParams.get("data.id") ||
            url.searchParams.get("data_id") ||
            notification?.data?.id ||
            "",
        ).toLowerCase();
        // A assinatura é montada conforme documentação do Mercado Pago (sem confiar no payload).
        const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
        const expected = createHmac("sha256", secret)
          .update(manifest)
          .digest("hex");
        const age =
          Number(ts) > 1e12
            ? Math.abs(Date.now() - Number(ts))
            : Math.abs(Date.now() - Number(ts) * 1000);
        if (
          !ts ||
          !hash ||
          !requestId ||
          !dataId ||
          !Number.isFinite(age) ||
          age > 5 * 60 * 1000 ||
          !eq(hash.toLowerCase(), expected)
        )
          return reply(res, 401, { error: "invalid signature" });
        console.log(
          "[HEZZUZ Donate] Webhook Mercado Pago TESTE validado: " +
            String(notification?.type || "evento") +
            " id=" +
            dataId,
        );
        return reply(res, 200, { ok: true, mode: "test", delivery: false });
      }
      if (
        req.method === "POST" &&
        new URL(req.url || "/", "http://localhost").pathname ===
          "/mercadopago/webhook/production"
      ) {
        if (!live(cfg))
          return reply(res, 503, { error: "production disabled" });
        const url = new URL(req.url || "/", "http://localhost");
        const id = String(url.searchParams.get("data.id") || "").toLowerCase();
        const sig = String(req.headers["x-signature"] || ""),
          rid = String(req.headers["x-request-id"] || "");
        const ts = sig.match(/(?:^|,)\s*ts=([^,]+)/)?.[1] || "";
        const hash =
          sig.match(/(?:^|,)\s*v1=([a-f0-9]{64})(?:,|$)/i)?.[1] || "";
        const age =
          Number(ts) > 1e12
            ? Math.abs(Date.now() - Number(ts))
            : Math.abs(Date.now() - Number(ts) * 1000);
        const expected = createHmac("sha256", productionSecret(cfg))
          .update(`id:${id};request-id:${rid};ts:${ts};`)
          .digest("hex");
        if (
          !id ||
          !rid ||
          !ts ||
          !hash ||
          !Number.isFinite(age) ||
          age > 300000 ||
          !eq(hash.toLowerCase(), expected)
        )
          return reply(res, 401, { error: "invalid signature" });
        let payload: any;
        try {
          payload = await body(req);
        } catch {
          return reply(res, 400, { error: "invalid body" });
        }
        if (String(payload?.data?.id || "").toLowerCase() !== id)
          return reply(res, 400, { error: "id mismatch" });
        // Não modifica pedido com base apenas na notificação: sempre consulta API oficial.
        const db = readDb(),
          order = db.orders.find((o) => o.production && o.paymentId === id);
        if (order) {
          try {
            await syncOne(order);
            saveDb(db);
            void processNotices();
          } catch (e) {
            console.warn("[HEZZUZ Donate] webhook pagamento:", String(e));
            return reply(res, 503, { error: "verification pending" });
          }
        }
        return reply(res, 200, { ok: true });
      }
      if (!eq(String(req.headers["x-hezzuz-token"] || ""), key))
        return reply(res, 401, { error: "unauthorized" });
      if (req.method === "GET" && req.url === "/donate/next") {
        const db = readDb(),
          items: any[] = [];
        // O receptor não pode receber entregas de sandbox ou pedidos legados sem prova.
        if (live(cfg))
          for (const order of db.orders
            .filter((o) => o.status === "approved" && o.production === true)
            .slice(0, 20)) {
            try {
              await syncOne(order);
              if (order.status === "approved")
                items.push({
                  ref: order.ref,
                  uuid: order.uuid,
                  name: order.name,
                  points: order.points,
                });
            } catch (e) {
              console.warn(
                "[HEZZUZ Donate] confirmação antes de entregar falhou:",
                String(e),
              );
            }
          }
        // Apenas testes administrativos explícitos continuam permitidos quando modo teste ligado.
        if (cfg.adminTestEnabled === true && !live(cfg))
          for (const order of db.orders
            .filter((o) => o.test && o.status === "approved")
            .slice(0, 20))
            items.push({
              ref: order.ref,
              uuid: order.uuid,
              name: order.name,
              points: order.points,
            });
        saveDb(db);
        return reply(res, 200, { items });
      }
      if (req.method === "POST" && req.url === "/donate/ack") {
        try {
          const payload = await body(req);
          const db = readDb();
          const item = db.orders.find((o) => o.ref === payload.ref);
          if (!item) return reply(res, 404, { error: "not found" });
          if (item.status === "delivered")
            return reply(res, 200, { ok: true, already: true });
          if (
            item.status !== "approved" ||
            (!item.test && !live(cfg)) ||
            (!item.test && !item.production) ||
            (item.test && cfg.adminTestEnabled !== true)
          )
            return reply(res, 409, { error: "not approved" });
          if (payload.ok !== true)
            return reply(res, 422, { error: "delivery not confirmed" });
          item.status = "delivered";
          item.deliveredAt = Date.now();
          item.updated = Date.now();
          item.deliveryId = String(payload.deliveryId || "");
          saveDb(db);
          if (!item.test) {
            try {
              await syncDonor(item.discordId);
            } catch (e) {
              console.warn("[HEZZUZ Donate] cargo Doador:", String(e));
            }
            void processNotices();
          }
          await logs(
            (item.test ? "[TESTE ADMIN] " : "") +
              "Entrega confirmada " +
              item.ref +
              " (" +
              item.points +
              " Cash para " +
              item.name +
              ")",
          );
          return reply(res, 200, { ok: true });
        } catch {
          return reply(res, 400, { error: "invalid body" });
        }
      }
      reply(res, 404, { error: "not found" });
    });
    server.listen(cfg.receiverPort, cfg.receiverHost, () =>
      console.log(
        "[HEZZUZ Donate] receptor em " +
          cfg.receiverHost +
          ":" +
          cfg.receiverPort,
      ),
    );
    server.on("error", (e) => console.error("[HEZZUZ Donate] receptor:", e));
  } else {
    console.warn(
      "[HEZZUZ Donate] Token Donate ausente ou menor que o mínimo; receptor desativado.",
    );
  }
  const timer = setInterval(
    () => {
      void sync()
        .then(() => processNotices())
        .catch((e) => console.warn("[HEZZUZ Donate] sync/avisos:", e));
    },
    Math.max(20, cfg.pollSeconds || 30) * 1000,
  );
  timer.unref();
  setTimeout(() => {
    void processNotices();
  }, 5000);
  await logs(
    "Módulo iniciado. Pagamentos " +
      (cfg.paymentsEnabled ? "HABILITADOS" : "DESATIVADOS") +
      ".",
  );
});
