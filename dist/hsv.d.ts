/**
 * hsv.ts — hue, saturation and brightness for the workshop's mixer.
 *
 * RGB is the store's form, three floats in 0..1. HSV is the mixer's: hue in
 * degrees 0..360, saturation and brightness in percent, since those are the
 * numbers a person drags.
 */
export type Rgb = [number, number, number];
export type Hsv = [number, number, number];
export declare function rgbToHsv([r, g, b]: Rgb): Hsv;
export declare function hsvToRgb([h, s, v]: Hsv): Rgb;
//# sourceMappingURL=hsv.d.ts.map