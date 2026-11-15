// Voice control of the page: press any visible control by saying its name (English labels, English or Turkish
// command forms), numbered badges, scrolling, sections, tabs, checkboxes and dictation into fields.
export { parseUiCommand, numberOf, ordinalOf, prep, splitChain, type UiCommand, type ScrollDir, type ScrollAmount } from './grammar'
export { nameScore, namesScore, normName, MATCH_MIN } from './names'
export { collectControls, resolve, type Control, type UiNode } from './scan'
export { VoiceControl, type Effects, type UiReply, type UiSfx } from './controller'
