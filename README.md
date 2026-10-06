# ⚔️ VALTHERION ONLINE 2.0

Versão multiplayer online do VALTHERION, com salas por código, WebSocket, turnos sincronizados e o motor completo de territórios, economia, construção, recrutamento, generais, logística, magia, diplomacia, cerco e batalha.

## Rodar localmente

```bash
npm install
npm start
```

Abra `http://localhost:3000`.

## Publicar no Render

1. Crie um repositório no GitHub e envie **todo o conteúdo desta pasta** para ele.
2. No Render, crie um **Web Service** conectado ao repositório.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Node: 18+.
6. Publique.

O servidor usa `process.env.PORT`, portanto funciona com a porta fornecida pela hospedagem. WebSocket usa automaticamente `wss://` quando o site estiver em HTTPS.

Health check: `/health`

## Multiplayer

- Criação de sala com código de 6 caracteres.
- 2 a 6 jogadores.
- Reconexão por token de sessão.
- Lobby com pronto/aguardando.
- O mestre inicia a guerra.
- O primeiro cliente do mestre inicializa o motor completo.
- O estado do jogo é sincronizado pelo servidor.
- Apenas o jogador cujo turno está ativo pode enviar alterações do estado.
- O motor completo existente em `public/game.html` é usado no modo online.
- O jogo local continua disponível quando `game.html` é aberto sem `?online=1`.

## Observação sobre hospedagem gratuita

Salas são mantidas em memória no processo do servidor. Se a hospedagem reiniciar o processo, as salas ativas são encerradas. Isso é adequado para partidas de teste. Para partidas persistentes, a próxima evolução é usar banco de dados/Redis.
