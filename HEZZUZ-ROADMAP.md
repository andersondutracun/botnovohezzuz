# HEZZUZ Bot 2.0 — Plano de evolução

## Segurança (feito nesta cópia)
- Removido token salvo em `config/general.json` e ativado `tokenFromENV`.
- Gerado `.env.example` **sem credenciais reais**.
- IMPORTANTE: revogue o token anterior no Discord Developer Portal.
- Configure `TOKEN` no ambiente do Pterodactyl ou em arquivo `.env` privado, conforme o egg.
- A cópia não foi executada nem implantada.

## Fase 1 — substituir Carl, Zira, parte de Sapphire e Loritta
- Logs de moderação e eventos, slash commands de moderação, cargos com botões, boas-vindas.
- Permissões por cargo e logs auditáveis; comandos sensíveis restritos à staff.

## Fase 2 — tickets e comunicação
- Evoluir tickets atuais, avaliações, formulários de denúncia e métricas.
- Editor de embeds, sorteios e contagem.

## Fase 3 — HEZZUZ Minecraft
- Status Velocity/servidores; verificação de nick; integração autenticada com permissões e cargos.

## Externos inicialmente
- Música (Jockie), GarticBot e IA (Rio AI). News alerts só após escolher fontes.

## Antes de substituir bots
1. Inventariar canais, cargos, IDs e automações já utilizadas.
2. Implantar esta cópia em instância de teste do Pterodactyl.
3. Testar permissões, interações e tickets existentes.
4. Migrar uma função por vez e só então desativar o bot antigo.

## Dependências já presentes
Open Ticket 4.1.3, discord.js 14.24.2, TypeScript 5.9.3.

## Licença
Projeto derivado do Open Ticket, GPL-3.0-only: manter avisos e respeitar obrigações de distribuição.
