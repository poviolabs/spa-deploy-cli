export declare enum SyncAction {
    unknown = "Unknown",
    unchanged = "Unchanged",
    ignore = "Ignore",
    delete = "Delete",
    update = "Update",
    create = "Create"
}
export declare const SyncActionColors: {
    Unknown: import("chalk").Chalk;
    Unchanged: import("chalk").Chalk;
    Ignore: import("chalk").Chalk;
    Delete: import("chalk").Chalk;
    Update: import("chalk").Chalk;
    Create: import("chalk").Chalk;
};
export interface LocalFile {
    path: string;
    key: string;
    hash: string;
    size: number;
}
export interface ScanLocalOptions {
    path: string;
    ignoreGlob?: string[];
    includeGlob?: string[];
}
export declare function scanLocal(options: ScanLocalOptions): AsyncGenerator<LocalFile>;
export declare function fileMd5(path: string): Promise<string>;
