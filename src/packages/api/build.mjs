import { build } from "esbuild";

/**
 * One bundle, two handlers.
 *
 * A script rather than a flag string in package.json for two reasons, both
 * learned the hard way. The options are readable and can carry the comment
 * below, which a forty-character command line cannot. And esbuild's own errors
 * name the expected and actual platform when its native binary is wrong for
 * this machine — the CLI wrapper reports that as `cannot execute binary file`,
 * which is a genuinely baffling half hour.
 */

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",

  /**
   * The AWS SDK ships CommonJS, and esbuild's ESM output rewrites its
   * `require()` calls into a shim that throws on anything dynamic — including
   * `require("node:https")`, which the SDK's HTTP handler does at load time.
   * The result bundles cleanly, passes every test that does not execute it, and
   * dies on the Lambda's first invocation.
   *
   * Defining a real `require` from the module's own URL gives that shim
   * something to fall through to. It is three lines and it is the difference
   * between a working function and one that has never run.
   */
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
});
