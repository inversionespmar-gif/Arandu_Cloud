// ============================================================
// ICT Strategy - Implementación nativa en JavaScript
// Traduce el Pine Script ICT + Kill Zone + Silver Bullet
// ============================================================

const ICT = (function () {

  // ── Kill Zones (hora ET: startH:startM → endH:endM) ──────
  const KILL_ZONES = [
    { id: 'asia',   name: 'Asia',     startH: 20, startM: 0,  endH: 24, endM: 0,  color: '#3b82f6', bg: 'rgba(59,130,246,0.09)' },
    { id: 'london', name: 'London',   startH: 2,  startM: 0,  endH: 5,  endM: 0,  color: '#ef4444', bg: 'rgba(239,68,68,0.09)' },
    { id: 'nyam',   name: 'NY AM',    startH: 9,  startM: 30, endH: 11, endM: 0,  color: '#10b981', bg: 'rgba(16,185,129,0.11)' },
    { id: 'nylu',   name: 'NY Lunch', startH: 12, startM: 0,  endH: 13, endM: 0,  color: '#f59e0b', bg: 'rgba(245,158,11,0.09)' },
    { id: 'nypm',   name: 'NY PM',    startH: 13, startM: 30, endH: 16, endM: 0,  color: '#8b5cf6', bg: 'rgba(139,92,246,0.09)' },
  ];

  let _chart, _series, _container, _canvas, _ctx;
  let _candles = [];
  let _sessions = [];
  let _signals  = [];
  let _pivotLines = [];

  // ── Hora ET de un timestamp UTC ──────────────────────────
  function toET(ts) {
    const d = new Date(ts * 1000);
    const mon = d.getUTCMonth(); // 0=ene … 11=dic
    // DST simplificado: EDT(UTC-4) mar-oct, EST(UTC-5) nov-feb
    const off = (mon >= 2 && mon <= 10) ? 4 : 5;
    const h = ((d.getUTCHours() - off) + 24) % 24;
    const m = d.getUTCMinutes();
    return h * 60 + m; // minutos desde medianoche ET
  }

  function inZone(ts, kz) {
    const mins   = toET(ts);
    const start  = kz.startH * 60 + kz.startM;
    const end    = kz.endH   * 60 + kz.endM;
    if (start < end) return mins >= start && mins < end;
    return mins >= start || mins < end; // cruza medianoche
  }

  // ── Calcula sesiones a partir de las velas ───────────────
  function calcSessions() {
    _sessions = [];
    for (const kz of KILL_ZONES) {
      let cur = null;
      for (const c of _candles) {
        if (inZone(c.time, kz)) {
          if (!cur) {
            cur = { kz, startTime: c.time, endTime: c.time,
                    high: c.high, low: c.low, hiValid: true, loValid: true };
          } else if (c.time - cur.startTime <= 9 * 3600) {
            cur.endTime = c.time;
            cur.high = Math.max(cur.high, c.high);
            cur.low  = Math.min(cur.low,  c.low);
          } else {
            _sessions.push(cur);
            cur = { kz, startTime: c.time, endTime: c.time,
                    high: c.high, low: c.low, hiValid: true, loValid: true };
          }
        } else if (cur) {
          _sessions.push(cur); cur = null;
        }
      }
      if (cur) _sessions.push(cur);
    }

    // Marcar pivotes rotos (mitigados)
    for (const sess of _sessions) {
      for (const c of _candles) {
        if (c.time <= sess.endTime) continue;
        if (c.high > sess.high) sess.hiValid = false;
        if (c.low  < sess.low)  sess.loValid = false;
      }
    }
  }

  // ── GridBot: señales de reversión ───────────────────────
  // bullish_break  = close > max(high[1..14])
  // bearish_break  = close < min(low[1..14])
  // Bearish signal = bullish_break confirmado (precio llegó y giró)
  // Bullish signal = bearish_break confirmado
  function calcSignals() {
    _signals = [];
    const N = 14;
    if (_candles.length < N + 2) return;

    function isBullBreak(i) {
      const cl = _candles[i].close;
      for (let j = 1; j <= N; j++) if (cl <= _candles[i - j].high) return false;
      return true;
    }
    function isBearBreak(i) {
      const cl = _candles[i].close;
      for (let j = 1; j <= N; j++) if (cl >= _candles[i - j].low) return false;
      return true;
    }

    for (let i = N + 1; i < _candles.length; i++) {
      const prevBull = isBullBreak(i - 1);
      const currBull = isBullBreak(i);
      const prevBear = isBearBreak(i - 1);
      const currBear = isBearBreak(i);

      // Bearish reversal signal (se terminó el breakout alcista)
      if (prevBull && !currBull) {
        _signals.push({ time: _candles[i].time, position: 'aboveBar',
          color: '#ef4444', shape: 'arrowDown', text: 'Bearish Rev.' });
      }
      // Bullish reversal signal (se terminó el breakout bajista)
      if (prevBear && !currBear) {
        _signals.push({ time: _candles[i].time, position: 'belowBar',
          color: '#10b981', shape: 'arrowUp', text: 'Bullish Rev.' });
      }
    }
  }

  // ── RSI(6) calculado desde cero ─────────────────────────
  function calcRSI(period) {
    period = period || 6;
    const rsi = new Array(_candles.length).fill(null);
    if (_candles.length < period + 1) return rsi;

    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const d = _candles[i].close - _candles[i-1].close;
      if (d >= 0) gains += d; else losses -= d;
    }
    let avgG = gains / period, avgL = losses / period;
    rsi[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);

    for (let i = period + 1; i < _candles.length; i++) {
      const d = _candles[i].close - _candles[i-1].close;
      const g = d > 0 ? d : 0;
      const l = d < 0 ? -d : 0;
      avgG = (avgG * (period - 1) + g) / period;
      avgL = (avgL * (period - 1) + l) / period;
      rsi[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    }
    return rsi;
  }

  // ── Canvas: dibuja las cajas de sessión ─────────────────
  function draw() {
    if (!_ctx || !_chart) return;
    const W = _canvas.width, H = _canvas.height;
    _ctx.clearRect(0, 0, W, H);
    const ts = _chart.timeScale();

    for (const sess of _sessions) {
      const x1 = ts.timeToCoordinate(sess.startTime);
      const x2 = ts.timeToCoordinate(sess.endTime);
      if (x1 === null || x2 === null) continue;
      const rx1 = Math.max(0, x1), rx2 = Math.min(W - 64, x2);
      if (rx2 < 0 || rx1 > W) continue;

      _ctx.fillStyle = sess.kz.bg;
      _ctx.fillRect(rx1, 0, rx2 - rx1, H);

      // Borde izquierdo
      _ctx.strokeStyle = sess.kz.color + 'cc';
      _ctx.lineWidth = 1.5;
      _ctx.setLineDash([]);
      _ctx.beginPath();
      _ctx.moveTo(x1 + 0.5, 0);
      _ctx.lineTo(x1 + 0.5, H);
      _ctx.stroke();

      // Etiqueta
      if (rx2 - rx1 > 20) {
        _ctx.fillStyle = sess.kz.color;
        _ctx.font = 'bold 9px "Inter", sans-serif';
        _ctx.fillText(sess.kz.name, rx1 + 4, 13);
      }
    }
  }

  // ── Price lines para los pivotes de sesión ───────────────
  function updatePivots() {
    for (const pl of _pivotLines) {
      try { _series.removePriceLine(pl); } catch(e) {}
    }
    _pivotLines = [];

    // Solo las últimas 3 sesiones por zona (15 en total)
    const recent = _sessions.slice(-15);
    for (const sess of recent) {
      if (sess.hiValid) {
        _pivotLines.push(_series.createPriceLine({
          price: sess.high, color: sess.kz.color,
          lineWidth: 1, lineStyle: 0,
          axisLabelVisible: true, title: sess.kz.name + '.H'
        }));
      }
      if (sess.loValid) {
        _pivotLines.push(_series.createPriceLine({
          price: sess.low, color: sess.kz.color + 'aa',
          lineWidth: 1, lineStyle: 2,
          axisLabelVisible: true, title: sess.kz.name + '.L'
        }));
      }
    }
  }

  function updateMarkers() {
    _series.setMarkers(_signals);
  }

  function resize() {
    _canvas.width  = _container.clientWidth;
    _canvas.height = _container.clientHeight;
    draw();
  }

  // ── API pública ──────────────────────────────────────────
  return {
    init(chart, series, container) {
      _chart = chart; _series = series; _container = container;
      _canvas = document.createElement('canvas');
      _canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:5;';
      container.appendChild(_canvas);
      _ctx = _canvas.getContext('2d');

      chart.timeScale().subscribeVisibleLogicalRangeChange(draw);

      const ro = new ResizeObserver(resize);
      ro.observe(container);
      resize();
      return this;
    },

    // Carga completa de velas históricas
    loadCandles(candles) {
      _candles = [...candles];
      calcSessions();
      calcSignals();
      draw();
      updatePivots();
      updateMarkers();
    },

    // Actualización en tiempo real (nueva vela o actualización de la última)
    updateCandle(candle) {
      const last = _candles[_candles.length - 1];
      if (last && last.time === candle.time) {
        _candles[_candles.length - 1] = candle;
      } else {
        _candles.push(candle);
      }
      calcSessions();
      calcSignals();
      draw();
      updatePivots();
      updateMarkers();
    },

    // Limpia todo el overlay al cambiar de activo/temporalidad
    clear() {
      _candles = []; _sessions = []; _signals = [];
      for (const pl of _pivotLines) {
        try { _series.removePriceLine(pl); } catch(e) {}
      }
      _pivotLines = [];
      _series.setMarkers([]);
      if (_ctx) _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    },

    // Expone RSI calculado (array paralelo a candles)
    getRSI: (p) => calcRSI(p)
  };
})();
