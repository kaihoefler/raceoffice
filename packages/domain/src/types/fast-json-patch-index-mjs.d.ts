// The domain dist runs as native ESM in the server/worker, where only the package's ESM
// build ("fast-json-patch/index.mjs") exposes named exports. That path has no typings, so
// declare the runtime function used here; types come from the package root ("fast-json-patch").
declare module "fast-json-patch/index.mjs" {
  import type { Operation } from "fast-json-patch";

  export function applyPatch<T>(
    document: T,
    patch: Operation[],
    validateOperation?: boolean,
    mutateDocument?: boolean,
  ): { newDocument: T };
}
