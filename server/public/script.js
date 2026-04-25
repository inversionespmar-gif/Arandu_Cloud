const socket = io('http://localhost:3002', { path: '/ws-trading' });

// UI Elements
const currentPriceEl = document.getElementById('currentPrice');
const marketNameEl = document.getElementById('marketName');
const exchangeNameEl = document.getElementById('exchangeName');
const highValEl = document.getElementById('highVal');
const lowValEl = document.getElementById('lowVal');
const marketInput = document.getElementById('marketInput');
const timeframeSelect = document.getElementById('timeframeSelect');
const updateBtn = document.getElementById('updateBtn');
const connectionStatus = document.getElementById('connectionStatus');
const sysLogsEl = document.getElementById('sysLogs');
const serverHealthEl = document.getElementById('serverHealth');

const indicatorSearch = document.getElementById('indicatorSearch');
const searchSuggestions = document.getElementById('searchSuggestions');
const activeIndicatorsList = document.getElementById('activeIndicators');

const pineModal = document.getElementById('pineModal');
const pineCodeArea = document.getElementById('pineCodeArea');
const runPineBtn = document.getElementById('runPineBtn');

function log(msg) {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'mb-1';
    entry.innerHTML = `<span class="text-slate-400">[${time}]</span> ${msg}`;
    sysLogsEl.prepend(entry);
}

// Chart Setup
const chartContainer = document.getElementById('chartContainer');
let chartObj = null;
let candleSeries = null;
const indicatorSeries = {}; 

function initChart() {
    if (chartObj) return;
    chartObj = LightweightCharts.createChart(chartContainer, {
        layout: {
            background: { type: 'solid', color: '#ffffff' },
            textColor: '#64748b',
        },
        grid: {
            vertLines: { color: '#f1f5f9' },
            horzLines: { color: '#f1f5f9' },
        },
        timeScale: { 
            timeVisible: true, 
            secondsVisible: false, 
            borderColor: '#e2e8f0' 
        },
        rightPriceScale: { 
            borderColor: '#e2e8f0',
            autoScale: true,
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: { color: '#cbd5e1', width: 1, style: 2 },
            horzLine: { color: '#cbd5e1', width: 1, style: 2 },
        },
        width: w,
        height: h
    });

    candleSeries = chartObj.addCandlestickSeries({
        upColor: '#10b981', 
        downColor: '#ef4444',
        borderVisible: false, 
        wickUpColor: '#10b981', 
        wickDownColor: '#ef4444',
    });

    const ro = new ResizeObserver(() => {
        const { w, h } = getChartSize();
        if (w > 0 && h > 0) chartObj.resize(w, h);
    });
    ro.observe(chartContainer);
}

initChart();

const colors = ['#2563eb', '#f59e0b', '#d946ef', '#8b5cf6', '#06b6d4', '#84cc16'];
let colorIndex = 0;

// Socket Events
socket.on('connect', () => {
    log('<span class="text-blue-600 font-bold">Backend Conectado</span>');
    connectionStatus.className = 'status connected text-[10px] font-bold px-2 py-1 bg-emerald-100 text-emerald-700 rounded';
    connectionStatus.innerText = 'Online';
    serverHealthEl.innerText = socket.id.substring(0, 8);
    requestMarket();
});

function requestMarket() {
    log(`Cargando ${marketInput.value} (${timeframeSelect.value}m)...`);
    socket.emit('set_market', {
        market: marketInput.value,
        timeframe: timeframeSelect.value
    });
}

socket.on('market_info', (info) => {
    log('Activo: ' + info.description);
    marketNameEl.innerText = info.description;
    exchangeNameEl.innerText = info.exchange;
    
    candleSeries.setData([]);
    Object.values(indicatorSeries).forEach(seriesList => {
        seriesList.forEach(s => chartObj.removeSeries(s.series));
    });
    for (const key in indicatorSeries) delete indicatorSeries[key];
    activeIndicatorsList.innerHTML = '<div class="text-[11px] text-slate-400 italic">No hay indicadores</div>';
});

socket.on('initial_data', (history) => {
    candleSeries.setData(history);
});

socket.on('price_update', (data) => {
    candleSeries.update(data.period);
    currentPriceEl.innerText = data.price.toLocaleString(undefined, { minimumFractionDigits: 2 });
    highValEl.innerText = data.period.high.toLocaleString(undefined, { minimumFractionDigits: 2 });
    lowValEl.innerText = data.period.low.toLocaleString(undefined, { minimumFractionDigits: 2 });
});

