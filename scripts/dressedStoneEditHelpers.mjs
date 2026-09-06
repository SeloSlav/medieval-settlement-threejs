import fs from 'node:fs';
import {createHash} from 'node:crypto';
export const convert = s => s.replaceAll('ROOF_TILES','DRESSED_STONE').replaceAll('RoofTiles','DressedStone').replaceAll('roofTiles','dressedStone').replaceAll('roof_tiles','dressed_stone').replaceAll('fired roof tiles','dressed stone').replaceAll('Fired roof tiles','Dressed stone').replaceAll('roof tiles','dressed stone').replaceAll('Roof tiles','Dressed stone');
export const edit=(p,fn)=>{
  const historyPath='output/dressed-stone/edit-progress.json';
  fs.mkdirSync('output/dressed-stone',{recursive:true});
  const history=fs.existsSync(historyPath)?JSON.parse(fs.readFileSync(historyPath,'utf8')):{};
  const key=p+':'+createHash('sha256').update(fn.toString()).digest('hex');
  if(history[key])return;
  fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));
  history[key]=true;fs.writeFileSync(historyPath,JSON.stringify(history));
};
export function cloneStatements(s, predicate, transform=convert) {
  const lines=s.split('\n'), out=[];
  for(let i=0;i<lines.length;i++) {
    const line=lines[i];
    if(!predicate(line)) {out.push(line);continue;}
    let chunk=line, balance=0;
    const count=l=>{const code=l.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g,''); for(const c of code) {if('([{'.includes(c))balance++;else if(')]}'.includes(c))balance--;}};
    count(line);
    // A continued assignment or declaration may start before its opening delimiter.
    if(balance===0 && /=\s*$/.test(line)) {chunk+='\n'+lines[++i];count(lines[i]);}
    while(balance>0 && i+1<lines.length) {chunk+='\n'+lines[++i];count(lines[i]);}
    while(i+1<lines.length && (/^\s*\.[a-zA-Z]/.test(lines[i+1]) || (/^\s*(?:let|const)\b/.test(line) && !/;\s*$/.test(lines[i])))) {chunk+='\n'+lines[++i];count(lines[i]); while(balance>0 && i+1<lines.length){chunk+='\n'+lines[++i];count(lines[i]);}}
    out.push(chunk,transform(chunk));
  }
  return out.join('\n');
}
export const rustRoofStatement=l=>/^\s*(?:(?:pub(?:\([^)]*\))?\s+)?fn \w*roof_tiles\b|let (?:mut )?\w*roof_tiles\w*\b|if [^\n]*roof_tiles|(?:\w+::)?RoofTiles\s*(?:,|=>)|\d+ => Some\(Self::RoofTiles\)|(?:pub )?\w*roof_tiles\w*\s*:|\w+\.\w*roof_tiles\w*\s*[-+]?=)/.test(l);
export function imports(s) {
  return s.replace(/\b(?:available_unreserved_(?:building|treasury)_roof_tiles|spend_aggregate_roof_tiles|total_roof_tiles|CHAPEL_TIER[234]_UPGRADE_ROOF_TILES)\b(?=,)/g, x=>x+', '+convert(x));
}
