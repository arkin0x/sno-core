/** UTF-8 bytes of a string. */
export declare function utf8Bytes(s: string): Uint8Array;
/** Bytes of an even-length hex string (either case). Throws on anything else. */
export declare function hexBytes(hex: string): Uint8Array;
/** The concatenation of byte arrays. */
export declare function concatBytes(...parts: Uint8Array[]): Uint8Array;
/** SHA-256 as 64 lowercase hex characters. A string is hashed as its UTF-8 bytes. */
export declare function sha256Hex(data: Uint8Array | string): string;
//# sourceMappingURL=hash.d.ts.map