import {api, opendiscord} from '#opendiscord'
import {SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType} from 'discord.js'

const base='./plugins/hezzuz-link/'
import {getLinkDB,saveLinkDB,scrub} from './storage'
import {readFileSync,writeFileSync} from 'node:fs'
const attempts=new Map<string,{since:number;count:number}>()

// Sincroniza o cargo opcional sem impedir vinculação/desvinculação caso falte permissão.
async function updateLinkedRole(guildId:string, discordId:string, roleId:string, shouldAdd:boolean):Promise<boolean>{
 if(!roleId)return true
 try{
  const guild=await opendiscord.client.client.guilds.fetch(guildId)
  const member=await guild.members.fetch(discordId).catch(()=>null)
  if(!member){console.warn(`HEZZUZ Link: membro ${discordId} não está no servidor; cargo não sincronizado`);return false}
  if(shouldAdd){if(!member.roles.cache.has(roleId))await member.roles.add(roleId,'HEZZUZ Link: conta Minecraft vinculada')}
  else if(member.roles.cache.has(roleId))await member.roles.remove(roleId,'HEZZUZ Link: conta Minecraft desvinculada')
  return true
 }catch(err){opendiscord.log('HEZZUZ Link: erro ao sincronizar cargo: '+String(err),'error');return false}
}

