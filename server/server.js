require('dotenv').config();
const express    = require('express');
const http       = require('http');
const socketIo   = require('socket.io');
const path       = require('path');
const TradingView = require('@mathieuc/tradingview');
const { createClient } = require('@supabase/supabase-js');

// ==========================================
// 1. CONFIGURACIÓN DEL SERVIDOR WEB Y WEBSOCKET
// ==========================================
const app    = express();
const server = http.createServer(app);
const io     = socketIo(server, {
  path: '/ws-trading',
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Servir la carpeta public (el Dashboard UI)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ==========================================
// 2. CONFIGURACIÓN DE SUPABASE
// ==========================================
const supabaseUrl = process.env.SUPABASE_URL || 'TU_URL_DE_SUPABASE';
const supabaseKey = process.env.SUPABASE_KEY || 'TU_ANON_KEY';
const supabase = createClient(supabaseUrl, supabaseKey);

const client = new TradingView.Client();
console.log('Conectado a la API de TradingView');

// ==========================================
// 3. LÓGICA DE DETECCIÓN (KILL ZONES Y REVERSALS)
// ==========================================
const KILL_ZONES = [
  { id: 'london', name: 'London',   startH: 2,  startM: 0,  endH: 5,  endM: 0  },
  { id: 'nyam',   name: 'NY AM',    startH: 9,  startM: 30, endH: 11, endM: 0  },
  { id: 'nylu',   name: 'NY Lunch', startH: 12, startM: 0,  endH: 13, endM: 0  },
  { id: 'nypm',   name: 'NY PM',    startH: 13, startM: 30, endH: 16, endM: 0  },
];

function toETminutes(utcTs) {
  const d   = new Date(utcTs * 1000);
  const mon = d.getUTCMonth();
  const off = (mon >= 2 && mon <= 10) ? 4 : 5;
  const h   = ((d.getUTCHours() - off) + 24) % 24;
  return h * 60 + d.getUTCMinutes();
}

function currentKillZone(utcTs) {
  const mins = toETminutes(utcTs);
  for (const kz of KILL_ZONES) {
    const s = kz.startH * 60 + kz.startM;
    const e = kz.endH   * 60 + kz.endM;
    const inZone = (s < e) ? (mins >= s && mins < e) : (mins >= s || mins < e);
    if (inZone) return kz;
  }
  return null;
}

function detectSignal(candles) {
  const N = 14;
  if (candles.length < N + 2) return null;
  const i   = candles.length - 1;
  const pi  = i - 1;
  function isBullBreak(idx) {
    const cl = candles[idx].close;
    for (let j = 1; j <= N; j++) if (cl <= candles[idx - j].high) return false;
    return true;
  }
  function isBearBreak(idx) {
    const cl = candles[idx].close;
    for (let j = 1; j <= N; j++) if (cl >= candles[idx - j].low) return false;
    return true;
  }
  const prevBull = isBullBreak(pi), currBull = isBullBreak(i);
  const prevBear = isBearBreak(pi), currBear = isBearBreak(i);
  if (prevBull && !currBull) return { direction: 'SELL', label: 'Bearish Reversal' };
  if (prevBear && !currBear) return { direction: 'BUY',  label: 'Bullish Reversal' };
  return null;
}

// Emisión general a los dashboards conectados (tu celular, tu pc, etc)
function broadcastDashboards(event, data) {
  io.emit(event, data);
}

// ==========================================
// 4. WEBSOCKETS CON LOS CLIENTES DEL DASHBOARD
// ==========================================
io.on('connection', (socket) => {
  console.log('[+] Dashboard conectado:', socket.id);

  let chart = null;
  let candles = [];
  let currentMarket = 'BINANCE:BTCUSDT';
  let lastSignalTime = 0;

  socket.on('set_market', (data) => {
    currentMarket = (data.market || 'BINANCE:BTCUSDT').toUpperCase();
    const timeframe = data.timeframe || '15';
    console.log(`[${socket.id}] Iniciando gráfico ${currentMarket} TF:${timeframe}`);

    if (chart) { try { chart.delete(); } catch(e) {} }
    candles = [];
    lastSignalTime = 0;

    try {
      chart = new client.Session.Chart();
      chart.setMarket(currentMarket, { timeframe, range: 2000 });

      let historySent = false;

      chart.onSymbolLoaded(() => {
        socket.emit('market_info', {
          description: chart.infos.description,
          exchange:    chart.infos.exchange,
          timeframe
        });
      });

      chart.onUpdate(async () => {
        const p = chart.periods[0];
        if (!p) return;

        const candle = { time: p.time, open: p.open, high: p.max, low: p.min, close: p.close };

        if (!historySent && chart.periods.length > 10) {
          historySent = true;
          candles = chart.periods.slice().reverse().map(pp => ({ time: pp.time, open: pp.open, high: pp.max, low: pp.min, close: pp.close }));
          socket.emit('initial_data', candles);
        } else {
          if (candles.length > 0 && candles[candles.length - 1].time === candle.time) {
            candles[candles.length - 1] = candle;
          } else {
            candles.push(candle);
            if (candles.length > 2000) candles.shift();
          }
        }

        // Actualiza el precio en el Dashboard (Front-End)
        socket.emit('price_update', { price: p.close, period: candle });

        // Detección de Señales ICT
        if (candles.length >= 16) {
          const signal = detectSignal(candles);
          if (signal) {
            const kz = currentKillZone(candle.time);
            const inZone = kz !== null;
            const killZoneName = kz ? kz.name : 'Fuera de sesión';

            const signalPayload = {
              direction: signal.direction,
              label:     signal.label,
              symbol:    currentMarket,
              price:     candle.close,
              time:      candle.time,
              killZone:  killZoneName,
              inKillZone: inZone
            };

            // Notifica al Dashboard web (Para animaciones e historial visual)
            socket.emit('ict_signal_detected', signalPayload);

            // ==========================================
            // GUARDAR LA SEÑAL EN SUPABASE PARA EL BOT MQL5
            // ==========================================
            if (lastSignalTime !== candle.time) {
              lastSignalTime = candle.time;
              console.log(`[ICT] ${signal.direction} @ ${candle.close} | Subiendo a Supabase...`);

              // Usamos Supabase en lugar del puente Python local
              const { error } = await supabase.from('signals').insert([{
                symbol: currentMarket,
                direction: signal.direction,
                price: candle.close,
                kill_zone: killZoneName,
                in_killzone: inZone,
                status: 'PENDING'
              }]);

              if (error) {
                console.error('[ERROR SUPABASE]', error.message);
              } else {
                console.log('✅ Señal en la Nube. Lista para MT5.');
                // Muestra un mensajito verde en el dashboard indicando que se subió al cloud
                broadcastDashboards('mt5_signal', signalPayload); 
              }
            }
          }
        }
      });

      chart.onError((err) => socket.emit('server_error', 'Error de mercado: ' + err));

    } catch (e) {
      console.error('Error al crear chart:', e.message);
      socket.emit('server_error', 'Error: ' + e.message);
    }
  });

  socket.on('disconnect', () => {
    console.log('[-] Dashboard desconectado:', socket.id);
    if (chart) { try { chart.delete(); } catch(e) {} }
  });
});

// Render inyecta un PORT dinámico, así que usamos process.env.PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n=========================================`);
  console.log(`ARANDU CLOUD OPERATIVO`);
  console.log(`Dashboard Web:  http://localhost:${PORT}`);
  console.log(`Base de Datos:  Conectado a Supabase`);
  console.log(`=========================================\n`);
});
