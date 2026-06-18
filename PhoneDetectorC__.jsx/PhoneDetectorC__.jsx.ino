#include <WiFi.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <HardwareSerial.h>
#include <PubSubClient.h> // NEW: MQTT Library

HardwareSerial sim900a(1);

// Pins
#define PIN_RF_SENSOR   5    
#define PIN_SOUND       4    
#define PIN_PIR         13   
#define PIN_BUZZER      16   
#define PIN_LED_RED     17   
#define PIN_LED_YELLOW  18
#define PIN_SIM_RX      10
#define PIN_SIM_TX      11

#define I2C_SDA 8
#define I2C_SCL 9
LiquidCrystal_I2C lcd(0x27, 16, 4); 

// Wi-Fi and MQTT
const char* ssid = "Saveen's NOVA 9";
const char* password = "81800000";
const char* mqtt_server = "192.168.43.190"; 

WiFiClient espClient;
PubSubClient mqttClient(espClient);

// ── SMS Function ──────────────────────────────────────────────────
void sendSMS(String number, String text) {
  lcd.setCursor(0, 3);
  lcd.print("SENDING SMS...  ");
  
  sim900a.println("AT+CMGF=1"); 
  delay(200);
  sim900a.println("AT+CMGS=\"" + number + "\""); 
  delay(200);
  sim900a.print(text); 
  delay(200);
  sim900a.write(26); 
  
  Serial.println("[SMS] Sent to: " + number);
  delay(2000); 
}

// ── MQTT Callback (Fires when Node.js sends an SMS command) ───────
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String incoming = "";
  for (int i = 0; i < length; i++) {
    incoming += (char)payload[i];
  }
  
  if (String(topic) == "sentinel/commands" && incoming.startsWith("SMS:")) {
    int firstColon = incoming.indexOf(':');
    int secondColon = incoming.indexOf(':', firstColon + 1);

    if (firstColon > 0 && secondColon > 0) {
      String phone = incoming.substring(firstColon + 1, secondColon);
      String msg = incoming.substring(secondColon + 1);
      sendSMS(phone, msg);
    }
  }
}

// ── MQTT Reconnect Loop ───────────────────────────────────────────
void reconnect() {
  while (!mqttClient.connected()) {
    Serial.print("Connecting to MQTT Broker...");
    // Give the ESP32 a unique ID for the server to recognize
    if (mqttClient.connect("ESP32_Sentinel_01")) {
      Serial.println("Connected!");
      mqttClient.subscribe("sentinel/commands"); // Listen for SMS triggers
    } else {
      Serial.print("Failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" retrying in 5 seconds...");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200); 

  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_LED_YELLOW, OUTPUT);

  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_LED_YELLOW, LOW);

  Wire.begin(I2C_SDA, I2C_SCL);
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("SENTINEL V2-MQTT");
  
  Serial.print("Connecting to Wi-Fi");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWi-Fi connected!");
  lcd.clear();

  sim900a.begin(9600, SERIAL_8N1, PIN_SIM_RX, PIN_SIM_TX);
  delay(1000);

  // Setup MQTT
  mqttClient.setServer(mqtt_server, 1883);
  mqttClient.setCallback(mqttCallback);
}

int getSoundVolume() {
  int maxVal = 0;
  int minVal = 4095;
  unsigned long startMillis = millis(); 
  while (millis() - startMillis < 50) {
    int sample = analogRead(PIN_SOUND);
    if (sample > maxVal) maxVal = sample;
    if (sample < minVal) minVal = sample;
  }
  return maxVal - minVal; 
}

void loop() {
  if (!mqttClient.connected()) {
    reconnect();
  }
  mqttClient.loop(); // Keeps the MQTT connection alive and listens for messages

  int rfAdc    = analogRead(PIN_RF_SENSOR);
  int rawSound = getSoundVolume(); 
  bool pirState = digitalRead(PIN_PIR);

  float dbScale = 40.0; 
  if (rawSound > 2) dbScale = (20.0 * log10(rawSound)) + 25.0; 
  if (dbScale < 40.0) dbScale = 40.0;
  if (dbScale > 110.0) dbScale = 110.0;
  
  float rfVoltage = (float)(rfAdc * 3.3 / 4095.0);

  if (dbScale > 70.0) {
    digitalWrite(PIN_BUZZER, HIGH);  
    digitalWrite(PIN_LED_RED, HIGH); 
  } else {
    digitalWrite(PIN_BUZZER, LOW);   
    digitalWrite(PIN_LED_RED, LOW);  
  }

  // LCD Updates
  lcd.setCursor(0, 0); lcd.print("RF Sig: "); lcd.print(rfVoltage, 2); lcd.print("V  ");        
  lcd.setCursor(0, 1); lcd.print("Sound : "); lcd.print((int)dbScale); lcd.print(" dB   ");
  lcd.setCursor(0, 2); lcd.print("Motion: "); lcd.print(pirState == HIGH ? "DETECTED" : "CLEAR   ");
  lcd.setCursor(0, 3); lcd.print("Status: "); lcd.print(dbScale > 70.0 ? "ALARM!  " : "SAFE    ");

  // ── Build and Send the MQTT Packet ──
  StaticJsonDocument<200> doc;
  doc["dbm"]   = rfVoltage; 
  doc["sound"] = (int)dbScale; 
  doc["pir"]   = pirState ? 1 : 0; 

  char jsonBuffer[200];
  serializeJson(doc, jsonBuffer);
  
  // Publish to the "sentinel/sensors" topic
  mqttClient.publish("sentinel/sensors", jsonBuffer);
  
  delay(100); 
}
