// ---------------------------------------------------------------
//  SENTINEL RF - Node.js Server (MQTT Version)
//  Hosts an embedded Aedes MQTT Broker on Port 1883
// --------------------------------------------------------------

require("dotenv").config();
const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const cors       = require("cors");
const path       = require("path");
const Database   = require("better-sqlite3");

// -- Config --------------------------------------
const PORT           = process.env.PORT           || 3000;
const MQTT_PORT      = 1883; // Standard MQTT Port
const RF_THRESHOLD   = parseFloat(process.env.RF_THRESHOLD) || 1.5; // Voltage drop threshold
const SOUND_THRESH   = parseInt(process.env.SOUND_THRESHOLD) || 70; 
const ROOM_NAME      = process.env.ROOM_NAME      || "Exam Hall Room 01";
const INVIG_PHONE    = process.env.INVIGILATOR_PHONE || "+94764574244";

// -- Express + Socket.IO setup --------------------------------
const app    = express();
const httpServer = http.createServer(app);
const io     = new Server(httpServer, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// -- SQLite Database setup ----------------------------
const db = new Database("sentinel.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, dbm REAL NOT NULL,
    sound_raw INTEGER NOT NULL, pir INTEGER NOT NULL, room TEXT NOT NULL,
    timestamp TEXT NOT NULL, sms_sent INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sensor_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dbm REAL, sound_raw INTEGER,
    pir INTEGER, timestamp TEXT
  );
`);

const insertEvent = db.prepare(`INSERT INTO events (type, dbm, sound_raw, pir, room, timestamp, sms_sent) VALUES (@type, @dbm, @sound_raw, @pir, @room, @timestamp, @sms_sent)`);
const insertSensorLog = db.prepare(`INSERT INTO sensor_log (dbm, sound_raw, pir, timestamp) VALUES (@dbm, @sound_raw, @pir, @timestamp)`);
const getRecentEvents = db.prepare(`SELECT * FROM events ORDER BY id DESC LIMIT 50`);
const getStats = db.prepare(`SELECT COUNT(CASE WHEN type = 'PHONE' THEN 1 END) AS phone_count, COUNT(CASE WHEN type = 'TAMPER' THEN 1 END) AS tamper_count, COUNT(*) AS total FROM events`);

// ── Embedded MQTT Broker (Aedes) ──────────────────────────────
let espConnected = false;
const { Aedes } = require("aedes");
const net = require("net");

// Aedes v1.0.0+ requires async initialization
Aedes.createBroker().then((aedes) => {
  const mqttServer = net.createServer(aedes.handle);

  // Track ESP32 Connection Status
  aedes.on('client', (client) => {
    if (client.id.startsWith("ESP32")) {
      console.log(`\n[MQTT] Hardware Connected: ${client.id}`);
      espConnected = true;
      io.emit("serial_status", { connected: true });
    }
  });

  aedes.on('clientDisconnect', (client) => {
    if (client.id.startsWith("ESP32")) {
      console.log(`\n[MQTT] Hardware Disconnected: ${client.id}`);
      espConnected = false;
      io.emit("serial_status", { connected: false });
    }
  });

  mqttServer.listen(MQTT_PORT, '0.0.0.0', () => {
    console.log(`[MQTT] Broker running internally on port ${MQTT_PORT}`);
  });
}).catch(err => {
  console.error("[MQTT] Failed to start broker:", err);
});

// ── MQTT Local Client (Reads the data) ────────────────────────
const mqtt = require("mqtt");
const mqttClient = mqtt.connect(`mqtt://localhost:${MQTT_PORT}`);

mqttClient.on('connect', () => {
  mqttClient.subscribe('sentinel/sensors');
});

mqttClient.on('message', (topic, message) => {
  if (topic === 'sentinel/sensors') {
    try {
      const { dbm, sound, pir, alert: alertType } = JSON.parse(message.toString());
      const timestamp = new Date().toISOString();

      insertSensorLog.run({ dbm, sound_raw: sound, pir: pir ? 1 : 0, timestamp });
      io.emit("sensor_update", { dbm, sound, pir: !!pir, timestamp, alertType: alertType || "NONE" });

      let detectedAlert = alertType || "NONE";
      if (detectedAlert === "NONE") {
        if (dbm <= RF_THRESHOLD) detectedAlert = "PHONE";
        else if (pir) detectedAlert = "TAMPER";
      }

      if (detectedAlert === "PHONE" || detectedAlert === "TAMPER") {
        handleAlert({ type: detectedAlert, dbm, sound, pir, timestamp });
      }
    } catch (err) {
      console.warn("[MQTT] Bad JSON received");
    }
  }
});

// -- Alert handler ---------------------------------
const alertCooldowns = {};

function handleAlert({ type, dbm, sound, pir, timestamp }) {
  const now = Date.now();
  if (alertCooldowns[type] && now - alertCooldowns[type] < 10000) return;
  alertCooldowns[type] = now;

  const result = insertEvent.run({ type, dbm, sound_raw: sound, pir: pir ? 1 : 0, room: ROOM_NAME, timestamp, sms_sent: 1 });
  console.log(`[ALERT] ${type} detected — V: ${dbm}, Sound: ${sound}dB`);

  const event = {
    id: result.lastInsertRowid, type, dbm, sound, pir: !!pir, room: ROOM_NAME, timestamp,
    timeStr: new Date(timestamp).toLocaleTimeString("en-GB"),
  };

  io.emit("alert", event);
  
  // 1. Send SMS command to ESP32 over MQTT
  const msg = type === "PHONE"
    ? `SENTINEL ALERT: Mobile phone detected in ${ROOM_NAME}. Signal: ${dbm}V, Sound: ${sound}dB. Time: ${event.timeStr}`
    : `SENTINEL WARNING: Tamper attempt at ${ROOM_NAME}. Time: ${event.timeStr}`;
  
  mqttClient.publish("sentinel/commands", `SMS:${INVIG_PHONE}:${msg}`);

  // 2. Trigger Telegram Alert
  const tgramMsg = type === "PHONE"
    ? `🚨 *SENTINEL ALERT*\nMobile phone detected in *${ROOM_NAME}*!\n\n📡 *Signal:* ${dbm} V\n🔊 *Sound:* ${sound} dB\n🕒 *Time:* ${event.timeStr}`
    : `⚠️ *SENTINEL WARNING*\nTamper attempt at *${ROOM_NAME}* device.\n\n🕒 *Time:* ${event.timeStr}`;
  sendTelegramMessage(tgramMsg);
}

// ── Send Telegram Message ─────────────────────────────────────
async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "Markdown" }),
    });
  } catch (error) {
    console.error("[TELEGRAM] Failed to send:", error.message);
  }
}

// -- REST API endpoints ---------------------------------------
app.get("/api/events", (req, res) => res.json({ success: true, events: getRecentEvents.all() }));
app.get("/api/stats", (req, res) => res.json({ success: true, stats: getStats.get() }));
app.get("/api/history", (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json({ success: true, history: db.prepare("SELECT dbm, sound_raw, pir, timestamp FROM sensor_log ORDER BY id DESC LIMIT ?").all(limit).reverse() });
});
app.get("/api/status", (req, res) => res.json({ success: true, connection: espConnected ? "MQTT via Wi-Fi" : "Disconnected", room: ROOM_NAME }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

io.on("connection", (socket) => {
  socket.emit("serial_status", { connected: espConnected });
  socket.emit("history", { events: getRecentEvents.all() });
});

// -- Start everything ------------------------------------
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║    SENTINEL RF SERVER ONLINE (MQTT)      ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log(`║  Dashboard : http://localhost:${PORT}       ║`);
  console.log(`║  Network   : http://192.168.43.190:${PORT}  ║`);
  console.log("╚══════════════════════════════════════════╝");
});