// Indicator Search
let searchTimeout;
indicatorSearch.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    if (indicatorSearch.value.length < 2) return;
    searchTimeout = setTimeout(() => socket.emit('search_indicator', indicatorSearch.value), 500);
});

socket.on('search_results', (results) => {
    searchSuggestions.innerHTML = '';
    results.slice(0, 15).forEach(res => {
        const div = document.createElement('div');
        div.className = 'group p-3 border border-transparent hover:border-blue-200 hover:bg-blue-50 rounded-lg cursor-pointer flex justify-between items-center transition-all';
        div.innerHTML = `
            <div class="flex flex-col">
                <span class="text-xs font-bold text-slate-700 group-hover:text-blue-700">${res.name}</span>
                <span class="text-[10px] text-slate-400">v${res.version} · ${res.author}</span>
            </div>
            <span class="material-symbols-outlined text-slate-300 group-hover:text-blue-500 scale-75">add_circle</span>
        `;
        div.onclick = () => {
            socket.emit('add_indicator', { id: res.id, version: res.version });
            document.getElementById('searchModal').classList.add('hidden');
        };
        searchSuggestions.appendChild(div);
    });
});

// Pine Script Execution
runPineBtn.onclick = () => {
    if (!pineCodeArea.value) return;
    log('Compilando Script Personalizado...');
    socket.emit('add_pine_code', { code: pineCodeArea.value, name: 'Personalizado' });
    pineModal.classList.add('hidden');
};

socket.on('indicator_ready', (data) => {
    log('Iniciado: ' + data.name);
    if (activeIndicatorsList.querySelector('.italic')) activeIndicatorsList.innerHTML = '';

    const div = document.createElement('div');
    div.className = 'flex items-center justify-between p-2 bg-white border border-slate-200 rounded text-[11px] hover:border-blue-300 transition-colors group';
    div.innerHTML = `
        <span class="truncate pr-2 font-medium">${data.name}</span>
        <button class="remove-btn text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
            <span class="material-symbols-outlined scale-75">delete</span>
        </button>
    `;
    div.querySelector('.remove-btn').onclick = () => {
        socket.emit('remove_indicator', { id: data.id });
        if (indicatorSeries[data.id]) {
            indicatorSeries[data.id].forEach(item => chartObj.removeSeries(item.series));
            delete indicatorSeries[data.id];
        }
        div.remove();
        if (activeIndicatorsList.children.length === 0) {
            activeIndicatorsList.innerHTML = '<div class="text-[11px] text-slate-400 italic">No hay indicadores</div>';
        }
    };
    activeIndicatorsList.appendChild(div);

    indicatorSeries[data.id] = [];
    const plots = data.plots || {};
    const plotCount = Object.keys(plots).length || 5;
    
    for (let i = 0; i < plotCount; i++) {
        const id = Object.keys(plots)[i] || `plot_${i}`;
        const series = chartObj.addLineSeries({
            color: colors[colorIndex++ % colors.length],
            lineWidth: 1,
            title: plots[id] || `P${i}`
        });
        indicatorSeries[data.id].push({ series, plotId: id });
    }
});

socket.on('indicator_update', (data) => {
    const seriesList = indicatorSeries[data.id];
    if (seriesList && data.values) {
        seriesList.forEach(item => {
            const val = data.values[item.plotId];
            if (val !== undefined && val !== null) {
                item.series.update({ time: data.values.$time, value: val });
            }
        });
    }

    if (data.graphics && data.graphics.labels) {
        const markers = [];
        data.graphics.labels.forEach(lbl => {
            markers.push({
                time: lbl.x,
                position: lbl.style === 'label_down' ? 'aboveBar' : 'belowBar',
                color: lbl.textcolor || '#2563eb',
                shape: lbl.style === 'label_down' ? 'arrowDown' : 'arrowUp',
                text: lbl.text
            });
        });
        if (markers.length > 0) {
            candleSeries.setMarkers(markers);
        }
    }
});

// Event Listeners
updateBtn.onclick = requestMarket;
marketInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') requestMarket(); });
timeframeSelect.onchange = requestMarket;
document.getElementById('openSearchBtn').onclick = () => document.getElementById('searchModal').classList.remove('hidden');
document.getElementById('openPineBtn').onclick = () => document.getElementById('pineModal').classList.remove('hidden');
document.querySelectorAll('.close-modal').forEach(btn => btn.onclick = () => btn.closest('.modal').classList.add('hidden'));

socket.on('server_error', (msg) => {
    log(`<span class="text-red-500 font-bold">ERROR: ${msg}</span>`);
});
