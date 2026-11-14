# AURA environment station (Arduino)

A small Arduino kit that measures **temperature**, **humidity** and **flammable gas** and sends the values to the AURA website
over USB. The website shows them live on the **Environment** page (for every profile: space cabin, polar station, home),
raises a gas alarm, and stores one averaged reading every 10 seconds.

```
DHT11 / DHT22 ──┐
                ├── Arduino Uno / Nano ── USB cable ── laptop (Chrome or Edge) ── AURA Environment page
MQ-2 gas module ┘
```

> **Honesty notes (please keep them when you present):**
> - The gas value is the **raw sensor number (0–1023)**, not ppm. An MQ-2 cannot give trustworthy ppm without a calibration
>   with known gas concentrations, which we do not have. AURA compares the value with a **clean-air baseline** you capture.
> - The **1.5× (attention) and 2× (alarm)** levels are **AURA demo thresholds**, not a safety standard.
> - This kit is **not a certified gas or carbon-monoxide alarm**.

---

## 1. Parts

| Part | Notes |
|---|---|
| Arduino **Uno** or **Nano** (clones are fine) | 5 V board. Nano clones usually have a CH340 USB chip. |
| **DHT11** temperature + humidity sensor | A DHT22 / AM2302 also works — change one line (step 4). |
| **MQ-2** gas sensor module (4 pins: VCC, GND, DO, AO) | Other MQ-x analog modules work the same way (rename it in the sketch). |
| USB cable that carries **data** | Some phone-charging cables are power-only — they will not work. |
| Jumper wires (and a breadboard if you like) | |

## 2. Wiring

| Part | Pin on the part (label may differ) | Arduino pin |
|---|---|---|
| DHT11 / DHT22 module | **VCC** ( `+` ) | **5V** |
| DHT11 / DHT22 module | **DATA** ( `S`, `OUT`, `DAT` ) | **D2** |
| DHT11 / DHT22 module | **GND** ( `-` ) | **GND** |
| MQ-2 module | **VCC** | **5V** |
| MQ-2 module | **GND** | **GND** |
| MQ-2 module | **AO** (analog out) | **A0** |
| MQ-2 module | **DO** (digital out) | *not connected* |

```
            Arduino Uno / Nano
          ┌───────────────────┐
  DHT +  ─┤ 5V            D2  ├─ DHT DATA
  MQ VCC ─┤ 5V                │
  DHT -  ─┤ GND           A0  ├─ MQ-2 AO
  MQ GND ─┤ GND               │
          └───────────────────┘
```

Tips
- Both sensors need **5V**. On an Uno there is one 5V pin: use the breadboard's `+` rail to share it (same for GND).
- A **bare DHT11 with 4 legs** (no small board) needs a 10 kΩ resistor between DATA and VCC. Leg 1 = VCC, leg 2 = DATA,
  leg 3 = not used, leg 4 = GND (grille facing you). The 3-pin modules already have this resistor.
