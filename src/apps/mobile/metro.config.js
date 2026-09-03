// Monorepo wiring. Metro does not follow workspace symlinks out of the app
// directory by default, so it must be told where the repo root is and which
// node_modules folders to resolve from. Without this, importing @calder/core fails
// with an unhelpful "module not found" that looks like a typo.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../../..");
const coreSrc = path.resolve(workspaceRoot, "src/packages/core/src");

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

// Resolve @calder/core to its TypeScript SOURCE rather than its build output.
//
// Otherwise the package only updates when `tsc` runs, which happens in the app's
// `prestart` — so editing core and reloading gives you the OLD core against NEW
// app code, with no warning. That failure is silent and misleading: the symptom
// is an undefined export at runtime, nowhere near the cause.
//
// Core keeps `.js` extensions on its relative imports because Node's ESM loader
// requires them for the Lambda build. Metro has no such rule, so those specifiers
// are rewritten back to source here.
const defaultResolve = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest;

  if (moduleName === "@calder/core") {
    return resolve(context, path.join(coreSrc, "index.ts"), platform);
  }

  const from = context.originModulePath ?? "";
  if (from.startsWith(coreSrc) && moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    return resolve(context, moduleName.replace(/\.js$/, ".ts"), platform);
  }

  return resolve(context, moduleName, platform);
};

module.exports = config;
