import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: string | Buffer;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const VERSION = 20;
const UTF8_NAMES = 0x0800;
const DEFLATE = 8;

function dosTime(date: Date): { time: number; day: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

interface Packed {
  name: Buffer;
  crc: number;
  size: number;
  compressed: Buffer;
  offset: number;
}

function header(signature: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  buffer.writeUInt32LE(signature, 0);
  return buffer;
}

function localHeader(entry: Packed, stamp: { time: number; day: number }): Buffer {
  const buffer = header(LOCAL_HEADER, 30);
  buffer.writeUInt16LE(VERSION, 4);
  buffer.writeUInt16LE(UTF8_NAMES, 6);
  buffer.writeUInt16LE(DEFLATE, 8);
  buffer.writeUInt16LE(stamp.time, 10);
  buffer.writeUInt16LE(stamp.day, 12);
  buffer.writeUInt32LE(entry.crc, 14);
  buffer.writeUInt32LE(entry.compressed.length, 18);
  buffer.writeUInt32LE(entry.size, 22);
  buffer.writeUInt16LE(entry.name.length, 26);
  return buffer;
}

function centralHeader(entry: Packed, stamp: { time: number; day: number }): Buffer {
  const buffer = header(CENTRAL_HEADER, 46);
  buffer.writeUInt16LE(VERSION, 4);
  buffer.writeUInt16LE(VERSION, 6);
  buffer.writeUInt16LE(UTF8_NAMES, 8);
  buffer.writeUInt16LE(DEFLATE, 10);
  buffer.writeUInt16LE(stamp.time, 12);
  buffer.writeUInt16LE(stamp.day, 14);
  buffer.writeUInt32LE(entry.crc, 16);
  buffer.writeUInt32LE(entry.compressed.length, 20);
  buffer.writeUInt32LE(entry.size, 24);
  buffer.writeUInt16LE(entry.name.length, 28);
  buffer.writeUInt32LE(entry.offset, 42);
  return buffer;
}

export function zipFiles(entries: ZipEntry[], now: Date = new Date()): Buffer {
  const stamp = dosTime(now);
  const parts: Buffer[] = [];
  const packed: Packed[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const item: Packed = {
      name: Buffer.from(entry.name, 'utf8'),
      crc: crc32(data),
      size: data.length,
      compressed: deflateRawSync(data),
      offset,
    };
    const local = localHeader(item, stamp);
    parts.push(local, item.name, item.compressed);
    offset += local.length + item.name.length + item.compressed.length;
    packed.push(item);
  }
  const directoryStart = offset;
  for (const item of packed) {
    const central = centralHeader(item, stamp);
    parts.push(central, item.name);
    offset += central.length + item.name.length;
  }
  const end = header(END_OF_DIRECTORY, 22);
  end.writeUInt16LE(packed.length, 8);
  end.writeUInt16LE(packed.length, 10);
  end.writeUInt32LE(offset - directoryStart, 12);
  end.writeUInt32LE(directoryStart, 16);
  parts.push(end);
  return Buffer.concat(parts);
}
