// Builds a SYNTHETIC Samsung Health "Download personal data" export (Galaxy Watch style) for tests and demos.
// The file names, metadata line, headers, UTC time strings + `time_offset`, trailing commas and the jsons/ folder
// follow real exports from 2025-2026 (see the import report). Every value is invented by a seeded random
// generator — this is NOT anybody's health data, and the folder name says SYNTHETIC so AURA labels it as such.
//
// Pure module (no Node APIs) so vitest can build it in memory; tools/samsung-sample/generate.ts writes the zip.
import { strToU8, zipSync, type Zippable } from 'fflate'

export type SampleOptions = { end: string; days?: number; seed?: number; offsetMin?: number }

const VERSION = '7013001'

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const H = {
  heart: 'source,tag_id,com.samsung.health.heart_rate.create_sh_ver,com.samsung.health.heart_rate.heart_beat_count,com.samsung.health.heart_rate.start_time,com.samsung.health.heart_rate.custom,com.samsung.health.heart_rate.binning_data,com.samsung.health.heart_rate.modify_sh_ver,com.samsung.health.heart_rate.update_time,com.samsung.health.heart_rate.create_time,com.samsung.health.heart_rate.client_data_id,com.samsung.health.heart_rate.max,com.samsung.health.heart_rate.min,com.samsung.health.heart_rate.client_data_ver,com.samsung.health.heart_rate.time_offset,com.samsung.health.heart_rate.deviceuuid,com.samsung.health.heart_rate.comment,com.samsung.health.heart_rate.pkg_name,com.samsung.health.heart_rate.end_time,com.samsung.health.heart_rate.datauuid,com.samsung.health.heart_rate.heart_rate',
  sleep: 'total_sleep_time_weight,original_efficiency,mental_recovery,wake_score,factor_01,factor_02,factor_03,factor_04,factor_05,factor_06,factor_07,factor_08,factor_09,factor_10,deep_score,integrated_id,latency_weight,has_sleep_data,bedtime_detection_delay,sleep_efficiency_with_latency,wakeup_time_detection_delay,total_rem_duration,combined_id,nap_score,sleep_type,sleep_latency,data_version,latency_score,deep_weight,rem_weight,physical_recovery,original_wake_up_time,movement_awakening,is_integrated,original_bed_time,goal_bed_time,quality,extra_data,wake_weight,rem_score,goal_wake_up_time,sleep_cycle,total_light_duration,efficiency,sleep_score,sleep_duration,stage_analyzed_type,total_sleep_time_score,com.samsung.health.sleep.create_sh_ver,com.samsung.health.sleep.start_time,com.samsung.health.sleep.custom,com.samsung.health.sleep.modify_sh_ver,com.samsung.health.sleep.update_time,com.samsung.health.sleep.create_time,com.samsung.health.sleep.client_data_id,com.samsung.health.sleep.client_data_ver,com.samsung.health.sleep.time_offset,com.samsung.health.sleep.deviceuuid,com.samsung.health.sleep.comment,com.samsung.health.sleep.pkg_name,com.samsung.health.sleep.end_time,com.samsung.health.sleep.datauuid',
  spo2: 'integrated_id,source,tag_id,coverage_rate,com.samsung.health.oxygen_saturation.create_sh_ver,com.samsung.health.oxygen_saturation.start_time,com.samsung.health.oxygen_saturation.custom,com.samsung.health.oxygen_saturation.modify_sh_ver,com.samsung.health.oxygen_saturation.update_time,com.samsung.health.oxygen_saturation.create_time,com.samsung.health.oxygen_saturation.client_data_id,com.samsung.health.oxygen_saturation.low_duration,com.samsung.health.oxygen_saturation.binning,com.samsung.health.oxygen_saturation.max,com.samsung.health.oxygen_saturation.min,com.samsung.health.oxygen_saturation.spo2,com.samsung.health.oxygen_saturation.client_data_ver,com.samsung.health.oxygen_saturation.time_offset,com.samsung.health.oxygen_saturation.deviceuuid,com.samsung.health.oxygen_saturation.comment,com.samsung.health.oxygen_saturation.pkg_name,com.samsung.health.oxygen_saturation.end_time,com.samsung.health.oxygen_saturation.datauuid,com.samsung.health.oxygen_saturation.heart_rate',
  bp: 'calibration_id,shm_data_id,shm_device_uuid,shm_update_time,shm_create_time,medication,com.samsung.health.blood_pressure.create_sh_ver,com.samsung.health.blood_pressure.start_time,com.samsung.health.blood_pressure.custom,com.samsung.health.blood_pressure.modify_sh_ver,com.samsung.health.blood_pressure.update_time,com.samsung.health.blood_pressure.create_time,com.samsung.health.blood_pressure.client_data_id,com.samsung.health.blood_pressure.mean,com.samsung.health.blood_pressure.client_data_ver,com.samsung.health.blood_pressure.pulse,com.samsung.health.blood_pressure.time_offset,com.samsung.health.blood_pressure.deviceuuid,com.samsung.health.blood_pressure.comment,com.samsung.health.blood_pressure.pkg_name,com.samsung.health.blood_pressure.diastolic,com.samsung.health.blood_pressure.datauuid,com.samsung.health.blood_pressure.systolic',
  exercise: 'live_data_internal,mission_value,race_target,subset_data,start_longitude,routine_datauuid,total_calorie,completion_status,pace_info_id,activity_type,pace_live_data,sensing_status,source_type,mission_type,ftp,tracking_status,program_id,title,reward_status,heart_rate_sample_count,start_latitude,mission_extra_value,program_schedule_id,heart_rate_deviceuuid,location_data_internal,custom_id,additional_internal,com.samsung.health.exercise.duration,com.samsung.health.exercise.additional,com.samsung.health.exercise.create_sh_ver,com.samsung.health.exercise.mean_caloricburn_rate,com.samsung.health.exercise.location_data,com.samsung.health.exercise.start_time,com.samsung.health.exercise.exercise_type,com.samsung.health.exercise.custom,com.samsung.health.exercise.max_altitude,com.samsung.health.exercise.incline_distance,com.samsung.health.exercise.mean_heart_rate,com.samsung.health.exercise.count_type,com.samsung.health.exercise.mean_rpm,com.samsung.health.exercise.min_altitude,com.samsung.health.exercise.modify_sh_ver,com.samsung.health.exercise.max_heart_rate,com.samsung.health.exercise.update_time,com.samsung.health.exercise.create_time,com.samsung.health.exercise.client_data_id,com.samsung.health.exercise.max_power,com.samsung.health.exercise.max_speed,com.samsung.health.exercise.mean_cadence,com.samsung.health.exercise.min_heart_rate,com.samsung.health.exercise.client_data_ver,com.samsung.health.exercise.count,com.samsung.health.exercise.distance,com.samsung.health.exercise.max_caloricburn_rate,com.samsung.health.exercise.calorie,com.samsung.health.exercise.max_cadence,com.samsung.health.exercise.decline_distance,com.samsung.health.exercise.vo2_max,com.samsung.health.exercise.time_offset,com.samsung.health.exercise.deviceuuid,com.samsung.health.exercise.max_rpm,com.samsung.health.exercise.comment,com.samsung.health.exercise.live_data,com.samsung.health.exercise.mean_power,com.samsung.health.exercise.mean_speed,com.samsung.health.exercise.pkg_name,com.samsung.health.exercise.altitude_gain,com.samsung.health.exercise.altitude_loss,com.samsung.health.exercise.exercise_custom_type,com.samsung.health.exercise.auxiliary_devices,com.samsung.health.exercise.end_time,com.samsung.health.exercise.datauuid,com.samsung.health.exercise.sweat_loss',
  water: 'start_time,amount,custom,update_time,create_time,client_data_id,client_data_ver,time_offset,deviceuuid,unit_amount,comment,pkg_name,datauuid',
  skin: 'create_sh_ver,stat_m1,stat_m2,baseline,start_time,binning_data,stat_n,tag_id,modify_sh_ver,lower_bound,update_time,create_time,client_data_id,upper_bound,max,min,client_data_ver,temperature,time_offset,deviceuuid,comment,pkg_name,end_time,datauuid',
  steps: 'binning_data,update_time,create_time,source_pkg_name,source_type,count,speed,distance,calorie,deviceuuid,pkg_name,datauuid,day_time',
  pedometer: 'create_sh_ver,step_count,binning_data,active_time,recommendation,modify_sh_ver,run_step_count,update_time,source_package_name,create_time,source_info,speed,distance,calorie,walk_step_count,deviceuuid,pkg_name,healthy_step,achievement,datauuid,day_time',
  stress: 'create_sh_ver,start_time,custom,binning_data,tag_id,modify_sh_ver,update_time,create_time,max,min,score,algorithm,time_offset,deviceuuid,comment,pkg_name,end_time,datauuid',
  badge: 'badge_type,update_time,create_time,achieved_time,value,deviceuuid,pkg_name,datauuid',
}

