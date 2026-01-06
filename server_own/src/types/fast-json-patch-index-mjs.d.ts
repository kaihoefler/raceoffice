declare module "fast-json-patch/index.mjs" {
    export type Operation =
        | { op: "add"; path: string; value: any }
        | { op: "remove"; path: string }
        | { op: "replace"; path: string; value: any }
        | { op: "move"; from: string; path: string }
        | { op: "copy"; from: string; path: string }
        | { op: "test"; path: string; value: any };

    export function applyPatch<T>(
        document: T,
        patch: Operation[],
        validateOperation?: boolean,
        mutateDocument?: boolean
    ): { newDocument: T };

    export function compare<T>(oldDocument: T, newDocument: T): Operation[];
}
