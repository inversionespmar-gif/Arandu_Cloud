//+------------------------------------------------------------------+
//|                                                     AranduEA.mq5 |
//|                        Arandu Cloud Trading Bot - Supabase       |
//+------------------------------------------------------------------+
#property copyright "Arandu"
#property link      "https://arandu.com"
#property version   "1.00"

// ==========================================
// CONFIGURACIÓN DE LA BASE DE DATOS Y RIESGO
// ==========================================
input string   SupabaseUrl = "https://xxxxxx.supabase.co/rest/v1/signals";
input string   SupabaseKey = "eyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; // Reemplaza por tu ANON KEY

input double   RiskPercent = 1.0;
input double   SL_Pips     = 50000;
input double   RR_Ratio    = 2.0;

int timer_interval = 2; // El bot buscará nuevas señales cada 2 segundos

input ulong    MagicNumber    = 123456;
input bool     UseTrailing    = true;
input double   TrailingPct    = 0.02; // Iniciar Trailing al 2% de ganancia del TP

// Inicialización
int OnInit() {
    Print("Arandu Cloud EA iniciado. Escuchando base de datos Supabase...");
    EventSetTimer(timer_interval);
    return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason) {
    EventKillTimer();
}

// Loop Principal
void OnTimer() {
    CheckForSignals();
    if(UseTrailing) ManageTrailingStop();
}

// ==========================================
// LÓGICA DE TRAILING STOP
// ==========================================
void ManageTrailingStop() {
    string symbol = Symbol();
    double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
    double spread = SymbolInfoInteger(symbol, SYMBOL_SPREAD) * point;
    double tickSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
    double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
    
    for(int i = PositionsTotal() - 1; i >= 0; i--) {
        string pos_symbol = PositionGetSymbol(i);
        if(pos_symbol != symbol) continue;
        
        ulong magic = PositionGetInteger(POSITION_MAGIC);
        if(magic != MagicNumber) continue;
        
        ulong ticket = PositionGetInteger(POSITION_TICKET);
        double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
        double currentSL = PositionGetDouble(POSITION_SL);
        double currentTP = PositionGetDouble(POSITION_TP);
        double currentPrice = PositionGetDouble(POSITION_PRICE_CURRENT);
        double volume = PositionGetDouble(POSITION_VOLUME);
        long type = PositionGetInteger(POSITION_TYPE);
        
        // Extraer Costos: Comisión y Swap (normalmente son valores negativos)
        double commission = MathAbs(PositionGetDouble(POSITION_COMMISSION));
        double swap = MathAbs(PositionGetDouble(POSITION_SWAP));
        // Multiplicamos comisión x2 por si el broker cobra la salida también
        double totalCosts = (commission * 2.0) + swap; 
        
        // Convertir el costo en dinero a distancia en precio
        double costPerTick = tickValue * volume;
        double costDistance = 0;
        if(costPerTick > 0) {
            costDistance = (totalCosts / costPerTick) * tickSize;
        }
        
        // Beneficio total necesario asumiendo que TP fue seteado
        double totalProfitDistance = MathAbs(currentTP - openPrice);
        if(totalProfitDistance <= 0) continue;
        
        // Distancia actual a favor
        double currentProfitDistance = (type == POSITION_TYPE_BUY) ? (currentPrice - openPrice) : (openPrice - currentPrice);
        
        // Si ya recorrió el X% del TP (ej. 2%)
        if(currentProfitDistance >= (totalProfitDistance * TrailingPct)) {
            // Calcular el nuevo nivel: Break Even + Spread + Costos (Comisión/Swap) + La mitad de la ganancia extra
            double targetSL = 0;
            double protectionDistance = spread + costDistance;
            
            if(type == POSITION_TYPE_BUY) {
                targetSL = openPrice + protectionDistance + (currentProfitDistance * 0.5); 
                if(targetSL > currentSL && targetSL < currentPrice) {
                    MqlTradeRequest request; MqlTradeResult result;
                    ZeroMemory(request); ZeroMemory(result);
                    request.action = TRADE_ACTION_SLTP;
                    request.position = ticket;
                    request.sl = targetSL;
                    request.tp = currentTP;
                    OrderSend(request, result);
                }
            } else if(type == POSITION_TYPE_SELL) {
                targetSL = openPrice - protectionDistance - (currentProfitDistance * 0.5);
                if((currentSL == 0 || targetSL < currentSL) && targetSL > currentPrice) {
                    MqlTradeRequest request; MqlTradeResult result;
                    ZeroMemory(request); ZeroMemory(result);
                    request.action = TRADE_ACTION_SLTP;
                    request.position = ticket;
                    request.sl = targetSL;
                    request.tp = currentTP;
                    OrderSend(request, result);
                }
            }
        }
    }
}

// ==========================================
// LÓGICA DE CONEXIÓN CON SUPABASE
// ==========================================
void CheckForSignals() {
    string cookie = NULL, headers;
    char post[], result[];
    string result_headers;
    
    // Headers requeridos por Supabase
    headers = "apikey: " + SupabaseKey + "\r\n";
    headers += "Authorization: Bearer " + SupabaseKey + "\r\n";
    headers += "Content-Type: application/json\r\n";
    
    // Construir la URL para traer la señal más reciente que esté 'PENDING'
    string url = SupabaseUrl + "?status=eq.PENDING&order=id.desc&limit=1";
    
    // Ejecutar petición HTTP
    int res = WebRequest("GET", url, headers, 5000, post, result, result_headers);
    
    if(res == 200) {
        string json = CharArrayToString(result);
        
        // Supabase devuelve un array vacio "[]" si no hay registros
        if (StringLen(json) > 5 && StringFind(json, "direction") > 0) {
            ProcessSignal(json);
        }
    } else {
        // -1 significa que MT5 tiene bloqueado el WebRequest (Hay que permitir la URL en Opciones)
        if(res == -1) {
            Print("ERROR: MT5 bloqueó la conexión. Ve a Herramientas -> Opciones -> Asesores Expertos y permite el WebRequest para tu URL de Supabase.");
        } else if (res != 400 && res != 404) {
             Print("Error HTTP conectando a Supabase: ", res);
        }
    }
}

