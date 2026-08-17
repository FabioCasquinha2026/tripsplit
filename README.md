# TripSplit

Versão estática do TripSplit preparada para publicação num alojamento HTTPS.

## Funcionalidades
- Criar e ligar a uma viagem por código.
- Participantes com proteção contra nomes duplicados.
- Adicionar/remover participantes.
- Despesas em EUR, COP e USD.
- Conversão para EUR.
- Pré-visualização da conversão antes de guardar.
- Escolha de quem pagou.
- Escolha de quem participou, com "Todos" e "Nenhum".
- Saldo individual.
- Acerto de contas simplificado.
- Introdução por voz usando Web Speech API quando suportada pelo browser.
- Modo local com localStorage para testes.
- Sincronização entre dispositivos através de Supabase quando `config.js` estiver configurado.

## Publicação
Subir `index.html`, `styles.css`, `config.js`, `app.js` e, se for usar Supabase, executar `supabase_schema.sql` no SQL Editor do Supabase.

Depois, configurar `config.js` com:
- `supabaseUrl`
- `supabaseKey` (publishable/anon, nunca service_role)

GitHub Pages serve o site por HTTPS, o que permite ao browser pedir autorização para o microfone.

## Nota
Esta é uma reconstrução independente da versão testada na conversa. O código anterior que estava a correr no telemóvel não ficou disponível como ficheiro nesta conversa, por isso não é apresentada como uma cópia byte-a-byte da versão anterior.
