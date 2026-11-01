import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformAsync } from "@babel/core";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  target = process.argv[2];
if (!["webos", "tizen"].includes(target))
  throw new Error("Choose webos or tizen.");
const source = path.join(root, "webos/app"),
  out = path.join(root, "dist", target);
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
await fs.cp(source, out, { recursive: true });
if (target === "tizen") {
  await fs.rm(path.join(out, "appinfo.json"));
  for (const file of ["platform.js", "avplay.js", "config.xml", "tizen.css"])
    await fs.copyFile(
      path.join(root, "platforms/tizen", file),
      path.join(out, file),
    );
  let html = await fs.readFile(path.join(out, "index.html"), "utf8");
  html = html
    .replace("object-src 'none'", "object-src 'self'")
    .replace(
      '<link rel="stylesheet" href="style.css" />',
      '<link rel="stylesheet" href="style.css" /><link rel="stylesheet" href="tizen.css" />',
    );
  html = html.replace(
    '<script src="platform.js"></script>',
    '<script src="compat.js"></script>\n<script src="$WEBAPIS/webapis/webapis.js"></script>\n<script src="avplay.js"></script>\n<script src="platform.js"></script>',
  );
  await fs.writeFile(path.join(out, "index.html"), html);
  const compatibility = await Promise.all(
    [
      "core-js-bundle/minified.js",
      "abortcontroller-polyfill/dist/polyfill-patch-fetch.js",
    ].map((x) => fs.readFile(require.resolve(x), "utf8")),
  );
  await fs.writeFile(path.join(out, "compat.js"), compatibility.join("\n;\n"));
  for (const file of ["app.js", "core.js", "platform.js", "avplay.js"]) {
    const code = await fs.readFile(path.join(out, file), "utf8");
    const compiled = await transformAsync(code, {
      filename: file,
      babelrc: false,
      configFile: false,
      sourceMaps: false,
      comments: false,
      presets: [
        [
          require.resolve("@babel/preset-env"),
          { targets: { chrome: "56" }, modules: false },
        ],
      ],
    });
    await fs.writeFile(path.join(out, file), compiled.code + "\n");
  }
  await fs.copyFile(
    path.join(root, "platforms/tizen/ember-tizen-icon.png"),
    path.join(out, "ember-tizen-icon.png"),
  );
  const licenses = await Promise.all(
    ["core-js-bundle/LICENSE", "abortcontroller-polyfill/LICENSE"].map((x) =>
      fs.readFile(require.resolve(x), "utf8"),
    ),
  );
  await fs.writeFile(
    path.join(out, "THIRD-PARTY-LICENSES.txt"),
    licenses.join("\n\n"),
  );
}
console.log(`Built ${target}: ${path.relative(root, out)}`);
