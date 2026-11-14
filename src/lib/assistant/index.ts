// AURA's deterministic dialogue layer (no AI, works offline): everyday conversation on top of the health
// commands in src/lib/voice. route.ts decides the meaning (safety first), reply.ts words the small talk,
// memory.ts keeps the short-term context, data.ts reads the environment station, coach and history.
export { calculate, convert, feelingOf, isCrisis, parseChat, type ChatIntent, type Feeling } from './chat'
export { loadEnvSnapshot, loadToday, readingWhy, yesterdayText } from './data'
export { newMemory, vary, type Memory, type Offer } from './memory'
export { chatReply, fallbackReply, greetingFor, JOKES, type ChatCtx, type ChatReply, type EnvSnapshot } from './reply'
export { labelOf, meaningOf, resolveClarify, route, understand, type Choice, type Route, type Understanding } from './route'
