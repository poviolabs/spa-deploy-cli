/**
 * Keep all variables here
 * - APP_ prefixed variables are retrieved at test/deploy time from the environment
 * - do not use REACT_APP_ variables here, as they are baked in at build time
 */
const w = window as any;

export const APP_THING : string = w.APP_THING;

export const APP_RELEASE : string = w.APP_RELEASE;
export const APP_VERSION : string = w.APP_VERSION;
