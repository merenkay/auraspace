/*
  AURA environment station
  ------------------------
  Reads temperature + humidity (DHT11 or DHT22) and a flammable-gas sensor (MQ-2 style analog
  module) and prints ONE JSON line per second over USB serial at 9600 baud:

      {"t":23.4,"h":41.0,"gas":312,"warm":0}

    t     temperature in degrees C (1 decimal)      -> null if the DHT read failed
    h     relative humidity in %   (1 decimal)      -> null if the DHT read failed
    gas   raw 10-bit ADC value 0..1023 from the gas module's AO pin (NOT ppm - uncalibrated)
    warm  seconds of gas-sensor warm-up still to go (0 = warmed up). The web app pauses the
          gas alarm while warm > 0.

  At start-up (and whenever it receives the letter i) it prints one info line:

      {"hello":"aura-env","fw":1,"dht":"DHT11","gas_sensor":"MQ-2","gas_pin":"A0","warmup_s":120}

  Single-letter commands it accepts over serial (newline optional):
    i  print the info line again
    w  restart the gas warm-up countdown
    s  skip the warm-up countdown (only if the sensor has already been powered for a few minutes)

  Why no ppm? An MQ-2 only changes its resistance with gas. Turning that into ppm needs a
  calibration with known gas concentrations, which we do not have. The AURA web app therefore
  compares the raw value with a "clean-air baseline" that you capture in the app.

  Library needed: "DHT sensor library" by Adafruit (Arduino IDE > Library Manager; accept
  "Install all" so its helper "Adafruit Unified Sensor" is installed too). See arduino/README.md.
*/

#include <DHT.h>

// ===================== settings you may change =====================
#define DHT_PIN 2            // DHT data wire -> digital pin D2
#define DHT_TYPE DHT11       // using a DHT22 / AM2302? change DHT11 to DHT22 - nothing else
#define GAS_PIN A0           // gas module AO wire -> analog pin A0
#define GAS_PIN_LABEL "A0"   // only used in the info line; keep it equal to GAS_PIN
#define GAS_SENSOR_NAME "MQ-2"

const unsigned long WARMUP_SECONDS = 120;  // heater warm-up before the app trusts the gas value
const unsigned long PERIOD_MS = 1000;      // one line per second
const uint8_t GAS_SAMPLES = 8;             // analog readings averaged per line
// ===================================================================

DHT dht(DHT_PIN, DHT_TYPE);

unsigned long lastSendMs = 0;
unsigned long warmStartMs = 0;

// Newer Adafruit library versions declare DHT11/DHT22 as constants, not macros, so compare at run time.
const __FlashStringHelper* dhtName() {
  if (DHT_TYPE == DHT22) {
    return F("DHT22");
  }
  if (DHT_TYPE == DHT21) {
    return F("DHT21");
  }
  return F("DHT11");
}

void printInfo() {
  Serial.print(F("{\"hello\":\"aura-env\",\"fw\":1,\"dht\":\""));
  Serial.print(dhtName());
  Serial.print(F("\",\"gas_sensor\":\""));
  Serial.print(F(GAS_SENSOR_NAME));
  Serial.print(F("\",\"gas_pin\":\""));
  Serial.print(F(GAS_PIN_LABEL));
  Serial.print(F("\",\"warmup_s\":"));
  Serial.print(WARMUP_SECONDS);
  Serial.println(F("}"));
}

int readGasRaw() {
  long sum = 0;
  for (uint8_t i = 0; i < GAS_SAMPLES; i++) {
    sum += analogRead(GAS_PIN);
    delay(2);
  }
  return (int)(sum / GAS_SAMPLES);  // 0..1023 on a 5 V Uno / Nano
}

// Prints a number, or null when the reading is missing or impossible (never garbage).
void printValue(float value, bool ok) {
  if (ok) {
    Serial.print(value, 1);
  } else {
    Serial.print(F("null"));
  }
}

void handleCommands() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == 'i' || c == 'I') {
      printInfo();                 // the web app asks for this after connecting
    } else if (c == 'w' || c == 'W') {
      warmStartMs = millis();      // restart the gas warm-up countdown (e.g. after re-plugging the module)
    } else if (c == 's' || c == 'S') {
      // skip the countdown: the heater was already powered (an Uno restarts the sketch, not the
      // sensor power, each time the browser opens the port). Unsigned maths makes this safe.
      warmStartMs = millis() - WARMUP_SECONDS * 1000UL;
    }
    // anything else (newlines, noise) is ignored
  }
}

void setup() {
  Serial.begin(9600);
  unsigned long waitStart = millis();
  while (!Serial && millis() - waitStart < 2000) {
    // boards with native USB (Leonardo, Micro) need a moment; Uno / Nano skip this at once
  }
  dht.begin();
  pinMode(GAS_PIN, INPUT);
  warmStartMs = millis();
  printInfo();
}

void loop() {
  handleCommands();

  unsigned long now = millis();
  if (now - lastSendMs < PERIOD_MS) {
    return;
  }
  lastSendMs = now;

  // DHT11 can be read once per second, DHT22 every 2 s (the library then repeats its last value).
  float h = dht.readHumidity();
  float t = dht.readTemperature();  // degrees C
  bool tOk = !isnan(t) && t > -40.0 && t < 85.0;
  bool hOk = !isnan(h) && h >= 0.0 && h <= 100.0;

  int gas = readGasRaw();

  unsigned long upSeconds = (millis() - warmStartMs) / 1000UL;
  unsigned long warmLeft = upSeconds >= WARMUP_SECONDS ? 0 : WARMUP_SECONDS - upSeconds;

  Serial.print(F("{\"t\":"));
  printValue(t, tOk);
  Serial.print(F(",\"h\":"));
  printValue(h, hOk);
  Serial.print(F(",\"gas\":"));
  Serial.print(gas);
  Serial.print(F(",\"warm\":"));
  Serial.print(warmLeft);
  Serial.println(F("}"));
}
