// Just enough of an image file for `imageSize`: the headers, no pixels.

export function png(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(24);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x89504e47);
    view.setUint32(4, 0x0d0a1a0a);
    view.setUint32(8, 13);
    view.setUint32(12, 0x49484452); // IHDR
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
}

/** A JPEG with an APP0 segment before the start-of-frame, as most files have. */
export function jpeg(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(2 + 18 + 19);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 0xffd8);
    view.setUint16(2, 0xffe0);
    view.setUint16(4, 16);
    view.setUint16(20, 0xffc0);
    view.setUint16(22, 17);
    bytes[24] = 8;
    view.setUint16(25, height);
    view.setUint16(27, width);
    return bytes;
}