- The MQ-2 has a heater: it gets **warm to the touch** — that is normal. Keep it away from paper and plastic.
- Do not swap AO and DO: DO is only on/off (from the module's own potentiometer), AURA needs **AO**.

## 3. Install the Arduino IDE and the board

1. Install **Arduino IDE 2** from <https://www.arduino.cc/en/software>.
2. Plug in the Arduino with the USB cable.
3. **Tools → Board** → *Arduino AVR Boards* → **Arduino Uno** (or **Arduino Nano**).
4. **Tools → Port** → pick the new COM port (e.g. `COM3 (Arduino Uno)` or `COM5` for a CH340 clone).
   - No port appears with a clone? It needs the **CH340 driver** from the chip maker (WCH). Install it, re-plug the cable.
   - **Nano clones:** if the upload fails, choose **Tools → Processor → ATmega328P (Old Bootloader)** and upload again.

## 4. Install the DHT library (once)

1. **Tools → Manage Libraries…** (or the books icon on the left).
2. Search for **`DHT sensor library`**.
3. Pick the one **by Adafruit** → **Install**.
4. The IDE asks to install its dependency **Adafruit Unified Sensor** → click **INSTALL ALL**.

Command line alternative: `arduino-cli lib install "DHT sensor library" "Adafruit Unified Sensor"`

No other library is needed (the gas sensor is read with `analogRead`).

## 5. Upload the sketch

1. **File → Open…** → `arduino/aura_env_station/aura_env_station.ino` (the folder name must match the file name — keep it).
2. Using a **DHT22**? Change `#define DHT_TYPE DHT11` to `#define DHT_TYPE DHT22`. That is the only change.
   (Other settings at the top: `DHT_PIN`, `GAS_PIN` + `GAS_PIN_LABEL`, `GAS_SENSOR_NAME`, `WARMUP_SECONDS`.)
3. Click **Upload** (→ arrow). Wait for "Done uploading".
4. Check it: **Tools → Serial Monitor**, set **9600 baud**. Every second you should see a line like
   `{"t":23.4,"h":41.0,"gas":312,"warm":95}`.
5. **Close the Serial Monitor** (or the whole IDE) — only one program can use the port at a time.

## 6. Connect to AURA

1. Open AURA in **Chrome or Edge on a computer** (Web Serial does not exist on phones, Firefox or Safari).
   The page must be on **https://** or **http://localhost**.
2. Sign in → **Environment** tab (it may be labelled *Conditions* for home/polar profiles) → **Connect sensor** → choose the Arduino port → **Connect**.
   Next time AURA remembers the port; *Choose another port* opens the list again.
3. The board restarts when the port opens; the first reading arrives after ~2 s. The badge shows **LIVE SENSOR**.
4. The gas alarm is **paused during the warm-up** (`warm` counts down from 120 s). The datasheet's standard test
   condition is a preheat of over 48 hours, so early readings can drift. If the sensor has already been powered for a
   while (the restart does not cut its power), use *Skip the warm-up*.
5. In **fresh, clean air**, press **Set clean-air baseline**. From now on the gas value is shown as
   "× baseline": 1.0 = like clean air, ≥ 1.5 attention, ≥ 2 alarm (AURA demo thresholds).
6. Leave the page open while recording. Unplugging is detected; AURA reconnects when the same board is plugged back in.

**No hardware?** Press **Simulate** — clearly labelled **SIMULATED**, never saved or uploaded. **Simulate gas leak**
plays a 45-second leak so you can show the alarm.

### Testing the real gas alarm (carefully)
Use the simulation for the jury. To check the real sensor once: in a ventilated room, away from any flame, hold an
**unlit** butane lighter about 10–20 cm from the sensor and press its gas button for 1 second (do **not** strike it).
The value should rise within seconds and fall back after a minute. An adult should supervise.

## 7. What the sketch sends (for developers)

One JSON line per second, 9600 baud, ending in `\r\n`:

```json
{"t":23.4,"h":41.0,"gas":312,"warm":0}
```

| Key | Meaning |
|---|---|
| `t` | temperature °C, 1 decimal — `null` if the DHT read failed or was impossible |
| `h` | relative humidity %, 1 decimal — `null` if the DHT read failed |
| `gas` | raw ADC value 0–1023 from AO (average of 8 reads). Higher = more gas. **Not ppm.** |
| `warm` | seconds of warm-up left (0 = ready). AURA pauses the gas alarm while > 0. |

At start-up, and when it receives `i`, it prints an info line:
`{"hello":"aura-env","fw":1,"dht":"DHT11","gas_sensor":"MQ-2","gas_pin":"A0","warmup_s":120}`

Commands (single letters over serial): `i` info line · `w` restart warm-up · `s` skip warm-up.

The website parser is tolerant: it ignores noise and half lines, accepts other key names (`temp`/`temperature`,
`hum`/`humidity`, `gas`/`mq2`/`smoke`), and even plain text like `Temperature: 23.4  Humidity: 41`.
So an existing class sketch can work too — but values above are the reference.

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| **Connect sensor** is greyed out | Use Chrome or Edge on a computer; open the site via https:// or localhost. |
| "Port is already open" / "Could not open the port" | Close the Arduino IDE Serial Monitor, other tabs with AURA and any other serial program. Re-plug the cable. |
| The port list is empty | Data-capable USB cable? CH340 driver installed (clones)? Try another USB port. |
| Upload error `stk500_recv(): programmer is not responding` | Nano clone: Tools → Processor → **ATmega328P (Old Bootloader)**. Check the board and port. |
| Status **NO SIGNAL** | No line for 5 s. Sketch uploaded? Cable loose? Board powered (LED on)? |
| Garbage characters in Serial Monitor | Set the Serial Monitor to **9600** baud. |
| Temperature / humidity show **SENSOR ERROR** (`null`) | DHT wiring: DATA on D2, VCC on 5V, GND on GND. Bare 4-leg DHT needs the 10 kΩ pull-up. Wrong `DHT_TYPE`? |
| Gas value is 0 or stuck at 1023 | AO must go to A0 (not DO). Check 5V/GND to the module. |
| Gas value jumps randomly | AO wire loose (a floating pin reads noise). |
| Gas value slowly falls for minutes after power-up | Normal heater warm-up. Set the baseline after it settles. |
| Gas alarm never fires | Set the clean-air baseline first; wait for the warm-up to end. |
| `DHT.h: No such file or directory` | Install the Adafruit **DHT sensor library** (step 4). |
| `Adafruit_Sensor.h: No such file` | Install **Adafruit Unified Sensor** (step 4, "Install all"). |

## 9. Where the data goes

- The browser averages the one-second readings into **one row every 10 seconds** (mean temperature and humidity,
  mean and peak gas, the baseline in use). Gas values taken during the warm-up are not stored.
- **Demo / offline mode:** rows are kept in this browser (last 6 hours) and survive a page reload.
- **Server mode:** rows are also uploaded in small batches (max 60 per request); if the server cannot be reached they
  wait in the browser and are sent later. The server checks every value's range and limits the upload rate.
- **Who sees what:** the demo crew, flight surgeon and mission control share the *mission cabin station*;
  a registered member's station is private to them. Simulated values are never stored.

API (see `public/api/routes/env.php`): `GET env/latest`, `GET env/history?minutes=60`, `POST env/readings`.
