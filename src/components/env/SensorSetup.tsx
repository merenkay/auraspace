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

const CODE = 'rounded bg-deep px-1.5 py-0.5 font-mono text-[13px] text-ink'

/** Short hardware how-to; the full guide is arduino/README.md in the project. */
export function SensorSetup({ device, noise, lines }: { device: DeviceInfo | null; noise: number; lines: number }) {
  return (
    <div className="space-y-4 text-sm text-soft">
      <p className="max-w-prose">
        Upload <code className={CODE}>arduino/aura_env_station</code> to an Arduino Uno or Nano (full guide: <code className={CODE}>arduino/README.md</code>). Then use Chrome or Edge
        on a computer, press <b className="font-semibold text-ink">Connect sensor</b> and pick the Arduino’s port.
      </p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[360px] text-left text-sm">
          <caption className="sr-only">Wiring</caption>
          <thead className="bg-deep text-dim">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Part
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Pin on the part
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Arduino pin
              </th>
            </tr>
          </thead>
          <tbody>
            {WIRES.map(([part, pin, to]) => (
              <tr key={part + pin} className="border-t border-line">
                <td className="px-3 py-2">{part}</td>
                <td className="px-3 py-2">{pin}</td>
                <td className="px-3 py-2 font-mono font-medium text-ink">{to}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="max-w-prose text-dim">
        The sketch prints one line per second at 9600 baud: <code className={CODE}>{'{"t":23.4,"h":41.0,"gas":312,"warm":0}'}</code>, where <b className="font-medium text-soft">t</b> is °C,{' '}
        <b className="font-medium text-soft">h</b> is % humidity, <b className="font-medium text-soft">gas</b> is the raw 0–1023 value (not ppm) and <b className="font-medium text-soft">warm</b> is
        the seconds of heater warm-up left. A failed read is sent as <code className={CODE}>null</code>. AURA also understands keys like temp, humidity or mq2 and plain text such as{' '}
        <code className={CODE}>Temperature: 23.4</code>.
      </p>
      {(device || lines > 0) && (
        <p className="font-mono text-xs text-dim">
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