opendiscord.events.get('onConfigLoad').listen(manager=>{manager.add(new api.ODJsonConfig('hezzuz-link:config','config.json',base))})
opendiscord.events.get('afterClientReady').listen(async()=>{
 const cfg=opendiscord.configs.get('hezzuz-link:config')?.data as {enabled:boolean;guildId:string;linkedRoleId?:string;panelChannelId?:string}|undefined
 if(!cfg?.enabled)return
 const guild=await opendiscord.client.client.guilds.fetch(cfg.guildId).catch(()=>null);if(!guild)return
 const commands=[
  new SlashCommandBuilder().setName('vincular').setDescription('Vincule sua conta Minecraft à HEZZUZ').addStringOption(o=>o.setName('codigo').setDescription('Código obtido com /hezzuzlink vincular no Minecraft').setRequired(true)),
  new SlashCommandBuilder().setName('conta').setDescription('Mostra sua conta Minecraft vinculada'),
  new SlashCommandBuilder().setName('desvincular').setDescription('Desvincula sua conta Minecraft').addBooleanOption(o=>o.setName('confirmar').setDescription('Confirme a desvinculação').setRequired(true)),
 ]
 for(const cmd of commands){try{const cmds=await guild.commands.fetch();const found=cmds.find(c=>c.name===cmd.name);if(found)await found.edit(cmd.toJSON() as any);else await guild.commands.create(cmd.toJSON() as any)}catch(err){opendiscord.log('HEZZUZ Link comando: '+String(err),'error')}}
 // Publica uma única mensagem; se a mensagem foi apagada, recria.
 const panelChannelId=cfg.panelChannelId||'1539808747319459880'
 const panelStateFile=base+'panel-state.json'
 const buttons=new ActionRowBuilder<ButtonBuilder>().addComponents(
   new ButtonBuilder().setCustomId('hezzuz_link:open').setLabel('Vincular minha conta').setEmoji('🔗').setStyle(ButtonStyle.Success),
   new ButtonBuilder().setCustomId('hezzuz_link:account').setLabel('Minha conta').setEmoji('👤').setStyle(ButtonStyle.Secondary)
 )
 const embed=new EmbedBuilder().setColor(0xD4AF37).setTitle('⚔️ HEZZUZ | O PACTO DOS REINOS')
   .setDescription('**Aventureiro, una suas jornadas!**\n\nVincule sua conta Minecraft ao Discord da HEZZUZ para identificar seu personagem e participar de futuras integrações.\n\n**📜 Como vincular**\n**1.** Entre na rede HEZZUZ.\n**2.** No Minecraft, digite `/hezzuzlink vincular`.\n**3.** Clique em **Vincular minha conta** abaixo e informe o código de 8 caracteres recebido.\n**4.** Ao concluir, você receberá o cargo <@&1539809449894748300>.\n\n⏳ O código expira em **5 minutos**.\n🔒 A vinculação é **opcional** e suas respostas são privadas.\n\n*HEZZUZ — Onde sua lenda atravessa os reinos.*')
 try{
   const channel=await guild.channels.fetch(panelChannelId).catch(()=>null)
   if(channel && (channel.type===ChannelType.GuildText || channel.type===ChannelType.GuildAnnouncement)){
     let storedId='';try{storedId=String(JSON.parse(readFileSync(panelStateFile,'utf8')).messageId||'')}catch{}
     const previous=storedId?await channel.messages.fetch(storedId).catch(()=>null):null
     const message=previous?await previous.edit({embeds:[embed],components:[buttons]}):await channel.send({embeds:[embed],components:[buttons]})
     writeFileSync(panelStateFile,JSON.stringify({messageId:message.id,channelId:panelChannelId},null,2))
   } else console.warn('HEZZUZ Link: canal do painel não encontrado ou incompatível: '+panelChannelId)
 }catch(err){console.error('HEZZUZ Link: falha ao publicar painel:',err)}

 async function linkByCode(discordId:string,input:string):Promise<string>{
   const now=Date.now();const tries=attempts.get(discordId)
   if(tries && now-tries.since<600000 && tries.count>=5)return 'Muitas tentativas. Aguarde dez minutos.'
   attempts.set(discordId,(!tries||now-tries.since>=600000)?{since:now,count:1}:{since:tries.since,count:tries.count+1})
   const code=input.trim().toUpperCase()
   if(!/^[A-Z2-9]{8}$/.test(code))return 'Código inválido. Use o código de oito caracteres mostrado no Minecraft.'
   const db=getLinkDB();scrub(db)
   const p=db.pending.find(p=>p.code===code)
   if(!p)return 'Código não encontrado ou expirado. Gere um novo no Minecraft e tente novamente.'
   if(db.links.some(x=>x.discordId===discordId))return 'Você já possui uma conta vinculada. Use `/desvincular` antes de vincular outra.'
   if(db.links.some(x=>x.uuid===p.uuid))return 'Esta conta Minecraft já está vinculada a outro Discord.'
   db.links.push({uuid:p.uuid,name:p.name,discordId,linkedAt:Date.now()})
   db.pending=db.pending.filter(x=>x.uuid!==p.uuid);saveLinkDB(db)
   const roleOK=await updateLinkedRole(cfg!.guildId,discordId,cfg!.linkedRoleId||'',true)
   return `✅ **${p.name}** vinculado à sua conta Discord!${roleOK?'':' ⚠️ A vinculação foi salva, mas não consegui adicionar o cargo; avise a staff.'}`
 }
 opendiscord.client.client.on('interactionCreate',async i=>{
  if(i.guildId!==cfg.guildId)return
  try{
   if(i.isButton() && i.customId==='hezzuz_link:open'){
      const modal=new ModalBuilder().setCustomId('hezzuz_link:submit').setTitle('HEZZUZ — Vincular Minecraft')
      const field=new TextInputBuilder().setCustomId('code').setLabel('Código recebido no Minecraft').setPlaceholder('Ex.: ABCD2345').setMinLength(8).setMaxLength(8).setRequired(true).setStyle(TextInputStyle.Short)
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(field))
      await i.showModal(modal);return
   }
   if(i.isButton() && i.customId==='hezzuz_link:account'){
      const db=getLinkDB();const owned=db.links.find(p=>p.discordId===i.user.id)
      await i.reply({content:owned?`🔗 Sua conta vinculada: **${owned.name}** (UUID: \`${owned.uuid}\`).`:'Você ainda não vinculou uma conta. No Minecraft use `/hezzuzlink vincular`.',ephemeral:true});return
   }
   if(i.isModalSubmit() && i.customId==='hezzuz_link:submit'){
      await i.deferReply({ephemeral:true})
      await i.editReply({content:await linkByCode(i.user.id,i.fields.getTextInputValue('code'))});return
   }
   if(!i.isChatInputCommand()||!['vincular','conta','desvincular'].includes(i.commandName))return
   const db=getLinkDB();scrub(db);const owned=db.links.find(p=>p.discordId===i.user.id)
   if(i.commandName==='conta'){await i.reply({content:owned?`🔗 Sua conta vinculada: **${owned.name}** (UUID: \`${owned.uuid}\`).`:'Você ainda não vinculou uma conta. No Minecraft use `/hezzuzlink vincular`.',ephemeral:true});return}
   if(i.commandName==='desvincular'){
     if(!owned){await i.reply({content:'Você não tem uma conta vinculada.',ephemeral:true});return}
     if(!i.options.getBoolean('confirmar')){await i.reply({content:'Para desvincular, repita com `confirmar: verdadeiro`.',ephemeral:true});return}
     await i.deferReply({ephemeral:true})
     db.links=db.links.filter(p=>p.discordId!==i.user.id);saveLinkDB(db)
     const roleOK=await updateLinkedRole(cfg.guildId,i.user.id,cfg.linkedRoleId||'',false)
     await i.editReply({content:`✅ Conta **${owned.name}** desvinculada.${roleOK?'':' ⚠️ Não consegui remover o cargo automaticamente; avise a staff.'}`});return
   }
   await i.deferReply({ephemeral:true})
   await i.editReply({content:await linkByCode(i.user.id,i.options.getString('codigo')||'')})
  } catch (err) {
    console.error('HEZZUZ Link:', err)
    if (i.isRepliable()) {
      if (i.deferred || i.replied) {
        await i.editReply({content:'Não foi possível concluir a operação.'}).catch(() => {})
      } else {
        await i.reply({content:'Não foi possível concluir a operação.', ephemeral:true}).catch(() => {})
      }
    }
  }
 })
 opendiscord.log('HEZZUZ Link: comandos registrados','info')
})
