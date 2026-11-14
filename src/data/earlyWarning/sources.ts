// Every published source the early-warning layer relies on, with the passage it relies on.
// All of these were fetched and read while building the feature (Nov 2026). Anything not covered
// here is an "AURA rule" and is labelled as such in the UI (see RULES in ./rules.ts).

export type EwSource = { id: string; org: string; title: string; url: string; quote: string }

export const EW_SOURCES = {
  news2Chart1: {
    id: 'news2Chart1',
    org: 'Royal College of Physicians',
    title: 'NEWS2 Chart 1: The NEWS scoring system (2017)',
    url: 'https://www.rcp.ac.uk/media/alxev00t/news2-chart-1_the-news-scoring-system_0_0.pdf',
    quote: 'Pulse (per minute): ≤40 → 3 · 41–50 → 1 · 51–90 → 0 · 91–110 → 1 · 111–130 → 2 · ≥131 → 3',
  },
  news2Chart2: {
    id: 'news2Chart2',
    org: 'Royal College of Physicians',
    title: 'NEWS2 Chart 2: NEWS thresholds and triggers (2017)',
    url: 'https://www.rcp.ac.uk/media/2acdezkd/news2-chart-2_news-thresholds-and-triggers_0.pdf',
    quote: 'Red score — Score of 3 in any individual parameter — Low–medium — Urgent ward-based response',
  },
  news2Summary: {
    id: 'news2Summary',
    org: 'Royal College of Physicians',
    title: 'NEWS2: Executive summary and recommendations (2017)',
    url: 'https://www.rcp.ac.uk/media/ctulqqbn/news2-executive-summary_0.pdf',
    quote:
      'The NEWS should not be used in children (ie aged <16 years) or in women who are pregnant, because the physiological response to acute illness can be modified in children and by pregnancy.',
  },
  nistControl: {
    id: 'nistControl',
    org: 'NIST/SEMATECH',
    title: 'e-Handbook of Statistical Methods, 6.3.2 What are Variables Control Charts? (Western Electric rules)',
    url: 'https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc32.htm',
    quote: '8 Consecutive Points on This Side of Control Line … 4 Out of the Last 5 Points Above +1 Sigma … 2 Out of the Last 3 Points Above +2 Sigma … 6 in a row trending up or down.',
  },
  nistOutliers: {
    id: 'nistOutliers',
    org: 'NIST/SEMATECH',
    title: 'e-Handbook of Statistical Methods, 1.3.5.17 Detection of Outliers (modified Z-score)',
    url: 'https://www.itl.nist.gov/div898/handbook/eda/section3/eda35h.htm',
    quote: 'M_i = 0.6745 (x_i − x̃) / MAD … modified Z-scores with an absolute value of greater than 3.5 be labeled as potential outliers.',
  },
  theilSen: {
    id: 'theilSen',
    org: 'SciPy',
    title: 'scipy.stats.theilslopes (Theil 1950; Sen 1968, J. Am. Stat. Assoc. 63)',
    url: 'https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.theilslopes.html',
    quote: 'It computes the slope as the median of all slopes between paired values … [intercept] defined as median(y) - slope*median(x).',
  },
  mannKendall: {
    id: 'mannKendall',
    org: 'R package trend (Pohlert)',
    title: 'mk.test — Mann-Kendall trend test (after Hipel & McLeod 1994)',
    url: 'https://search.r-project.org/CRAN/refmans/trend/html/mk.test.html',
    quote: 'σ² = {n(n−1)(2n+5) − Σ t_j(t_j−1)(2t_j+5)} / 18 … z = sgn(S)(|S| − 1)/σ',
  },
  mishra2020: {
    id: 'mishra2020',
    org: 'Nature Biomedical Engineering (Mishra et al., 2020)',
    title: 'Pre-symptomatic detection of COVID-19 from smartwatch data',
    url: 'https://pubmed.ncbi.nlm.nih.gov/33208926/',
    quote:
      '63% of the COVID-19 cases could have been detected before symptom onset in real time via a two-tiered warning system based on the occurrence of extreme elevations in resting heart rate relative to the individual baseline.',
  },
  stanford2020: {
    id: 'stanford2020',
    org: 'Stanford Medicine',
    title: 'Smartwatch can detect early signs of illness (news release, Dec 2020)',
    url: 'https://med.stanford.edu/news/all-news/2020/12/smartwatch-can-detect-early-signs-of-illness.html',
    quote: 'The algorithm cannot yet decipher COVID-19 from other infections, like a garden-variety cold.',
  },
  vanDongen2003: {
    id: 'vanDongen2003',
    org: 'Sleep (Van Dongen et al., 2003)',
    title: 'The cumulative cost of additional wakefulness',
    url: 'https://pubmed.ncbi.nlm.nih.gov/12683469/',
    quote:
      'Chronic restriction of sleep periods to 4 h or 6 h per night over 14 consecutive days resulted in significant cumulative, dose-dependent deficits in cognitive performance on all tasks.',
  },
  nasaSleep: {
    id: 'nasaSleep',
    org: 'NASA OCHMO',
    title: 'Sleep Accommodations OCHMO-TB-041 Rev B',
    url: 'https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-041-sleep-accommodations.pdf',
    quote: 'According to the National Sleep Foundation and American Academy of Sleep Medicine, an average adult needs 7-9 hours of sleep for optimal daytime functioning.',
  },
} satisfies Record<string, EwSource>

export type EwSourceId = keyof typeof EW_SOURCES
