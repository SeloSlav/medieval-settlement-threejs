import http from 'node:http';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
const root=path.resolve('artifacts/trailer');await mkdir(path.join(root,'raw'),{recursive:true});
http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','http://localhost:5176');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const match=req.url.match(/^\/(clip|ivf|json)\/([a-zA-Z0-9_-]+)$/);
  if(req.method!=='POST'||!match){res.writeHead(404);res.end();return;}
  const out=path.join(root,match[1]!=='json'?'raw':'',match[2]+(match[1]==='clip'?'.webm':match[1]==='ivf'?'.ivf':'.json'));
  try{await pipeline(req,createWriteStream(out));res.end('saved');console.log('Saved '+out);}catch(e){res.writeHead(500);res.end('save failed');console.error(e);}
}).listen(5180,'127.0.0.1',()=>console.log('Trailer capture receiver on 127.0.0.1:5180'));
