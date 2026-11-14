// Sources behind every sentence the space-weather panel shows. Each quote was copied verbatim from the page
// (fetched 14 Nov 2026). NOAA's www.swpc.noaa.gov pages now redirect to www.spaceweather.gov.
export type Citation = { org: string; title: string; url: string; quote: string; accessed: string }

const ACCESSED = '2026-11-14'

export const REF = {
  donki: {
    org: 'NASA CCMC',
    title: 'DONKI — Space Weather Database Of Notifications, Knowledge, Information',
    url: 'https://ccmc.gsfc.nasa.gov/tools/DONKI/',
    quote:
      'NOAA Space Weather Prediction Center is the United States Government official source for space weather forecasts. This "Experimental Research Information" consists of preliminary NASA research products and should be interpreted and used accordingly.',
    accessed: ACCESSED,
  },
  noaaScales: {
    org: 'NOAA SWPC',
    title: 'NOAA Space Weather Scales',
    url: 'https://www.spaceweather.gov/noaa-scales-explanation',
    quote:
      'The scales describe the environmental disturbances for three event types: geomagnetic storms, solar radiation storms, and radio blackouts. The scales have numbered levels, analogous to hurricanes, tornadoes, and earthquakes that convey severity.',
    accessed: ACCESSED,
  },
  noaaRadiationStorm: {
    org: 'NOAA SWPC',
    title: 'Solar Radiation Storm',
    url: 'https://www.spaceweather.gov/phenomena/solar-radiation-storm',
    quote:
      'The start of a Solar Radiation Storm is defined as the time when the flux of protons at energies ≥ 10 MeV equals or exceeds 10 proton flux units (1 pfu = 1 particle*cm-2*s-1*ster-1). … A Solar Radiation Storm can persist for time periods ranging from hours to days.',
    accessed: ACCESSED,
  },
  noaaFlares: {
    org: 'NOAA SWPC',
    title: 'Solar Flares (Radio Blackouts)',
    url: 'https://www.spaceweather.gov/phenomena/solar-flares-radio-blackouts',
    quote:
      'The X-ray flux levels start with the "A" level (nominally starting at 10-8 W/m2). The next level, ten times higher, is the "B" level (≥ 10-7 W/m2); followed by "C" flares (10-6 W/m2), "M" flares (10-5 W/m2), and finally "X" flares (10-4 W/m2).',
    accessed: ACCESSED,
  },
  nasaFlares: {
    org: 'NASA SVS',
    title: 'X-Class: A Guide to Solar Flares',
    url: 'https://svs.gsfc.nasa.gov/10109',
    quote:
      'Similar to the Richter scale for earthquakes, each letter represents a ten-fold increase in energy output. … C-class flares are too weak to noticeably affect Earth. M-class flares can cause brief radio blackouts at the poles and minor radiation storms that might endanger astronauts.',
    accessed: ACCESSED,
  },
  noaaGeomagnetic: {
    org: 'NOAA SWPC',
    title: 'Geomagnetic Storms',
    url: 'https://www.spaceweather.gov/phenomena/geomagnetic-storms',
    quote:
      'While the storms create beautiful aurora, they also can disrupt navigation systems such as the Global Navigation Satellite System (GNSS) and create harmful geomagnetic induced currents (GICs) in the power grid and pipelines.',
    accessed: ACCESSED,
  },
  donkiScore: {
    org: 'NASA CCMC DONKI',
    title: 'CME notification 20261113-AL-001 (SCORE CME typification system)',
    url: 'https://ccmc.gsfc.nasa.gov/DONKI/view/Alert/49532/1',
    quote: 'S-type: CMEs with speeds less than 500 km/s · C-type: Common 500-999 km/s · O-type: Occasional 1000-1999 km/s · R-type: Rare 2000-2999 km/s · ER-type: Extremely Rare >3000 km/s',
    accessed: ACCESSED,
  },
  ochmoShelter: {
    org: 'NASA OCHMO',
    title: 'Design for Ionizing Radiation Protection, technical brief OCHMO-TB-020 Rev E',
    url: 'https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf',
    quote:
      'Radiation alerting provides an additional layer of protection to limit exposure to SPEs (early warning allows for crew to safe vehicle and configure shelter). Real-time alert dosimetry also provides a very high level of protection for EVAs if termination occurs within 2 hours and there is access to shielding.',
    accessed: ACCESSED,
  },
  ochmoCountermeasures: {
    org: 'NASA OCHMO',
    title: 'Design for Ionizing Radiation Protection, technical brief OCHMO-TB-020 Rev E',
    url: 'https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf',
    quote: 'Countermeasures: Shielding, monitoring, accurate event determination, dosimetry, and timely reporting to alert crew to seek shelter are essential for crew safety.',
    accessed: ACCESSED,
  },
  ochmoEventLimit: {
    org: 'NASA OCHMO',
    title: 'Design for Ionizing Radiation Protection, technical brief OCHMO-TB-020 Rev E',
    url: 'https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf',
    quote: 'Additionally, short-term radiation exposure to solar particle events is limited to an effective dose of 250 mSv per event to minimize acute effects.',
    accessed: ACCESSED,
  },
  srag: {
    org: 'NASA JSC',
    title: 'Space Radiation Analysis Group (SRAG)',
    url: 'https://srag.jsc.nasa.gov/',
    quote: 'Implementing ALARA is the primary basis for real-time radiological support, and understanding and minimizing exposures from space weather events is a key to that implementation.',
    accessed: ACCESSED,
  },
} satisfies Record<string, Citation>
