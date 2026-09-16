/**
 * The whole library, for a consumer that would rather name the package than
 * the file. Either works: `sno-core` reaches everything through here, and
 * `sno-core/shards` reaches one module, which is what both clients do, because
 * an import that still says which module a name came from is the one thing a
 * reader loses when a directory becomes a package.
 */

export * from './clip'
// Named rather than starred: hsv.ts and snoPalette.ts each define `Rgb`, the
// same three numbers, and neither should have to import the other to say so.
// The format's own is the one this barrel carries.
export { hsvToRgb, rgbToHsv, type Hsv } from './hsv'
export * from './orient'
export * from './outline'
export * from './pose'
export * from './scale'
export * from './shards'
export * from './snoPalette'
export * from './stamps'
export * from './triangulate'
