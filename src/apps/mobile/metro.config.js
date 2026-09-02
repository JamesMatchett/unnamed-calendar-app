// Monorepo wiring. Metro does not follow workspace symlinks out of the app
// directory by default, so it must be told where the repo root is and which
// node_modules folders to resolve from. Without this, importing @uca/core fails
// with an unhelpful "module not found" that looks like a typo.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

// expo-sqlite ships a WASM build for web. Metro does not treat .wasm as an asset
// by default, so without this the web bundle fails to resolve it while iOS and
// Android build fine — a confusing platform-specific break.
config.resolver.assetExts.push("wasm");

module.exports = config;
