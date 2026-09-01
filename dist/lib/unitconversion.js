"use strict";
// Unit conversion helpers: internal units (kn, m, nmi) ↔ SignalK unit preset display units.
Object.defineProperty(exports, "__esModule", { value: true });
exports.fromSI = exports.toSI = void 0;
exports.evalFormula = evalFormula;
exports.toDisplay = toDisplay;
exports.fmt = fmt;
exports.parseUnit = parseUnit;
// Factors: plugin-internal units → SI (m/s, m, m)
exports.toSI = {
    speed: (v) => v * 0.514444,
    depth: (v) => v,
    distance: (v) => v * 1852.001,
};
// Factors: SI (m/s, m, m) → plugin-internal units
exports.fromSI = {
    speed: (v) => v * 1.94384,
    depth: (v) => v,
    distance: (v) => v / 1852.001,
};
const FALLBACK_SYMBOL = { speed: 'kn', depth: 'm', distance: 'nmi' };
// Safe formula evaluator for "value * N" / "value / N" / "value + N" / "value - N"
function evalFormula(formula, value) {
    const m = formula.match(/^value\s*([*/+-])\s*([\d.]+)$/);
    if (!m)
        return value;
    const n = parseFloat(m[2]);
    switch (m[1]) {
        case '*':
            return value * n;
        case '/':
            return value / n;
        case '+':
            return value + n;
        case '-':
            return value - n;
        default:
            return value;
    }
}
// Convert internal-unit value to display number (no formatting).
// forceMs=true: override to m/s for speed (used when windSpeedMs config is enabled).
function toDisplay(value, category, prefs, forceMs = false) {
    if (forceMs)
        return exports.toSI[category](value);
    const p = prefs?.[category];
    if (!p?.formula)
        return value;
    return evalFormula(p.formula, exports.toSI[category](value));
}
// Convert internal-unit value to { num, sym } for display.
function fmt(value, category, prefs, forceMs = false) {
    if (forceMs) {
        return { num: exports.toSI[category](value).toFixed(2), sym: 'm/s' };
    }
    const p = prefs?.[category];
    if (!p?.formula) {
        return { num: value.toFixed(1), sym: FALLBACK_SYMBOL[category] };
    }
    const raw = evalFormula(p.formula, exports.toSI[category](value));
    const fmtStr = p.displayFormat ?? '';
    const dot = fmtStr.indexOf('.');
    const decimals = dot >= 0 ? fmtStr.length - dot - 1 : 0;
    return { num: raw.toFixed(decimals), sym: p.symbol };
}
// Convert display-unit value back to internal units.
function parseUnit(displayVal, category, prefs, forceMs = false) {
    if (forceMs)
        return displayVal * 1.94384; // m/s → kn
    const p = prefs?.[category];
    if (!p?.inverseFormula)
        return displayVal;
    return exports.fromSI[category](evalFormula(p.inverseFormula, displayVal));
}
