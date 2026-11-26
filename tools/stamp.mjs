// Posa un número de versió nou a l'app (s'executa sol a Netlify en cada desplegament).
import fs from "node:fs";
const v = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12); // AAAAMMDDhhmm (UTC)
const f = (p, re, rep) => fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(re, rep));
f("public/index.html", /const APP_VERSION='[^']*'/, `const APP_VERSION='${v}'`);
f("public/sw.js", /const C='plugranja-[^']*'/, `const C='plugranja-${v}'`);
fs.writeFileSync("public/version.json", JSON.stringify({ v }) + "\n");
console.log("PLUgranja versió", v);
