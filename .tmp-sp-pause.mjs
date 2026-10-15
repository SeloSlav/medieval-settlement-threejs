const targets=await (await fetch('http://127.0.0.1:9227/json/list')).json();
const target=targets.find(t=>t.type==='page'&&t.url.includes('5193'));
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
const result=await Promise.race([new Promise(resolve=>{
  socket.onmessage=m=>{const r=JSON.parse(m.data);if(r.method==='Debugger.paused')resolve(r.params.callFrames.slice(0,8).map(f=>({name:f.functionName,url:f.url,location:f.location})));};
  socket.send(JSON.stringify({id:1,method:'Debugger.enable'}));
  socket.send(JSON.stringify({id:2,method:'Debugger.pause'}));
}),new Promise(r=>setTimeout(()=>r({timeout:true}),10000))]);
console.log(JSON.stringify(result));
socket.send(JSON.stringify({id:3,method:'Debugger.resume'}));
socket.close();
