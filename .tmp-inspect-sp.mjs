const targets=await (await fetch('http://127.0.0.1:9227/json/list')).json();
const target=targets.find(t=>t.type==='page'&&t.url.includes('5193'));
if(!target)throw Error('No owned profiling page');
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
const expression=`JSON.stringify({visibility:document.visibilityState,focus:document.hasFocus(),stats:window.__spApp?.sceneManager?.getPerformanceStats(),tick:String([...window.__spProfile.getConnection().db.world_config.iter()][0]?.simTick),stateTick:window.__spApp?.gameState?.tick,snapshotTick:String(window.__spApp?.spacetimeStore?.snapshot?.simTick),connected:window.__spApp?.spacetimeStore?.isConnected,ready:window.__medievalRoadStartup?.firstPlayableMs,body:document.body.innerText.slice(-700)})`;
const result=await Promise.race([new Promise(r=>{socket.onmessage=m=>r(JSON.parse(m.data));socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));}),new Promise(r=>setTimeout(()=>r({timeout:true}),5000))]);
console.log(JSON.stringify(result));socket.close();
