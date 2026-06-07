// 极简 ZIP 写入器(STORE / 不压缩),无第三方依赖。
// 图片(PNG/WebP/JPG)本身已压缩,STORE 不增大体积、实现简单。
// 以 ReadableStream 逐文件流式输出,服务端内存只占「当前一个文件」。
// 不支持 ZIP64:总大小需 < 4GB、条目 < 65535(批量下载场景足够,且上游已限数量)。

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = (CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const DOS_DATE = 0x0021; // 1980-01-01(固定,避免引入时间依赖)
const DOS_TIME = 0x0000;
const FLAG_UTF8 = 0x0800; // 文件名按 UTF-8 解析

export type ZipEntryInput = { name: string; getData: () => Promise<Uint8Array> };

/**
 * 把若干条目打成一个 ZIP 的 ReadableStream。
 * getData 抛错(文件缺失/读失败)的条目会在「写本地头之前」被跳过,ZIP 仍然完整。
 */
export function createZipStream(entries: ZipEntryInput[]): ReadableStream<Uint8Array> {
  type Central = { nameBuf: Buffer; crc: number; size: number; offset: number };
  const central: Central[] = [];
  let offset = 0;

  async function* chunks(): AsyncGenerator<Uint8Array> {
    for (const entry of entries) {
      let data: Uint8Array;
      try {
        data = await entry.getData();
      } catch {
        continue; // 跳过读不到的文件
      }
      const nameBuf = Buffer.from(entry.name, "utf8");
      const crc = crc32(data);
      const localOffset = offset;

      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4); // version needed
      header.writeUInt16LE(FLAG_UTF8, 6);
      header.writeUInt16LE(0, 8); // method = STORE
      header.writeUInt16LE(DOS_TIME, 10);
      header.writeUInt16LE(DOS_DATE, 12);
      header.writeUInt32LE(crc, 14);
      header.writeUInt32LE(data.length, 18); // compressed size
      header.writeUInt32LE(data.length, 22); // uncompressed size
      header.writeUInt16LE(nameBuf.length, 26);
      header.writeUInt16LE(0, 28); // extra length

      yield header;
      offset += header.length;
      yield nameBuf;
      offset += nameBuf.length;
      yield data;
      offset += data.length;

      central.push({ nameBuf, crc, size: data.length, offset: localOffset });
    }

    const cdStart = offset;
    let cdSize = 0;
    for (const c of central) {
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4); // version made by
      cd.writeUInt16LE(20, 6); // version needed
      cd.writeUInt16LE(FLAG_UTF8, 8);
      cd.writeUInt16LE(0, 10); // method
      cd.writeUInt16LE(DOS_TIME, 12);
      cd.writeUInt16LE(DOS_DATE, 14);
      cd.writeUInt32LE(c.crc, 16);
      cd.writeUInt32LE(c.size, 20);
      cd.writeUInt32LE(c.size, 24);
      cd.writeUInt16LE(c.nameBuf.length, 28);
      cd.writeUInt16LE(0, 30); // extra
      cd.writeUInt16LE(0, 32); // comment
      cd.writeUInt16LE(0, 34); // disk start
      cd.writeUInt16LE(0, 36); // internal attrs
      cd.writeUInt32LE(0, 38); // external attrs
      cd.writeUInt32LE(c.offset, 42); // local header offset

      yield cd;
      cdSize += cd.length;
      offset += cd.length;
      yield c.nameBuf;
      cdSize += c.nameBuf.length;
      offset += c.nameBuf.length;
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    yield eocd;
  }

  const iterator = chunks();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
        } else if (value) {
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
      }
    }
  });
}
