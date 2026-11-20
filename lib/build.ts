// A stamp that is different for every build of the site. The kiosk compares
// the one it was drawn with against the one the server reports, and reloads
// itself when they differ. BUILD_STAMP is written into the code at build time
// by next.config.ts.
export const BUILD: string = process.env.BUILD_STAMP || 'dev';
