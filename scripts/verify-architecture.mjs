import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const sourceRoot = path.resolve("src");
const errors = [];
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(file) : /\.tsx?$/.test(file) ? [file] : [];
});
const files = walk(sourceRoot);
const exists = (base) => [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
for (const file of files) {
  const name = path.relative(sourceRoot, file).replaceAll("\\", "/");
  const imports = ts.preProcessFile(fs.readFileSync(file, "utf8"), true, true).importedFiles;
  if (name.startsWith("domain/") && name.endsWith(".tsx")) errors.push(`${name}: domain must not contain JSX`);
  for (const { fileName: specifier } of imports) {
    if (specifier.startsWith("@/features/") || specifier.startsWith("@/ui/components/")) errors.push(`${name}: obsolete import ${specifier}`);
    if (name.startsWith("domain/") && /^(?:@\/(?:ui|viewport|objects|stores|hooks|components)\/|react(?:$|\/)|@react-three\/|zustand(?:$|\/))/.test(specifier)) errors.push(`${name}: presentation/state dependency ${specifier}`);
    // KPI layer stays headless/pure: no three (math or scene graph) in domain/kpi.
    if (name.startsWith("domain/kpi/") && /^three(?:$|\/)/.test(specifier)) errors.push(`${name}: domain/kpi must not import three`);
    if (!specifier.startsWith("@/") && !specifier.startsWith(".")) continue;
    const clean = specifier.split("?")[0];
    if (/\.(?:glb|png|jpg|jpeg|svg|css|webp)$/.test(clean)) continue;
    const base = specifier.startsWith("@/") ? path.join(sourceRoot, clean.slice(2)) : path.resolve(path.dirname(file), clean);
    if (!exists(base)) errors.push(`${name}: unresolved import ${specifier}`);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Architecture: ${files.length} TS/TSX files checked; imports resolve, atomic UI stays in components, domain has no presentation/store dependencies.`);