// ==========================================
// LÓGICA DE EJECUCIÓN
// ==========================================
void ProcessSignal(string json) {
    Print("\n¡SEÑAL ENCONTRADA EN LA NUBE!: ", json);
    
    // NOTA TÉCNICA: En MQL5 normalmente usaríamos la librería estandar JAson
    // Para no requerir dependencias externas, buscaremos el ID y la dirección con StringFind
    
    // 1. Extraer Dirección (BUY o SELL)
    int dirIndex = StringFind(json, "\"direction\":\"");
    string direction = "";
    if(dirIndex > 0) {
        dirIndex += 13;
        if(StringSubstr(json, dirIndex, 3) == "BUY") direction = "BUY";
        if(StringSubstr(json, dirIndex, 4) == "SELL") direction = "SELL";
    }
    
    // 2. Extraer ID para marcarla como completada
    int idIndex = StringFind(json, "\"id\":");
    string idStr = "";
    if(idIndex > 0) {
        idIndex += 5;
        int endId = StringFind(json, ",", idIndex);
        idStr = StringSubstr(json, idIndex, endId - idIndex);
    }
    
    if(direction == "") {
        Print("No se pudo extraer la dirección de la señal.");
        return;
    }
    
    Print("Ejecutando orden: ", direction);
    
    // ==========================================
    // EJECUCIÓN NATIVA MT5: RIESGO Y LOTAJE
    // ==========================================
    string symbol = Symbol();
    double minLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
    double maxLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
    double lotStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
    double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
    double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
    double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
    
    // Cálculo de Balance y Riesgo Monetario
    double balance = AccountInfoDouble(ACCOUNT_BALANCE);
    double riskMoney = balance * (RiskPercent / 100.0);
    
    // En criptos, un pip a veces es 1 dólar, y a veces 0.01 dependiendo del broker.
    // Usaremos un aproximado estándar para BTC o dejamos que el SL_Pips venga fijo.
    double slDistance = SL_Pips * point;
    if(slDistance <= 0) slDistance = 50 * point; // Fallback
    
    // El valor monetario de 1 lote por la distancia del SL
    double tickSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
    double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
    double moneyPerLot = (slDistance / tickSize) * tickValue;
    
    double calculatedLot = minLot;
    if (moneyPerLot > 0) {
        calculatedLot = riskMoney / moneyPerLot;
    }
    
    // Redondear el lote al step permitido por el broker
    calculatedLot = MathRound(calculatedLot / lotStep) * lotStep;
    if (calculatedLot < minLot) calculatedLot = minLot;
    if (calculatedLot > maxLot) calculatedLot = maxLot;
    
    // Preparamos la estructura de la orden
    MqlTradeRequest request;
    MqlTradeResult  result;
    ZeroMemory(request);
    ZeroMemory(result);
    
    request.action = TRADE_ACTION_DEAL;
    request.magic  = MagicNumber; // Asignar el Magic Number
    request.symbol = symbol;
    request.volume = calculatedLot;
    request.type_filling = ORDER_FILLING_IOC; 
    
    double slPrice = 0, tpPrice = 0;
    
    if (direction == "BUY") {
        request.type = ORDER_TYPE_BUY;
        request.price = ask;
        slPrice = request.price - slDistance;
        tpPrice = request.price + (slDistance * RR_Ratio);
    } 
    else if (direction == "SELL") {
        request.type = ORDER_TYPE_SELL;
        request.price = bid;
        slPrice = request.price + slDistance;
        tpPrice = request.price - (slDistance * RR_Ratio);
    }
    
    request.sl = slPrice;
    request.tp = tpPrice;
    
    Print("Enviando orden ", direction, " | Lote: ", calculatedLot, " | Riesgo: $", riskMoney);
    
    if(!OrderSend(request, result)) {
        Print("Error ejecutando orden MT5. Código: ", result.retcode);
    } else {
        Print("Orden ejecutada con éxito. Ticket: ", result.deal);
    }
    
    // 3. Actualizar estado a 'EXECUTED' en Supabase para no repetir la señal
    MarkSignalAsExecuted(idStr);
}

void MarkSignalAsExecuted(string id) {
    string headers = "apikey: " + SupabaseKey + "\r\n";
    headers += "Authorization: Bearer " + SupabaseKey + "\r\n";
    headers += "Content-Type: application/json\r\n";
    headers += "Prefer: return=minimal\r\n";
    
    // Query tipo PATCH a Supabase
    string url = SupabaseUrl + "?id=eq." + id;
    
    string body = "{\"status\":\"EXECUTED\"}";
    char post[];
    StringToCharArray(body, post);
    // Remover el último caracter nulo del array
    ArrayResize(post, ArraySize(post)-1);
    
    char result[];
    string result_headers;
    
    int res = WebRequest("PATCH", url, headers, 5000, post, result, result_headers);
    if(res == 200 || res == 204) {
        Print("Señal marcada como EXECUTED en Supabase con éxito.");
    } else {
        Print("Error al actualizar estado en Supabase: ", res);
    }
}
