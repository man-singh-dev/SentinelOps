/**
 * eslint-ts-compat.cjs
 *
 * Workaround: typescript-eslint@8 does not support TypeScript >= 7.
 * TS 7 is a native rewrite whose JS API surface has breaking changes
 * (e.g. ts.ModuleKind.Cjs removed, typescript/lib/tsserverlibrary gone).
 *
 * We install TS 5.8 side-by-side as "typescript-eslint-ts" (npm alias)
 * and this preload hook redirects ALL require("typescript") and
 * require("typescript/...") calls → TS 5.8 ONLY when called from a
 * typescript-eslint or ts-api-utils package.
 *
 * - `npx tsc` still uses TS 7 (the top-level `typescript` package).
 * - `npm run lint` uses TS 5.8 for parsing/type-checking inside ESLint.
 *
 * Remove this file (and the `typescript-eslint-ts` dep) once
 * typescript-eslint ships TS 7 support.
 * Track: https://github.com/typescript-eslint/typescript-eslint/issues/10940
 */

"use strict";

const Module = require("module");
const path = require("path");

// Resolve the TS 5.8 package root: .../node_modules/typescript-eslint-ts/
const ts5PkgJson = require.resolve("typescript-eslint-ts/package.json");
const ts5PackageDir = path.dirname(ts5PkgJson);
const ts5Main = require.resolve("typescript-eslint-ts");

const originalResolveFilename = Module._resolveFilename;

/**
 * Check whether the calling module lives inside a typescript-eslint package.
 */
function isEslintTsCaller(parent) {
  if (!parent || !parent.filename) return false;
  const f = parent.filename;
  return (
    f.includes(path.sep + "typescript-eslint" + path.sep) ||
    f.includes(path.sep + "@typescript-eslint" + path.sep) ||
    f.includes(path.sep + "ts-api-utils" + path.sep)
  );
}

Module._resolveFilename = function (request, parent, isMain, options) {
  // Redirect require("typescript") and require("typescript/...")
  // to the TS 5.8 alias package when the caller is a typescript-eslint pkg.
  if (
    (request === "typescript" || request.startsWith("typescript/")) &&
    isEslintTsCaller(parent)
  ) {
    if (request === "typescript") {
      return ts5Main;
    }
    // e.g. "typescript/lib/tsserverlibrary" →
    //      "<ts5PackageDir>/lib/tsserverlibrary"
    const subpath = request.slice("typescript/".length);
    const redirected = path.join(ts5PackageDir, subpath);
    return originalResolveFilename.call(this, redirected, parent, isMain, options);
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};
