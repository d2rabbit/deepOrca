/**
 * 退化输入守卫（specs/model-vendor-profiles P2.4 — MiniMax
 * MIN_PROVIDER_IMAGE_EDGE_PX=8 的零依赖移植）。
 *
 * 架构性事实（MiniMax 注释原文）：「model gateways reject a request
 * outright when any image in it is degenerate, and because the image lives
 * in persisted history **the session then fails forever**」。防线必须
 * 双端——生产者守卫（写入前，32px）防新增；消费端末道网（发送前，8px）
 * 治已污染的历史。本模块是消费端末道网的纯判定函数。
 */

/**
 * 消费端末道网阈值（MiniMax 实测：生产网关 ≤2px、测试网关 ≤4px 会拒；
 * 取 8px 让两侧都不贴红线——「wrongly dropping genuine content costs
 * more than letting a small image through」，但 degenerate 图会杀整个
 * 会话，所以必须有一个保守下限）。
 */
export const MIN_PROVIDER_IMAGE_EDGE_PX = 8;

/**
 * 图片是否「退化」（边长低于端点可接受的最小值）。
 * 无法判定尺寸（data URL 解不出头/无尺寸信息）→ false（放行——
 * 判定不了就不拦，错误形状交给端点试探通道）。
 */
export function isDegenerateImage(imageUrl: string, minEdgePx = MIN_PROVIDER_IMAGE_EDGE_PX): boolean {
  // PNG / JPEG / GIF / WebP 的最小尺寸可从魔数字节直接读出（不引图像库）。
  const bytes = dataUrlBytes(imageUrl);
  if (!bytes) return false;
  const size = readImageSizeFromMagic(bytes);
  if (!size) return false;
  return size.width < minEdgePx || size.height < minEdgePx;
}

function dataUrlBytes(imageUrl: string): Uint8Array | null {
  const marker = "base64,";
  const index = imageUrl.indexOf(marker);
  if (index === -1) return null;
  try {
    const binary = atob(imageUrl.slice(index + marker.length));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function readImageSizeFromMagic(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG: IHDR 大端 u32 width@16, height@20。
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) };
  }
  // GIF: LE u16 width@6, height@8。
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: readU16LE(bytes, 6), height: readU16LE(bytes, 8) };
  }
  // JPEG: 扫 SOF 段（SOF0/1/2/…: FF Cn，precision@+3, height LE u16@+5, width@+7）。
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const markerByte = bytes[offset + 1];
      const isSOF =
        (markerByte >= 0xc0 && markerByte <= 0xc3) ||
        (markerByte >= 0xc5 && markerByte <= 0xc7) ||
        (markerByte >= 0xc9 && markerByte <= 0xcb) ||
        (markerByte >= 0xcd && markerByte <= 0xcf);
      if (isSOF) {
        return { height: readU16BE(bytes, offset + 5), width: readU16BE(bytes, offset + 7) };
      }
      const segmentLength = readU16BE(bytes, offset + 2);
      if (segmentLength < 2) return null;
      offset += 2 + segmentLength;
    }
    return null;
  }
  return null;
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}
