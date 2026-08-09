# DEADZONE: banco persistente 100% gratuito e open source

Esta infraestrutura usa Neon Free, que fornece PostgreSQL compatível e cuja plataforma é desenvolvida sob licença Apache 2.0. O jogo continua usando a biblioteca `pg` e a variável `DATABASE_URL`, então não existe lock-in no código do DEADZONE.

## Objetivo

- ranking semanal persistente
- zero custo obrigatório
- PostgreSQL/open source
- nenhuma senha ou connection string commitada no repositório
- bootstrap automático do schema
- proteção adicional contra DELETE/TRUNCATE acidental
- histórico de alterações do ranking em `weekly_rankings_audit`

## Bootstrap

O workflow `neon-free-bootstrap.yml` cria um banco Claimable Postgres temporário por API, inicializa as tabelas do ranking e aplica `db/ranking_protection.sql`.

O workflow salva somente o link de claim em um artifact privado do GitHub Actions. A connection string é mascarada no log e descartada ao final do job.

Depois de reivindicar o banco em uma conta Neon Free, copie a connection string pooled para a variável `DATABASE_URL` do serviço DEADZONE no Render. Esse é o único passo que não pode ser automatizado sem dar ao GitHub uma credencial da sua conta Render.

## Proteções

1. `weekly_rankings` e `weekly_round_awards` bloqueiam DELETE e TRUNCATE por trigger.
2. Cada UPDATE em `weekly_rankings` salva o estado anterior em `weekly_rankings_audit`.
3. O ranking do client nunca recebe credenciais do banco. Somente o servidor Node acessa PostgreSQL.
4. Se `DATABASE_URL` estiver ausente ou indisponível, o jogo continua em modo memory em vez de impedir a entrada dos jogadores.

## Importante

Não coloque `DATABASE_URL`, senha Postgres, token Neon ou token Render em arquivos versionados. Use somente variáveis de ambiente/secrets.
