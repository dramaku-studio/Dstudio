import { inflateRawSync } from "node:zlib";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const bad = (code) => Object.assign(new Error(code), { code, status: 422 });
function xmlText(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw bad("DOCUMENT_INVALID");
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, v) => {
      const chars = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
      if (chars[v]) return chars[v];
      const cp = v.startsWith("#x")
        ? parseInt(v.slice(2), 16)
        : Number(v.slice(1));
      return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff
        ? String.fromCodePoint(cp)
        : "";
    })
    .trim();
}
export async function extractWorkflowDocument(bytes, name) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length > 5 * 1024 * 1024 ||
    !bytes.length
  )
    throw bad("DOCUMENT_MAX_5MB");
  const ext = /\.(docx|doc|txt)$/i.exec(name || "")?.[1]?.toLowerCase();
  let text;
  if (ext === "txt") {
    text = bytes.toString("utf8");
  } else if (ext === "docx") {
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
      if (bytes.readUInt32LE(i) === 0x06054b50) {
        end = i;
        break;
      }
    if (end < 0) throw bad("DOCUMENT_INVALID");
    const count = bytes.readUInt16LE(end + 10),
      offset = bytes.readUInt32LE(end + 16);
    let pos = offset;
    if (count > 2000) throw bad("DOCUMENT_INVALID");
    for (let i = 0; i < count; i++) {
      if (pos + 46 > bytes.length || bytes.readUInt32LE(pos) !== 0x02014b50)
        throw bad("DOCUMENT_INVALID");
      const flags = bytes.readUInt16LE(pos + 8),
        method = bytes.readUInt16LE(pos + 10),
        size = bytes.readUInt32LE(pos + 20),
        rawSize = bytes.readUInt32LE(pos + 24),
        n = bytes.readUInt16LE(pos + 28),
        extra = bytes.readUInt16LE(pos + 30),
        comment = bytes.readUInt16LE(pos + 32),
        start = bytes.readUInt32LE(pos + 42);
      const entry = bytes.toString("utf8", pos + 46, pos + 46 + n);
      if (entry === "word/document.xml") {
        if (
          flags & 1 ||
          rawSize > 2 * 1024 * 1024 ||
          start + 30 > bytes.length ||
          bytes.readUInt32LE(start) !== 0x04034b50
        )
          throw bad("DOCUMENT_INVALID");
        const dataStart =
          start +
          30 +
          bytes.readUInt16LE(start + 26) +
          bytes.readUInt16LE(start + 28);
        if (dataStart + size > bytes.length) throw bad("DOCUMENT_INVALID");
        const data = bytes.subarray(dataStart, dataStart + size);
        let decoded;
        try {
          decoded =
            method === 0
              ? data
              : method === 8
                ? inflateRawSync(data, { maxOutputLength: 2 * 1024 * 1024 })
                : null;
        } catch {
          throw bad("DOCUMENT_INVALID");
        }
        if (!decoded || decoded.length !== rawSize)
          throw bad("DOCUMENT_INVALID");
        text = xmlText(decoded.toString("utf8"));
        break;
      }
      pos += 46 + n + extra + comment;
    }
  } else if (ext === "doc") {
    if (process.platform !== "darwin")
      throw bad("DOCUMENT_DOC_CONVERT_TO_DOCX");
    const root = await mkdtemp(join(tmpdir(), "studio-doc-"));
    try {
      const file = join(root, "source.doc");
      await writeFile(file, bytes, { mode: 0o600 });
      await promisify(execFile)(
        "/usr/bin/textutil",
        [
          "-convert",
          "txt",
          "-encoding",
          "UTF-8",
          "-output",
          join(root, "text.txt"),
          file,
        ],
        { timeout: 15000, maxBuffer: 100000 },
      );
      text = await readFile(join(root, "text.txt"), "utf8");
    } catch {
      throw bad("DOCUMENT_DOC_CONVERT_TO_DOCX");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  } else throw bad("DOCUMENT_FORMAT");
  if (
    typeof text !== "string" ||
    !text.trim() ||
    text.length > 24000 ||
    text.includes("\0") ||
    text.includes("\ufffd")
  )
    throw bad("DOCUMENT_TEXT_INVALID");
  return text.trim();
}
