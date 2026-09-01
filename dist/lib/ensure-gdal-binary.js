"use strict";
// Copies the platform-specific gdal-async .node binary from the matching optional
// dependency into gdal-async's binding path, so that --ignore-scripts installs work.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureGdalBinary = ensureGdalBinary;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
function gdalAsyncLibDir() {
    // require.resolve('gdal-async') → gdal-async/lib/gdal.js; dirname → gdal-async/lib/
    return path.dirname(require.resolve('gdal-async'));
}
function ensureGdalBinary() {
    const abi = process.versions.modules;
    const arch = process.arch;
    const platform = process.platform;
    // gdal-async and the sub-packages both use node-v{abi}-{platform}-{arch} as the dir name
    const bindingRel = path.join('binding', `node-v${abi}-${platform}-${arch}`, 'gdal.node');
    const destPath = path.join(gdalAsyncLibDir(), bindingRel);
    if (fs.existsSync(destPath))
        return true;
    const subPkg = `@kristianwiklund/wr-gdal-${platform}-${arch}`;
    let srcPath;
    try {
        const subPkgJson = require.resolve(path.join(subPkg, 'package.json'));
        srcPath = path.join(path.dirname(subPkgJson), bindingRel);
    }
    catch {
        return false;
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    return true;
}
ensureGdalBinary();
