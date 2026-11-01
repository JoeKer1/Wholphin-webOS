import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
const target = process.argv[2];
if (!["webos", "tizen", "firetv"].includes(target)) throw Error("Choose webos, tizen or firetv.");
let result = spawnSync(process.execPath, ["tools/build.mjs", target], {
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status || 1);
if (target === "firetv") {
  result = spawnSync(process.env.GRADLE || path.resolve("platforms/firetv/gradlew"), ["-p", "platforms/firetv", "assembleDebug", "--no-daemon"], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  const output = `dist/ember-firetv-${version}-debug.apk`;
  fs.copyFileSync("platforms/firetv/app/build/outputs/apk/debug/app-debug.apk", output);
  console.log(`APK: ${output}`);
  process.exit(0);
}
const command =
  target === "webos"
    ? process.env.ARES_PACKAGE || "ares-package"
    : process.env.TIZEN_CLI || "tizen";
if (target === "tizen" && !process.env.TIZEN_PROFILE)
  throw Error(
    "Set TIZEN_PROFILE to an existing Samsung TV signing profile. Staged unsigned sources are in dist/tizen.",
  );
const args =
  target === "webos"
    ? ["dist/webos", "-o", "dist"]
    : [
        "package",
        "-t",
        "wgt",
        "-s",
        process.env.TIZEN_PROFILE,
        "--",
        path.resolve("dist/tizen"),
      ];
result = spawnSync(command, args, { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status || 0);
