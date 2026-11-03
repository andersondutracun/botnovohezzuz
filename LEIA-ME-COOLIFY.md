# HEZZUZ 2.0 — Docker Compose / Coolify

## O que foi corrigido

- O volume antigo `openticket:/home/container` ocultava o código novo da imagem (inclusive os plugins). Agora o contêiner monta **somente** `/data`.
- 24 plugins HEZZUZ habilitados + exemplo desabilitado seguem no build e podem ser atualizados via GitHub.
- `TOKEN` é obrigatório pelo Coolify, e `config/general.json` está com `tokenFromENV: true`.
- O script `scripts/coolify-start.js` persiste `database/`, `config/` e arquivos JSON mutáveis de cada plugin em `/data` por links simbólicos, sem montar um volume por cima do código.
- O bot compila TypeScript ao iniciar. `typescript` fica instalado via `npm ci --include=dev`.
- Removidos arquivos específicos da Discloud e dados locais do pacote.

## Deploy inicial

1. **Faça backup dos dados** no Coolify antes de substituir o serviço atual. O volume antigo `openticket` contém possivelmente todas as suas configurações e dados. **Não remova esse volume.** O novo `hezzuz_data` inicia vazio; dados históricos não são migrados automaticamente.
2. Não use `git push` da branch antiga com segredos no histórico: o GitHub já acusou `GH013`. Revogue/rotacione as credenciais. Para criar um histórico limpo, use um NOVO repositório privado, com esta pasta preparada e `git init`, `git add`, `git commit`, `git push` (veja instruções na conversa). Revisar segredos antes de publicar.
3. No Coolify, crie recurso **Docker Compose**, apontando para o repositório e `docker-compose.yml` na raiz, com variável obrigatória `TOKEN` (somente runtime). Opcionalmente configure `GEMINI_API_KEY`, `OPENAI_API_KEY` e variáveis de pagamento.
4. Faça Deploy. O bot não precisa de domínio nem porta pública, mas webhooks do Mercado Pago exigem serviço de API externo próprio.
5. Nos Runtime Logs, confira `[HEZZUZ] Coolify`, `Loading plugins` e `discord.js client ready!`.
6. Confirme que os 24 plugins são descobertos. `example-plugin` permanece desabilitado.

## Configuração e migração de dados

Os arquivos `plugins/hezzuz-ai-support/config.json`, `plugins/hezzuz-donate/config.json`, `plugins/hezzuz-link/config.json` e `plugins/hezzuz-vipsync/config.json` não estavam no ZIP original por segurança. Foram incluídos templates **desabilitados**. Configure-os individualmente no volume persistente `/data/plugins/<plugin>/config.json`, copiando suas configurações locais privadas por um canal seguro (sem publicar no Git).

Outros arquivos JSON de dados (tickets, histórico de IA, jogos, compras etc.) foram iniciados vazios para não expor dados privados no GitHub. Se quiser recuperar os registros, migre seus backups antigos individualmente para os destinos correspondentes em `/data` antes de usar em produção. Backup também das configurações atuais, se desejar preservar customizações.

**Importante:** depois do primeiro boot, mudanças em `config/*.json` ou `plugins/*/config.json` no GitHub **não sobrescrevem** os valores persistentes em `/data`. Edite os arquivos persistentes ou migre manualmente os valores. Arquivos de código `.ts`, `plugin.json` e conhecimento `.md` continuam vindo do GitHub em cada deploy.

## Verificações

No terminal do contêiner:

```sh
pwd
find plugins -maxdepth 2 -name plugin.json | sort
ls -la /data
node -e "console.log('TOKEN presente:', !!process.env.TOKEN)"
```

Evite revelar tokens em logs, screenshots ou no repositório.
