/**
 * How Pixi should load an Underlay image. It picks a loader by the file extension, and many image
 * URLs have none (`blob:` URLs, a server's `/assets/as_…`, a CDN's `…/photo?w=1600`): those would
 * load nothing, silently, so they are named as raster images. SVG keeps Pixi's own loader, since
 * the raster one cannot decode it.
 */
export function underlayAsset(src: string): string | { src: string; parser: string } {
    const path = src.split(/[?#]/)[0]!.toLowerCase();
    if (path.endsWith('.svg') || src.startsWith('data:image/svg')) return src;
    return { src, parser: 'texture' };
}
