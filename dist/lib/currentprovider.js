"use strict";
// Ocean current provider: resolves current lookups from a single ocean current GRIB file.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SingleFileCurrentProvider = void 0;
const grib_1 = require("./grib");
function coversPoint(meta, lat, lon) {
    return lat >= meta.latMin && lat <= meta.latMax && lon >= meta.lonMin && lon <= meta.lonMax;
}
class SingleFileCurrentProvider {
    constructor(entry) {
        if (!entry.data)
            throw new Error('CurrentFileEntry has no loaded data');
        this.entry = entry;
        this.times = entry.data.times;
        this.meta = entry.meta;
    }
    getCurrent(lat, lon, t) {
        if (!coversPoint(this.meta, lat, lon))
            return { u: 0, v: 0 };
        const timeIdx = (0, grib_1.nearestCurrentTimeIndex)(this.entry.data, t);
        return (0, grib_1.getCurrentAt)(this.entry.data, lat, lon, timeIdx);
    }
    coversPoint(lat, lon) {
        return coversPoint(this.meta, lat, lon);
    }
}
exports.SingleFileCurrentProvider = SingleFileCurrentProvider;
