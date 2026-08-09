# DEADZONE: PostgreSQL persistente no Render

O repositório contém um `render.yaml` que declara a infraestrutura de produção do DEADZONE.

## O que o Blueprint cria/configura

- Usa o Web Service existente chamado `deadzone`.
- Cria o PostgreSQL `deadzone-db`.
- Injeta automaticamente `DATABASE_URL` no Web Service usando a connection string privada do banco.
- Gera `RANKING_SECRET` no Render. O valor não fica salvo no GitHub.
- Coloca o Web Service e o banco no projeto `deadzone`, ambiente `production`.
- Marca o ambiente como protegido contra ações destrutivas por membros não-admin.
- Bloqueia acesso público direto ao PostgreSQL (`ipAllowList: []`).
- Desabilita storage autoscaling para evitar aumento automático de armazenamento/custo.

## Por que o banco é pago

O Blueprint usa `basic-256mb` com 5 GB. O PostgreSQL Free do Render expira 30 dias após a criação e não possui backups, portanto não atende ao requisito de ranking semanal persistente.

A cobrança só começa quando o Blueprint é efetivamente aplicado no Render. Apenas manter este arquivo no GitHub não cria nem cobra o banco.

## Primeira ativação no Render

1. Abra o Render Dashboard.
2. Selecione `New` > `Blueprint`.
3. Conecte o repositório `thepunisherhat41/deadzone`.
4. Selecione a branch `main` e o arquivo `render.yaml`.
5. Na tela de revisão, confirme que o Render identifica o Web Service existente `deadzone` e mostra somente `deadzone-db` como novo banco.
6. Se o Render indicar que criará outro Web Service com nome/sufixo diferente, NÃO aplique. Isso significa que o nome do recurso existente não corresponde ao Blueprint.
7. Revise a estimativa de cobrança do `basic-256mb` + 5 GB.
8. Clique em `Deploy Blueprint`.

Após o banco ficar disponível, o Web Service recebe `DATABASE_URL` automaticamente. No próximo start, `ranking.js` cria as tabelas e índices necessários com `CREATE TABLE IF NOT EXISTS`.

## Proteções contra exclusão

O Blueprint oferece várias camadas de segurança:

- Sincronizar o Blueprint nunca apaga um recurso apenas porque ele foi removido do YAML.
- Se um recurso gerenciado for removido manualmente do Render e continuar declarado no Blueprint, o próximo sync o recria.
- O ambiente `production` está marcado como protegido, restringindo ações destrutivas a administradores do workspace.
- O banco não aceita conexão pública direta.

Importante: recriar um banco apagado não recupera os dados antigos. A proteção contra perda de dados depende dos backups/PITR oferecidos pelos bancos pagos do Render. A infraestrutura reduz exclusões acidentais, enquanto backups são a proteção contra corrupção ou exclusão dos dados.

## Ranking

O ranking continua com as regras atuais do jogo:

- Kill: +10 RP
- Completar rodada: +3 RP
- 1º lugar: +15 RP
- 2º lugar: +8 RP
- 3º lugar: +5 RP

O reset lógico acontece por semana (`America/Sao_Paulo`). As semanas antigas permanecem no PostgreSQL e podem futuramente alimentar histórico e Hall da Fama.
