import { inflateRawSync } from 'node:zlib';

// 規則文書の本文の取り出し（読み取りのみ。原本は変更しない）。
// - text: そのまま（UTF-8）
// - docx: ZIP の中の word/document.xml から段落の文字列を取り出す（外部ライブラリを使わず、node:zlib のみ）。
//   マクロ・埋め込みオブジェクトは実行しない。PDF は Phase 2（Enterprise Data Hub）で対応する。

export const MAX_DOC_BYTES = 5 * 1024 * 1024;

export class DocumentFormatError extends Error {}

function readZipEntry(buf: Buffer, name: string): Buffer | null {
  // End of central directory（末尾 64KB 以内）
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new DocumentFormatError('DOCX（ZIP）の形式ではありません。');
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let e = 0; e < entries; e++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new DocumentFormatError('DOCX の目次が壊れています。');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const entryName = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (entryName === name) {
      if (uncompSize > 20 * 1024 * 1024) throw new DocumentFormatError('本文が大きすぎます。');
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data, { maxOutputLength: 20 * 1024 * 1024 });
      throw new DocumentFormatError('対応していない圧縮方式です。');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

export function docxToText(buf: Buffer): string {
  if (buf.length > MAX_DOC_BYTES) throw new DocumentFormatError('ファイルが大きすぎます（5MB まで）。');
  const xml = readZipEntry(buf, 'word/document.xml');
  if (!xml) throw new DocumentFormatError('DOCX の本文（word/document.xml）が見つかりません。');
  const s = xml.toString('utf8');
  const paragraphs = s.split(/<\/w:p>/).map((p) => {
    const runs = [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((m) => (m[1] !== undefined ? decodeXml(m[1]) : m[0] === '<w:tab/>' ? '\t' : '\n'));
    return runs.join('');
  });
  return paragraphs.map((p) => p.trim()).filter(Boolean).join('\n');
}
