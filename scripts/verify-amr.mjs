import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";
import { execFileSync } from "node:child_process";

const output=path.resolve('.tmp/amr-tests');fs.mkdirSync(output,{recursive:true});
for(const [name,file] of Object.entries({amr:'src/constants/amr.ts',pathfinding:'src/domain/amr/navigation/pathfinding.ts'})){
  const source=fs.readFileSync(file,'utf8').replace(/from "(?:@\/|(?:\.\.?\/)+)[^"\n]+"/g,spec=>spec.replace(/"[^"\n]+"/,value=>`"./${path.basename(value.slice(1,-1))}.mjs"`));
  fs.writeFileSync(path.join(output,`${name}.mjs`),ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}));
}
const {AMR_CONFIG:C}=await import('../.tmp/amr-tests/amr.mjs');
const {findPath}=await import('../.tmp/amr-tests/pathfinding.mjs');
assert.equal(findPath({columns:3,rows:3,blocked:new Set([1,4,7])},[0,0],[2,0]),null);
assert.equal(findPath({columns:3,rows:3,blocked:new Set([0])},[0,0],[2,0]),null);
assert.equal(findPath({columns:3,rows:3,blocked:new Set()},[-1,0],[2,0]),null);
assert.deepEqual(findPath({columns:3,rows:3,blocked:new Set()},[0,0],[2,0]),[[0,0],[1,0],[2,0]]);
assert.deepEqual(findPath({columns:4,rows:4,blocked:new Set()},[0,0],[3,3]),[[0,0],[1,1],[2,2],[3,3]]);
assert.equal(findPath({columns:2,rows:2,blocked:new Set([1,2])},[0,0],[1,1]),null,'Diagonal cut through a blocked corner');
assert.deepEqual(findPath({columns:2,rows:2,blocked:new Set([1])},[0,0],[1,1]),[[0,0],[0,1],[1,1]]);
assert.equal(findPath({columns:2,rows:2,blocked:new Set(),canTraverse:()=>false},[0,0],[1,1]),null,'Diagonal ignored continuous edge clearance');
console.log('AMR: grid pathfinding (blocked, diagonal corner and clearance rules) passed');
// Fleet traffic regressions (head-on corridor, shared dock, multi-fleet deadlock) run on the simulator modules built by verify-ik.
execFileSync(process.execPath,['scripts/verify-ik.mjs','--amr-traffic'],{stdio:'inherit'});
