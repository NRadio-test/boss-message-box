import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, writeFile, mkdir, mkdtemp, unlink, rmdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { ULTRA_PHOTO_PREFIX, photoStoredName } from "../src/shared/ultra-photo-contracts.ts";

// Explicit --remote is required. The manifest makes interrupted imports resumable.
const source = process.argv[2];
const remote = process.argv.includes("--remote");
const verify = process.argv.includes("--verify");
if (!source) throw new Error("Usage: node scripts/upload-ultra-photos.mjs <directory> [--remote]");
const manifestPath = resolve(".wrangler/ultra-import-manifest.json");
await mkdir(resolve(".wrangler"), { recursive: true });
let manifest = [];
try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
const names = (await readdir(source)).filter(name => /\.(jpe?g|png|webp|gif)$/i.test(name)).sort();
const mime = name => /\.png$/i.test(name) ? "image/png" : /\.webp$/i.test(name) ? "image/webp" : /\.gif$/i.test(name) ? "image/gif" : "image/jpeg";
for (const name of names) {
  const path = join(source, name);
  const hash = createHash("sha256").update(await readFile(path)).digest("hex");
  let entry = manifest.find(item => item.fileName === name && item.sha256 === hash && item.remote === remote);
  if (!entry) {
    entry = { fileName: name, sha256: hash, id: randomUUID(), remote, uploaded: false };
    manifest.push(entry); await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }
  if (entry.uploaded) { console.log(`Already uploaded: ${name}`); continue; }
  const key = `${ULTRA_PHOTO_PREFIX}${entry.id}/${photoStoredName(name)}`;
  const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "r2", "object", "put",
    `boss-message-box-images/${key}`, "--file", path, "--content-type", mime(name), "--cache-control", "private, no-store", remote ? "--remote" : "--local"], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Upload stopped at ${name}; retry the same command to resume.`);
  entry.uploaded = true; entry.key = key; entry.completedAt = Date.now();
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}
if (verify) {
  const temporary = await mkdtemp("/private/tmp/nradio-ultra-verify-");
  for (const entry of manifest.filter(item => item.remote === remote && names.includes(item.fileName) && item.uploaded)) {
    const path = join(temporary, entry.id);
    const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "r2", "object", "get", `boss-message-box-images/${entry.key}`,
      "--file", path, remote ? "--remote" : "--local"], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Read-back verification failed for ${entry.fileName}`);
    const hash = createHash("sha256").update(await readFile(path)).digest("hex");
    await unlink(path);
    if (hash !== entry.sha256) throw new Error(`Original bytes differ: ${entry.fileName}`);
    entry.verified = true; await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`Verified original SHA-256: ${entry.fileName}`);
  }
  await rmdir(temporary);
}
console.log(`Uploaded ${names.length} original photos to ${remote ? "remote" : "local"} R2${verify ? ", read-back hashes verified" : ""}; manifest: ${manifestPath}`);
