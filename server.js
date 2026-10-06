const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const rooms = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function cryptoRandom(){ return crypto.randomBytes(18).toString('hex'); }

function code() {
  let s;
  do { s = Array.from({length: 6}, () => alphabet[Math.floor(Math.random()*alphabet.length)]).join(''); }
  while (rooms.has(s));
  return s;
}
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function publicRoom(room) {
  return {
    code: room.code,
    host: room.host,
    started: room.started,
    current: room.current,
    turn: room.turn,
    maxPlayers: room.maxPlayers,
    players: [...room.players.values()].map(p => ({id:p.id,name:p.name,faction:p.faction,ready:p.ready,slot:p.slot}))
  };
}
function broadcast(room, msg) { for (const p of room.players.values()) send(p.ws, msg); }
function stateFor(room, playerId) {
  const pl=room.players.get(playerId);
  return { room: publicRoom(room), game: room.game || null, me: playerId, slot: pl?.slot ?? null, token: pl?.token || null };
}
function sendState(room) { for (const p of room.players.values()) send(p.ws, {type:'state', ...stateFor(room,p.id)}); }

const html = fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const gameHtml = fs.readFileSync(path.join(ROOT,'public','game.html'),'utf8');
const server = http.createServer((req,res)=>{
  let body;
  if (req.url === '/health') { res.writeHead(200, {'Content-Type':'application/json'}); return res.end(JSON.stringify({ok:true,game:'VALTHERION ONLINE',rooms:rooms.size})); }
  if (req.url === '/' || req.url.startsWith('/index.html')) body = html;
  else if (req.url.startsWith('/game.html')) body = gameHtml;
  else { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}); res.end(body);
});
const wss = new WebSocketServer({server});

wss.on('connection', ws => {
  const id = Math.random().toString(36).slice(2,10);
  let room = null;
  let player = null;
  send(ws, {type:'hello', id});

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return send(ws,{type:'error',message:'Mensagem inválida.'}); }
    if (m.type === 'resume') {
      const targetCode=String(m.code||'').toUpperCase();
      const r=rooms.get(targetCode);
      if(!r) return send(ws,{type:'error',message:'Sala não encontrada.'});
      const found=[...r.players.values()].find(p=>p.token===m.token);
      if(!found) return send(ws,{type:'error',message:'Sessão expirada. Volte ao lobby.'});
      room=r; player=found; player.ws=ws;
      send(ws,{type:'resumed',...stateFor(room,player.id)});
      if(room.game) send(ws,{type:'state',...stateFor(room,player.id)});
      else broadcast(room,{type:'room',room:publicRoom(room)});
      return;
    }
    if (m.type === 'create') {
      if (room) return;
      room = {code:code(), host:id, started:false, current:0, turn:1, maxPlayers:Math.max(2,Math.min(6,Number(m.maxPlayers)||3)), players:new Map(), game:null};
      player = {id,name:String(m.name||'Jogador').slice(0,24),faction:String(m.faction||'Nharok'),ready:true,slot:0,ws,token:cryptoRandom()};
      room.players.set(id,player); rooms.set(room.code,room);
      send(ws,{type:'joined',code:room.code,id,token:player.token}); broadcast(room,{type:'room',room:publicRoom(room)});
      return;
    }
    if (m.type === 'join') {
      if (room) return;
      room = rooms.get(String(m.code||'').toUpperCase());
      if (!room) return send(ws,{type:'error',message:'Sala não encontrada.'});
      if (room.started) return send(ws,{type:'error',message:'A partida já começou.'});
      if (room.players.size >= room.maxPlayers) return send(ws,{type:'error',message:'Sala cheia.'});
      const taken=[...room.players.values()].map(p=>p.slot); let slot=0; while(taken.includes(slot)) slot++;
      player={id,name:String(m.name||'Jogador').slice(0,24),faction:String(m.faction||'Nharok'),ready:false,slot,ws,token:cryptoRandom()}; room.players.set(id,player);
      send(ws,{type:'joined',code:room.code,id,token:player.token}); broadcast(room,{type:'room',room:publicRoom(room)}); return;
    }
    if (!room || !player) return send(ws,{type:'error',message:'Entre em uma sala primeiro.'});
    if (m.type === 'setReady') { if (!room.started) { player.ready=!!m.ready; broadcast(room,{type:'room',room:publicRoom(room)}); } return; }
    if (m.type === 'setConfig') { if (!room.started) { player.name=String(m.name||player.name).slice(0,24); player.faction=String(m.faction||player.faction); broadcast(room,{type:'room',room:publicRoom(room)}); } return; }
    if (m.type === 'start') {
      if (id !== room.host || room.started) return;
      const ps=[...room.players.values()];
      if(ps.length<2) return send(ws,{type:'error',message:'É preciso ter pelo menos 2 jogadores.'});
      if(ps.some(p=>!p.ready)) return send(ws,{type:'error',message:'Todos precisam estar prontos.'});
      room.started=true; room.current=0; room.turn=1; room.game=null;
      const configs=ps.map(p=>({name:p.name,faction:p.faction,human:true}));
      broadcast(room,{type:'startGame',room:publicRoom(room),configs,host:id});
      return;
    }
    if (m.type === 'initGame') {
      if (!room.started || id !== room.host || room.game || !m.game) return;
      room.game=m.game; room.turn=Number(m.game.turn)||1; room.current=Number(m.game.current)||0;
      sendState(room); return;
    }
    if (m.type === 'syncGame') {
      if (!room.started || !m.game) return;
      const current=Number(m.game.current);
      if (!Number.isInteger(current) || current<0 || current>=room.players.size) return;
      if (player.slot !== current) return send(ws,{type:'error',message:'Não é seu turno.'});
      room.game=m.game; room.turn=Number(m.game.turn)||room.turn; room.current=current; sendState(room);
      return;
    }
    if (m.type === 'hostAction') {
      if (id !== room.host || !room.started) return;
      const g=room.game; if(!g) return;
      if (m.action === 'nextTurn') { room.current=(room.current+1)%g.players.length; if(room.current===0) room.turn++; for(const p of g.players)p.ap=5; g.log.push({turn:room.turn,msg:`Turno ${room.turn}: ${g.players[room.current].name} age.`}); sendState(room); }
      else if (m.action === 'message') { g.log.push({turn:room.turn,msg:`💬 ${String(m.text||'').slice(0,180)}`}); sendState(room); }
      return;
    }
    if (m.type === 'chat') { broadcast(room,{type:'chat',from:player.name,text:String(m.text||'').slice(0,180)}); return; }
  });
  ws.on('close',()=>{
    if(room&&player){
      player.ws=null;
      setTimeout(()=>{
        if(player.ws===null && room && room.players.has(player.id)){
          room.players.delete(player.id);
          if(room.players.size===0) rooms.delete(room.code);
          else { if(room.host===player.id) room.host=[...room.players.keys()][0]; broadcast(room,{type:'room',room:publicRoom(room)}); sendState(room); }
        }
      },90000);
    }
  });
});
server.listen(PORT,()=>console.log(`VALTHERION ONLINE em http://localhost:${PORT}`));
