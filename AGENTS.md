# AGENTS.md

Regras permanentes para desenvolvimento no projeto TripSplit.

## Contexto do projeto

- O projeto e o TripSplit, uma aplicacao web de divisao de despesas de viagens.
- Todas as alteracoes ao projeto devem ser feitas atraves do Codex, sem edicao manual dos ficheiros.

## Regras de desenvolvimento

- Antes de alterar codigo, analisar primeiro a implementacao existente.
- Fazer apenas alteracoes diretamente relacionadas com o pedido.
- Nunca remover ou alterar funcionalidades existentes sem autorizacao explicita.
- Preservar alteracoes locais que ja existam.
- Manter o codigo simples e compativel com a arquitetura atual do TripSplit.
- Quando existir uma decisao de produto ambigua, explicar as opcoes e pedir confirmacao antes de implementar.

## Dados, Supabase e segredos

- Nao alterar Supabase, base de dados, politicas RLS ou configuracao de producao sem autorizacao explicita.
- Nunca expor chaves secretas, service-role keys ou credenciais.

## Verificacao

- Depois de alterar codigo, executar testes ou verificacoes adequadas ao tipo de alteracao.
- Verificar sempre o `git diff` antes de considerar a alteracao concluida.
- Para alteracoes de interface, verificar tambem o comportamento no browser quando possivel.
- Para alteracoes de calculo, testar exemplos concretos e confirmar os resultados.

## Git

- Nao fazer commit ou push automaticamente, salvo autorizacao explicita.

## Relatorio final de cada tarefa

Ao terminar cada tarefa, apresentar:

- ficheiros alterados;
- resumo das alteracoes;
- testes realizados;
- resultado dos testes;
- eventuais problemas ou decisoes pendentes.
