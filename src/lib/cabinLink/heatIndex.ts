// NOAA / National Weather Service heat index ("apparent temperature") from air temperature and relative
// humidity — the two values AURA's DHT11 measures. Implemented exactly as published by NOAA's Weather
// Prediction Center: https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml
//
//   1. Simple formula: HI = 0.5 * {T + 61.0 + [(T-68.0)*1.2] + (RH*0.094)}; it is averaged with T and,
//      if that average is 80 °F or more, the Rothfusz regression is used instead:
//   2. HI = -42.379 + 2.04901523*T + 10.14333127*RH - .22475541*T*RH - .00683783*T*T - .05481717*RH*RH
//          + .00122874*T*T*RH + .00085282*T*RH*RH - .00000199*T*T*RH*RH
//   3. RH < 13 % and 80–112 °F: subtract [(13-RH)/4]*SQRT{[17-ABS(T-95.)]/17}
//      RH > 85 % and 80–87 °F:  add      [(RH-85)/10] * [(87-T)/5]
//
// Validity (stated by the sources): the regression "is not appropriate when conditions of temperature and
// humidity warrant a heat index value below about 80 degrees F" (the simple formula covers that), it is not
// valid for extreme conditions outside the data Steadman used, and heat index values "were devised for shady,
// light wind conditions" (NWS). A closed cabin is shady with light air movement, but the DHT11 is only ±2 °C /
// ±5 % RH accurate, so AURA shows the heat index as an estimate and never as a measurement.

export const cToF = (c: number) => (c * 9) / 5 + 32
export const fToC = (f: number) => ((f - 32) * 5) / 9

/** Heat index in °F from temperature in °F and relative humidity in %. */
export function heatIndexF(T: number, RH: number): number {
  const simple = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + RH * 0.094)
  if ((simple + T) / 2 < 80) return simple
  let hi =
    -42.379 +
    2.04901523 * T +
    10.14333127 * RH -
    0.22475541 * T * RH -
    0.00683783 * T * T -
    0.05481717 * RH * RH +
    0.00122874 * T * T * RH +
    0.00085282 * T * RH * RH -
    0.00000199 * T * T * RH * RH
  if (RH < 13 && T >= 80 && T <= 112) hi -= ((13 - RH) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17)
  else if (RH > 85 && T >= 80 && T <= 87) hi += ((RH - 85) / 10) * ((87 - T) / 5)
  return hi
}

/** Heat index in °C from °C and % (rounded to 0.1). */
export function heatIndexC(tC: number, rh: number): number {
  return Math.round(fToC(heatIndexF(cToF(tC), rh)) * 10) / 10
}

export type HeatCategory = { id: 'none' | 'caution' | 'extreme-caution' | 'danger' | 'extreme-danger'; label: string; effect: string; quote: string }

/** NWS heat index classification (https://www.weather.gov/ama/heatindex). */
export function heatCategory(hiF: number): HeatCategory {
  if (hiF >= 125) return { id: 'extreme-danger', label: 'Extreme danger', effect: 'heat stroke highly likely', quote: 'Heat stroke highly likely' }
  if (hiF >= 103)
    return { id: 'danger', label: 'Danger', effect: 'heat cramps or heat exhaustion likely, heat stroke possible with prolonged exposure or activity', quote: 'Heat cramps or heat exhaustion likely, and heat stroke possible with prolonged exposure and/or physical activity' }
  if (hiF >= 90)
    return { id: 'extreme-caution', label: 'Extreme caution', effect: 'heat stroke, heat cramps or heat exhaustion possible with prolonged exposure or activity', quote: 'Heat stroke, heat cramps, or heat exhaustion possible with prolonged exposure and/or physical activity' }
  if (hiF >= 80) return { id: 'caution', label: 'Caution', effect: 'fatigue possible with prolonged exposure or activity', quote: 'Fatigue possible with prolonged exposure and/or physical activity' }
  return { id: 'none', label: 'Below the caution band', effect: '', quote: '' }
}
