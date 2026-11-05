import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFile,
  mkdir,
  writeFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { SourceError } from "./public-source.mjs";
const exec = promisify(execFile),
  pending = new Map();
function mime(buffer) {
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return "image/jpeg";
  if (buffer.subarray(0, 3).toString() === "GIF") return "image/gif";
  if (
    buffer.subarray(0, 4).toString() === "RIFF" &&
    buffer.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  throw new SourceError("Party asset is not a supported image.");
}
export async function partyLogo(id, source) {
  if (!/^-?\d{1,8}$/.test(id))
    throw new SourceError("Invalid party identifier.", 400);
  if (pending.has(id)) return pending.get(id);
  const job = (async () => {
    const path = `data/party-logos/${id}.image`;
    let old;
    try {
      old = await readFile(path);
      if (Date.now() - (await stat(path)).mtimeMs < 2592000000)
        return { buffer: old, mime: mime(old) };
    } catch {}
    const dictionary = (await source.get("2026", "parties")).data,
      p = dictionary.find((p) => String(p.ID) === id),
      file = p?.PartyImage;
    if (
      !file ||
      /[\\/\x00-\x1f]/.test(file) ||
      file.includes("..") ||
      !/^.{1,150}\.(png|jpg|jpeg|gif|webp)$/i.test(file)
    )
      throw new SourceError("No verified party image available.", 404);
    await mkdir("data/party-logos", { recursive: true });
    const tmp = `${path}.${randomUUID()}.tmp`;
    try {
      await exec(
        process.platform === "win32" ? "curl.exe" : "curl",
        [
          "--fail",
          "--silent",
          "--show-error",
          "--proto",
          "=https",
          "--max-time",
          "20",
          "--max-filesize",
          "2000000",
          "https://results.elections.org.za/dashboards/lge/Party_Images/" +
            encodeURIComponent(file),
          "--output",
          tmp,
        ],
        { timeout: 25000 },
      );
      const buffer = await readFile(tmp),
        type = mime(buffer);
      if (buffer.length > 2000000) throw new SourceError("Logo too large.");
      await rename(tmp, path);
      return { buffer, mime: type };
    } catch (e) {
      await unlink(tmp).catch(() => {});
      if (old) return { buffer: old, mime: mime(old) };
      throw new SourceError("Party image unavailable.", 404);
    }
  })().finally(() => pending.delete(id));
  pending.set(id, job);
  return job;
}
