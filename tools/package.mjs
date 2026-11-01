import { spawnSync } from "node:child_process";
import path from "node:path";
const target = process.argv[2];
if (!["webos", "tizen"].includes(target)) throw Error("Choose webos or tizen.");
let result = spawnSync(process.execPath, ["tools/build.mjs", target], {
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status || 1);
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
