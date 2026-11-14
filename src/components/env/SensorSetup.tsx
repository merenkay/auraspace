import type { DeviceInfo } from '../../lib/envStation'

const WIRES: [string, string, string][] = [
  ['DHT11 / DHT22', 'VCC ( + )', '5V'],
  ['DHT11 / DHT22', 'DATA ( S / OUT )', 'D2'],
  ['DHT11 / DHT22', 'GND ( − )', 'GND'],
  ['MQ-2 gas module', 'VCC', '5V'],
  ['MQ-2 gas module', 'GND', 'GND'],
  ['MQ-2 gas module', 'AO (analog out)', 'A0'],
  ['MQ-2 gas module', 'DO (digital out)', 'not connected'],
]

/** Short hardware how-to; the full guide is arduino/README.md in the project. */
export function SensorSetup({ device, noise, lines }: { device: DeviceInfo | null; noise: number; lines: number }) {
  return (
    <div className="space-y-3 text-sm text-soft">
      <p>
        Upload <code className="rounded bg-deep px-1.5 py-0.5 text-ice">arduino/aura_env_station</code> to an Arduino Uno or Nano (full guide: <code className="text-ice">arduino/README.md</code>
        ). Then use Chrome or Edge on a computer, press <b>Connect sensor</b> and pick the Arduino’s port.
      </p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[360px] text-left text-xs">
          <caption className="sr-only">Wiring</caption>
          <thead className="bg-deep/60 text-dim">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Part</th>
              <th scope="col" className="px-3 py-2 font-semibold">Pin on the part</th>
              <th scope="col" className="px-3 py-2 font-semibold">Arduino pin</th>
            </tr>
          </thead>
          <tbody>
            {WIRES.map(([part, pin, to]) => (
              <tr key={part + pin} className="border-t border-line">
                <td className="px-3 py-1.5">{part}</td>
                <td className="px-3 py-1.5">{pin}</td>
                <td className="px-3 py-1.5 font-semibold text-ink">{to}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-dim">
        The sketch prints one line per second at 9600 baud:{' '}
        <code className="rounded bg-deep px-1.5 py-0.5 text-ice">{'{"t":23.4,"h":41.0,"gas":312,"warm":0}'}</code> — <b>t</b> °C, <b>h</b> % humidity, <b>gas</b> raw 0–1023
        (not ppm), <b>warm</b> seconds of heater warm-up left. A failed read is sent as <code>null</code>. AURA also understands keys like temp, humidity or mq2 and plain
        text such as <code>Temperature: 23.4</code>.
      </p>
      {(device || lines > 0) && (
        <p className="text-xs text-dim">
          {device && (
            <>
              Connected sketch: {device.name}
              {device.fw ? ` v${device.fw}` : ''} · {device.dht ?? 'DHT'} · {device.gasSensor ?? 'gas sensor'} on {device.gasPin ?? '?'}
              {device.warmupS != null ? ` · warm-up ${device.warmupS} s` : ''}.{' '}
            </>
          )}
          {lines} line(s) received, {noise} ignored as noise.
        </p>
      )}
    </div>
  )
}
