const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Pure-TS code shared with the web app (labels, status maps). No Next.js or Node imports allowed there.
config.watchFolders = [path.resolve(__dirname, "../shared")];
// Resolve packages only from mobile/node_modules, never the web app's (different React version).
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
module.exports = config;