const PKG = 'com.sec.android.app.shealth'
const WATCH = 'SYNTHWATCH'
const PHONE = 'SYNTHPHONE'
const SH_VER = '63051050'

/** A CSV in the export layout: BOM, metadata line, header, rows ending with a trailing comma. */
function csv(table: string, n: number, header: string, rows: (string | number)[][]) {
  return `﻿${table},${VERSION},${n}\n${header}\n${rows.map((r) => r.join(',') + ',').join('\n')}\n`
}

/** Fills a row for `header` from a column -> value map (by exact name or namespaced suffix). */
function rowFor(header: string, values: Record<string, string | number>) {
  return header.split(',').map((col) => {
    if (col in values) return values[col]
    const short = col.slice(col.lastIndexOf('.') + 1)
    return short in values ? values[short] : ''
  })
}

export function buildSample(opts: SampleOptions) {
  const days = opts.days ?? 45
  const off = opts.offsetMin ?? 180
  const offStr = `UTC${off >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}${String(Math.abs(off) % 60).padStart(2, '0')}`
  const r = rng(opts.seed ?? 20261115)
  const rand = (a: number, b: number) => a + (b - a) * r()
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  const uuid = () => {
    const h = Array.from({ length: 32 }, () => Math.floor(r() * 16).toString(16)).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${pick(['8', '9', 'a', 'b'])}${h.slice(17, 20)}-${h.slice(20, 32)}`
  }
  const dayStart = (date: string) => Date.parse(`${date}T00:00:00Z`) - off * 60000 // local midnight as UTC ms
  const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
  const fmt = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 23)
  const at = (date: string, hours: number) => dayStart(date) + Math.round(hours * 60) * 60000

  const end = opts.end
  const exportAt = at(end, 9) // the export was made at 09:00 local on the last day
  const stamp = new Date(exportAt + off * 60000).toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const dates = Array.from({ length: days }, (_, i) => addDays(end, i - (days - 1)))
  const startDate = addDays(dates[0], -1)

  /* sleep: one night per date (woke up on that date); 2 nights without the watch; 1 split night; the last 3 nights short */
  type Session = { s: number; e: number; date: string }
  const sessions: Session[] = []
  dates.forEach((date, i) => {
    if (i === 9 || i === 27) return
    const short = i >= days - 3
    const bed = at(addDays(date, -1), short ? rand(24.7, 25.2) : rand(22.6, 24.3))
    const wake = at(date, short ? rand(6.6, 7.1) : rand(6.4, 7.9))
    if (i === 15) {
      const mid = at(date, 3.2)
      sessions.push({ s: bed, e: mid, date }, { s: mid + 25 * 60000, e: wake, date })
    } else sessions.push({ s: bed, e: wake, date })
  })
  /* workouts: run Mon/Wed/Fri evening, walk Tue/Thu noon, long walk Saturday */
  type Workout = { s: number; e: number; type: number; hr: number }
  const workouts: Workout[] = []
  dates.forEach((date, i) => {
    if (i === days - 1) return // export morning: nothing yet
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay()
    if ([1, 3, 5].includes(dow) && r() > 0.15) {
      const s = at(date, rand(17.8, 18.6))
      workouts.push({ s, e: s + Math.round(rand(26, 42)) * 60000, type: 1002, hr: Math.round(rand(138, 152)) })
    } else if ([2, 4].includes(dow)) {
      const s = at(date, rand(12.3, 12.8))
      workouts.push({ s, e: s + Math.round(rand(18, 31)) * 60000, type: 1001, hr: Math.round(rand(96, 108)) })
    } else if (dow === 6) {
      const s = at(date, rand(10, 10.6))
      workouts.push({ s, e: s + Math.round(rand(55, 78)) * 60000, type: 1001, hr: Math.round(rand(98, 110)) })
    }
  })
  const inSleep = (t: number) => sessions.some((x) => t >= x.s && t < x.e)
  const inWorkout = (t: number) => workouts.find((x) => t >= x.s && t < x.e)

  /* heart rate: hourly bins while the watch is worn (charging 19:00-20:00; not worn on the two nights without sleep data) */
  const heart: (string | number)[][] = []
  const notWorn = [9, 27].map((i) => [at(addDays(dates[i], -1), 21), at(dates[i], 8)] as const)
  for (let t = dayStart(startDate) + 20 * 3600000; t + 3600000 <= exportAt; t += 3600000) {
    const localHour = new Date(t + off * 60000).getUTCHours()
    if (localHour === 19) continue
    if (notWorn.some(([a, b]) => t >= a && t < b)) continue
    const mid = t + 1800000
    const dayIdx = dates.indexOf(new Date(mid + off * 60000).toISOString().slice(0, 10))
    const debt = dayIdx >= days - 3 ? 4 : 0
    const w = inWorkout(mid) ?? inWorkout(t + 600000)
    const avg = w ? w.hr - rand(10, 25) : inSleep(mid) ? rand(53, 60) : rand(64, 80) + debt + (localHour < 10 ? -2 : 0)
    const hr = Math.round(avg)
    const id = uuid()
    heart.push(
      rowFor(H.heart, {
        tag_id: 21313, create_sh_ver: '62910051', heart_beat_count: 1, start_time: fmt(t), binning_data: `${id}.com.samsung.health.heart_rate.binning_data.json`,
        modify_sh_ver: '62910051', update_time: fmt(t + 3600000 + 600000), create_time: fmt(t + 3600000 + 300000), max: `${hr + Math.round(rand(6, 22))}.0`,
        min: `${hr - Math.round(rand(4, 11))}.0`, time_offset: offStr, deviceuuid: WATCH, pkg_name: PKG, end_time: fmt(t + 3599999), datauuid: id, heart_rate: `${hr}.0`,
      }),
    )
  }
  // a few on-demand spot checks (start = end, min/max 0), as older watches and manual measurements produce
  for (const i of [5, 18, 33]) {
    const t = at(dates[i], 14.2)
    heart.push(rowFor(H.heart, { tag_id: 21312, heart_beat_count: 1, start_time: fmt(t), update_time: fmt(t + 60000), create_time: fmt(t + 60000), max: '0.0', min: '0.0', time_offset: offStr, deviceuuid: WATCH, pkg_name: PKG, end_time: fmt(t), datauuid: uuid(), heart_rate: `${Math.round(rand(66, 74))}.0` }))
  }

  const sleepRows = sessions.map((x) => {
    const span = (x.e - x.s) / 60000
    const eff = rand(0.9, 0.96)
    const id = uuid()
    return rowFor(H.sleep, {
      mental_recovery: `${Math.round(rand(50, 90))}.0`, has_sleep_data: 1, total_rem_duration: Math.round(span * 0.21), sleep_type: 5, data_version: 1,
      physical_recovery: `${Math.round(rand(50, 90))}.0`, quality: 50002, extra_data: `${id}.extra_data.json`, sleep_cycle: Math.max(1, Math.round(span / 95)),
      total_light_duration: Math.round(span * 0.52), efficiency: (eff * 100).toFixed(1), sleep_score: Math.round(span < 330 ? rand(45, 60) : rand(68, 88)),
      sleep_duration: Math.round(span * eff), create_sh_ver: SH_VER, start_time: fmt(x.s), modify_sh_ver: SH_VER, update_time: fmt(x.e + 1500000), create_time: fmt(x.e + 1200000),
      time_offset: offStr, deviceuuid: WATCH, pkg_name: PKG, end_time: fmt(x.e), datauuid: id,
    })
  })

  // SpO2: one measurement per night (tag 31301) plus weekly spot checks (tag 30000)
  const spo2Rows = sessions
    .filter((x) => x.e - x.s > 3 * 3600000)
    .map((x) => {
      const id = uuid()
      return rowFor(H.spo2, {
        tag_id: 31301, create_sh_ver: '62910051', start_time: fmt(x.s + 900000), modify_sh_ver: '62910051', update_time: fmt(x.e + 1300000), create_time: fmt(x.e + 1300000),
        low_duration: Math.round(rand(0, 240)), binning: `${id}.com.samsung.health.oxygen_saturation.binning.json`, max: '100.0', min: `${Math.round(rand(89, 93))}.0`,
        spo2: `${Math.round(rand(94.6, 97.4))}.0`, time_offset: offStr, deviceuuid: WATCH, pkg_name: PKG, end_time: fmt(x.e - 600000), datauuid: id,
      })
    })
  for (let i = 3; i < days - 1; i += 7) {
    const t = at(dates[i], 13 + rand(0, 1))
    spo2Rows.push(rowFor(H.spo2, { tag_id: 30000, create_sh_ver: '62910051', start_time: fmt(t), modify_sh_ver: '62910051', update_time: fmt(t + 6000), create_time: fmt(t + 5000), spo2: `${Math.round(rand(96.5, 99.4))}.0`, time_offset: offStr, deviceuuid: WATCH, pkg_name: PKG, end_time: fmt(t), datauuid: uuid(), heart_rate: `${Math.round(rand(68, 82))}.0` }))
  }

  // blood pressure: a calibrated-watch reading every ~4 days, in the morning
  const bpRows: (string | number)[][] = []
  for (let i = 1; i < days; i += 4) {
    const t = at(dates[i], rand(8.0, 8.6))
    const sys = Math.round(rand(110, 124))
    bpRows.push(rowFor(H.bp, { create_sh_ver: SH_VER, start_time: fmt(t), modify_sh_ver: SH_VER, update_time: fmt(t + 30000), create_time: fmt(t + 30000), mean: '0.0', pulse: Math.round(rand(60, 72)), time_offset: offStr, deviceuuid: WATCH, pkg_name: 'com.samsung.android.shealthmonitor', diastolic: `${Math.round(sys * rand(0.6, 0.66))}.0`, datauuid: uuid(), systolic: `${sys}.0` }))
  }

  const exRows = workouts.map((w) => {
    const id = uuid()
    const ms = w.e - w.s
    const speed = w.type === 1002 ? rand(2.4, 2.9) : rand(1.2, 1.45)
    return rowFor(H.exercise, {
      live_data_internal: `${id}.live_data_internal.json`, race_target: 0, total_calorie: (ms / 60000 * (w.type === 1002 ? 10.5 : 4.2)).toFixed(3), sensing_status: `${id}.sensing_status.json`, source_type: 4,
      duration: ms, create_sh_ver: SH_VER, start_time: fmt(w.s), exercise_type: w.type, mean_heart_rate: `${w.hr}.0`, count_type: 30001, modify_sh_ver: SH_VER,
      max_heart_rate: `${w.hr + Math.round(rand(12, 25))}.0`, update_time: fmt(w.e + 90000), create_time: fmt(w.e + 90000), min_heart_rate: `${w.hr - Math.round(rand(25, 40))}.0`,
      distance: (speed * ms / 1000).toFixed(2), calorie: (ms / 60000 * (w.type === 1002 ? 10.5 : 4.2)).toFixed(3), time_offset: offStr, deviceuuid: WATCH,
      live_data: `${id}.com.samsung.health.exercise.live_data.json`, mean_speed: speed.toFixed(7), pkg_name: PKG, end_time: fmt(w.e), datauuid: id,
    })
  })

  const waterRows: (string | number)[][] = []
  dates.forEach((date) => {
    const n = Math.round(rand(5, 9))
    for (let k = 0; k < n; k++) {
      const t = at(date, 8 + (14 * (k + r() * 0.8)) / n)
      if (t > exportAt) continue
      waterRows.push(rowFor(H.water, { start_time: fmt(t), amount: '250.0', update_time: fmt(t + 6), create_time: fmt(t + 6), time_offset: offStr, deviceuuid: PHONE, unit_amount: '250.0', pkg_name: PKG, datauuid: uuid() }))
    }
  })

  const skinRows = sessions.map((x) => {
    const id = uuid()
    const temp = rand(33.6, 34.8)
    return rowFor(H.skin, { stat_m1: temp.toFixed(6), stat_m2: (temp * temp).toFixed(4), start_time: fmt(x.s), binning_data: `${id}.binning_data.json`, stat_n: Math.round((x.e - x.s) / 60000), tag_id: 31301, update_time: fmt(x.e + 1400000), create_time: fmt(x.e + 1400000), max: (temp + rand(0.8, 1.4)).toFixed(6), min: (temp - rand(1.2, 2)).toFixed(6), temperature: temp.toFixed(6), time_offset: offStr, deviceuuid: WATCH, pkg_name: PKG, end_time: fmt(x.e), datauuid: id })
  })

  const stepRows: (string | number)[][] = []
  const pedoRows: (string | number)[][] = []
  const stressRows: (string | number)[][] = []
  dates.forEach((date, i) => {
    const count = i === days - 1 ? Math.round(rand(300, 900)) : Math.round(rand(4200, 11800))
    const dayTime = Date.parse(`${date}T00:00:00Z`) // "UTC 00:00 of the local day"
    const id = uuid()
    const upd = fmt(Math.min(exportAt, at(date, 23.9)))
    stepRows.push(rowFor(H.steps, { binning_data: `${id}.binning_data.json`, update_time: upd, create_time: fmt(at(date, 6)), source_pkg_name: PKG, source_type: -2, count, speed: rand(1.2, 1.4).toFixed(7), distance: (count * 0.74).toFixed(3), calorie: (count * 0.038).toFixed(4), deviceuuid: PHONE, pkg_name: PKG, datauuid: id, day_time: dayTime }))
    pedoRows.push(rowFor(H.pedometer, { create_sh_ver: SH_VER, step_count: count, binning_data: `${id}.binning_data.json`, active_time: count * 520, recommendation: 6000, modify_sh_ver: SH_VER, run_step_count: 0, update_time: upd, source_package_name: PKG, create_time: fmt(at(date, 6)), speed: rand(1.2, 1.4).toFixed(7), distance: (count * 0.74).toFixed(3), calorie: (count * 0.038).toFixed(4), walk_step_count: count, deviceuuid: PHONE, pkg_name: PKG, healthy_step: 0, datauuid: uuid(), day_time: dayTime }))
    if (i < days - 1) {
      const t = at(date, 12)
      stressRows.push(rowFor(H.stress, { create_sh_ver: '62910051', start_time: fmt(t), binning_data: `${id}.binning_data.json`, tag_id: 10011, modify_sh_ver: '62910051', update_time: fmt(t + 3600000), create_time: fmt(t + 3600000), max: `${Math.round(rand(50, 80))}.0`, min: `${Math.round(rand(10, 25))}.0`, score: `${Math.round(rand(25, 55))}.0`, time_offset: offStr, deviceuuid: WATCH, pkg_name: PKG, end_time: fmt(t + 3599999), datauuid: uuid() }))
    }
  })

  const badgeRows = [rowFor(H.badge, { badge_type: 'steps_goal', update_time: fmt(at(dates[3], 21)), create_time: fmt(at(dates[3], 21)), achieved_time: fmt(at(dates[3], 21)), value: 6000, deviceuuid: PHONE, pkg_name: PKG, datauuid: uuid() })]

  const root = `samsunghealth_SYNTHETIC-SAMPLE_${stamp}`
  const f = (table: string) => `${root}/${table}.${stamp}.csv`
  const files: Record<string, string> = {
    [`${root}/README_SYNTHETIC.txt`]:
      'SYNTHETIC SAMPLE - NOT REAL HEALTH DATA\n\nThis folder imitates the layout of a Samsung Health "Download personal data" export (Galaxy Watch).\nEvery value was invented by tools/samsung-sample/generate.ts in the AURA project, using a seeded random generator.\nAURA labels anything imported from it as SYNTHETIC.\n',
    [f('com.samsung.shealth.tracker.heart_rate')]: csv('com.samsung.shealth.tracker.heart_rate', 3, H.heart, heart),
    [f('com.samsung.shealth.sleep')]: csv('com.samsung.shealth.sleep', 11, H.sleep, sleepRows),
    [f('com.samsung.shealth.tracker.oxygen_saturation')]: csv('com.samsung.shealth.tracker.oxygen_saturation', 5, H.spo2, spo2Rows),
    [f('com.samsung.shealth.blood_pressure')]: csv('com.samsung.shealth.blood_pressure', 4, H.bp, bpRows),
    [f('com.samsung.shealth.exercise')]: csv('com.samsung.shealth.exercise', 17, H.exercise, exRows),
    [f('com.samsung.health.water_intake')]: csv('com.samsung.health.water_intake', 6, H.water, waterRows),
    [f('com.samsung.health.skin_temperature')]: csv('com.samsung.health.skin_temperature', 4, H.skin, skinRows),
    [f('com.samsung.shealth.step_daily_trend')]: csv('com.samsung.shealth.step_daily_trend', 6, H.steps, stepRows),
    [f('com.samsung.shealth.tracker.pedometer_day_summary')]: csv('com.samsung.shealth.tracker.pedometer_day_summary', 7, H.pedometer, pedoRows),
    [f('com.samsung.shealth.stress')]: csv('com.samsung.shealth.stress', 8, H.stress, stressRows),
    [f('com.samsung.shealth.badge')]: csv('com.samsung.shealth.badge', 3, H.badge, badgeRows),
  }
  // a few detail files, as in the real jsons/ folder (AURA never opens them)
  for (const row of heart.slice(0, 3)) {
    const id = String(row[H.heart.split(',').indexOf('com.samsung.health.heart_rate.datauuid')])
    if (!id) continue
    files[`${root}/jsons/com.samsung.shealth.tracker.heart_rate/${id[0]}/${id}.com.samsung.health.heart_rate.binning_data.json`] = JSON.stringify([{ heart_rate: 60, heart_rate_min: 55, heart_rate_max: 66, start_time: 0, end_time: 0 }])
  }

  const mtime = new Date(exportAt)
  const tree: Zippable = {}
  for (const [path, text] of Object.entries(files)) tree[path] = [strToU8(text), { mtime }]
  const zip = zipSync(tree, { level: 9 })
  return { zip, files, root, stamp, counts: { heart: heart.length, sleep: sleepRows.length, spo2: spo2Rows.length, bp: bpRows.length, exercise: exRows.length, water: waterRows.length } }
}
