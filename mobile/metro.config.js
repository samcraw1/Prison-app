const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Pure-TS code shared with the web app (labels, status maps). No Next.js or Node imports allowed there.
config.watchFolders = [path.resolve(__dirname, "../shared")];
module.exports = config;
