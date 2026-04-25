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
    
    // Aquí iría la lógica nativa OrderSend() de MQL5 para colocar la operación
    // usando Symbol(), RiskPercent, SL_Pips, etc.
    
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
