import {defineConfig} from "vite";
import path from "node:path";
import {fileURLToPath} from "node:url";
const dir=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(dir,"../..");
export default defineConfig({
 root:dir,
 resolve:{
  alias:[{find:/^@\//,replacement:root+"/"}],
  dedupe:["react","react-dom","yjs","y-prosemirror","@blocknote/core","@blocknote/react","@blocknote/shadcn","@blocknote/xl-multi-column"],
 },
 esbuild:{jsx:"automatic"},
 server:{host:"127.0.0.1",port:3238,strictPort:true,fs:{allow:[root]}},
 preview:{host:"127.0.0.1",port:3238,strictPort:true},
});
