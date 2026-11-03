# HEZZUZ Bot 2.0 — Boas-vindas v1.0

Esta versão adiciona **somente a mensagem automática de boas-vindas** ao Open Ticket 4.1.3, sem alterar os módulos de tickets.

## Configuração
- Servidor: `1461167877536350402`
- Boas-vindas: `1562607867335544904`
- Registro: `1539859733215846470`
- Cargo concedido **futuramente pelo módulo de registro**: Jogadores `1461167877536350403`
- Personalização: `plugins/hezzuz-welcome/config.json`

## IMPORTANTE
1. Revogue o token antigo do Discord (estava em um ZIP anterior); defina a variável de ambiente `TOKEN` no Pterodactyl. Nunca envie o token pelo chat.
2. Habilite **Server Members Intent** no Discord Developer Portal; o bot precisa do evento `guildMemberAdd`.
3. Confirme permissão de **Ver canal, Enviar mensagens e Incorporar links** no canal de boas-vindas.
4. Instale esta versão **em ambiente de teste**, não execute dois bots com o mesmo token simultaneamente.
5. Entre com uma **conta de testes** para validar a mensagem. Este plugin não atribui cargos automaticamente: a atribuição de Jogadores será implementada no painel de registro, em uma próxima etapa.
6. O botão de registro é um link para o canal, não concede cargos e não aceita regras sozinho.
7. Opcional: para uma faixa ilustrada dentro do embed, hospede uma imagem e configure `bannerUrl` com um link `https://...`; não use links locais.

### Deploy
Instale as dependências existentes conforme documentação do projeto e execute o procedimento de build/start já utilizado no Open Ticket. Para desativar o módulo, altere `enabled` para `false` no `plugins/hezzuz-welcome/config.json` e reinicie.

## Testes realizados
- Estrutura de diretórios e JSON checados.
- **Sem teste de compilação ou integração ao Discord** neste ambiente. A primeira inicialização deve ser conferida no console.
