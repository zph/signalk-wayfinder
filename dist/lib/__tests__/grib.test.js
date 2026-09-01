"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const grib_1 = require("../grib");
(0, node_test_1.test)('sanitizeGribName: accepts plain GRIB basenames', () => {
    strict_1.default.strictEqual((0, grib_1.sanitizeGribName)('forecast.grib2'), 'forecast.grib2');
    strict_1.default.strictEqual((0, grib_1.sanitizeGribName)('a.grb2'), 'a.grb2');
    strict_1.default.strictEqual((0, grib_1.sanitizeGribName)('mixed.GRIB'), 'mixed.GRIB'); // extension case-insensitive
});
(0, node_test_1.test)('sanitizeGribName: rejects non-GRIB extensions', () => {
    strict_1.default.strictEqual((0, grib_1.sanitizeGribName)('readme.txt'), null);
    strict_1.default.strictEqual((0, grib_1.sanitizeGribName)('archive.zip'), null);
    strict_1.default.strictEqual((0, grib_1.sanitizeGribName)('noext'), null);
});
(0, node_test_1.test)('sanitizeGribName: strips path components (no directory traversal)', () => {
    strict_1.default.strictEqual((0, grib_1.sanitizeGribName)('/etc/passwd'), null); // wrong extension + path stripped
    strict_1.default.strictEqual((0, grib_1.sanitizeGribName)('../../secret.grib2'), 'secret.grib2');
    strict_1.default.strictEqual((0, grib_1.sanitizeGribName)('sub/dir/x.grib2'), 'x.grib2');
    // Note: backslashes are not path separators on POSIX (the runtime platform); browsers also
    // send only the basename, so this is a non-issue in practice.
});
(0, node_test_1.test)('sanitizeGribName: rejects empty / dot / missing', () => {
    strict_1.default.strictEqual((0, grib_1.sanitizeGribName)(''), null);
    strict_1.default.strictEqual((0, grib_1.sanitizeGribName)(undefined), null);
    strict_1.default.strictEqual((0, grib_1.sanitizeGribName)(null), null);
    strict_1.default.strictEqual((0, grib_1.sanitizeGribName)('.'), null);
    strict_1.default.strictEqual((0, grib_1.sanitizeGribName)('..'), null);
});
