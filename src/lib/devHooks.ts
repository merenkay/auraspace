// Test hooks on `window` (__auraVoice, __auraHand, __auraViewer) and the performance HUD: present in development,
// and in a production build only when it is made for measurements with VITE_PERF_HOOKS=1 (tools/perf.mjs).
// A normal production build leaves them out entirely (the constant folds to false and the code is dropped).
export const DEV_HOOKS: boolean = import.meta.env.DEV || import.meta.env.VITE_PERF_HOOKS === '1'
