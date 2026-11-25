const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

const DAY_RE = /\b(mon(?:day)?|tue(?:sday|s)?|wed(?:nesday|s)?|thu(?:rsday|rs)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i;

export function inferWeekday(value='') {
  const match = String(value).toLowerCase().match(DAY_RE);
  if (!match) return null;
  const key = match[1].slice(0,3);
  return DAYS.find(day => day.slice(0,3).toLowerCase() === key) || null;
}

function clockMinutes(value) {
  const text = String(value || '').toLowerCase().replace(/\./g,'');
  if (/\bnoon\b/.test(text) || /\b12\s*pm\b/.test(text)) return 12 * 60;
  if (/\bmidnight\b/.test(text) || /\b12\s*am\b/.test(text)) return 0;
  const match = text.match(/\b(\d{1,2})(?::|\.)(\d{2})\s*(am|pm)?\b/i);
  if (!match) return null;
  let hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  if (match[3] === 'pm' && hour < 12) hour += 12;
  if (match[3] === 'am' && hour === 12) hour = 0;
  return hour * 60 + minute;
}
const asTime = n => `${String(Math.floor(n / 60) % 24).padStart(2,'0')}:${String(Math.round(n % 60)).padStart(2,'0')}`;

function clusterPositions(values, tolerance=2) {
  const sorted = [...values].sort((a,b)=>a-b), groups=[];
  for (const value of sorted) {
    const last=groups[groups.length-1];
    if (last && value-last.values[last.values.length-1] <= tolerance) last.values.push(value);
    else groups.push({values:[value]});
  }
  return groups.map(g=>Math.round(g.values.reduce((a,b)=>a+b,0)/g.values.length));
}
function lineGroups(words) {
  const candidates=(words||[]).filter(w=>w.text&&w.bbox).map(w=>({
    text:String(w.text).trim(),x0:w.bbox.x0,x1:w.bbox.x1,y0:w.bbox.y0,y1:w.bbox.y1,
    x:(w.bbox.x0+w.bbox.x1)/2,y:(w.bbox.y0+w.bbox.y1)/2,
    h:Math.max(0,w.bbox.y1-w.bbox.y0)
  }));
  const typicalHeight=median(candidates.map(w=>w.h).filter(h=>h>=3&&h<=80))||10;
  const valid=candidates.filter(w=>w.h>=3&&w.h<=Math.max(30,typicalHeight*2.5)&&/[a-z0-9]/i.test(w.text));
  const tolerance=Math.max(4,typicalHeight*0.75);
  const lines=[];
  for (const word of valid.sort((a,b)=>a.y-b.y||a.x-b.x)) {
    let line=lines.find(item=>Math.abs(item.y-word.y)<=tolerance);
    if (!line) { line={y:word.y,words:[]}; lines.push(line); }
    line.words.push(word);
    line.y=line.words.reduce((sum,w)=>sum+w.y,0)/line.words.length;
  }
  return lines.map(line=>({...line,words:line.words.sort((a,b)=>a.x-b.x),text:line.words.map(w=>w.text).join(' ')}));
}
function median(values) {
  const a=[...values].sort((x,y)=>x-y);
  return a.length ? a[Math.floor(a.length/2)] : 255;
}
function luminance(data,width,x,y) {
  const i=(Math.max(0,Math.min(data.length/(4*width)-1,Math.round(y)))*width+Math.max(0,Math.min(width-1,Math.round(x))))*4;
  return 0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2];
}
export function detectGrid(data,width,height) {
  // Detect vertical column boundaries across the full page first. These remain
  // continuous even when timetable cells are vertically merged.
  const colScores=[];
  for(let x=0;x<width;x++){
    let dark=0;
    for(let y=0;y<height;y++){const i=(y*width+x)*4;if((data[i]+data[i+1]+data[i+2])/3<205)dark++;}
    colScores.push(dark/height);
  }
  let vertical=clusterPositions(colScores.map((v,i)=>v>0.48?i:null).filter(v=>v!==null),3);
  if(vertical.length<4)return null;

  // The time gutter is never merged with class blocks. Detect every horizontal
  // row boundary there instead of projecting across the entire timetable.
  const left=vertical[0],right=vertical[1];
  const verticalRuns=[];
  let runStart=null,lastDark=null;
  for(let y=0;y<height;y++){
    let darkest=255;
    for(let dx=-1;dx<=1;dx++){const x=Math.max(0,Math.min(width-1,left+dx)),i=(y*width+x)*4;darkest=Math.min(darkest,(data[i]+data[i+1]+data[i+2])/3);}
    if(darkest<205){if(runStart===null)runStart=y;lastDark=y;}
    else if(runStart!==null){verticalRuns.push({start:runStart,end:lastDark,length:lastDark-runStart+1});runStart=null;lastDark=null;}
  }
  if(runStart!==null)verticalRuns.push({start:runStart,end:lastDark,length:lastDark-runStart+1});
  const longest=verticalRuns.sort((a,b)=>b.length-a.length)[0];
  if(!longest||longest.length<height*0.25)return null;
  const tableTop=longest.start,tableBottom=longest.end;
  const rowScores=[];
  for(let y=tableTop;y<=tableBottom;y++){
    let dark=0;
    for(let x=left+2;x<right-2;x++){const i=(y*width+x)*4;if((data[i]+data[i+1]+data[i+2])/3<205)dark++;}
    rowScores.push({y,score:dark/Math.max(1,right-left-4)});
  }
  const horizontal=clusterPositions(rowScores.filter(v=>v.score>0.42).map(v=>v.y),3);
  if(horizontal.length<4)return null;

  // Recheck verticals only over the detected table height to reject unrelated
  // marks outside the table body.
  vertical=clusterPositions(colScores.map((v,i)=>{
    let dark=0;
    for(let y=horizontal[0];y<=horizontal[horizontal.length-1];y++){const p=(y*width+i)*4;if((data[p]+data[p+1]+data[p+2])/3<205)dark++;}
    return dark/(horizontal[horizontal.length-1]-horizontal[0]+1)>0.55?i:null;
  }).filter(v=>v!==null),3);
  return horizontal.length>=4&&vertical.length>=4?{horizontal,vertical}:null;
}
function interpolateAnchors(lines, anchors) {
  const map=new Map(anchors.map(a=>[a.index,a.minutes]));
  const points=[...map.entries()].sort((a,b)=>a[0]-b[0]);
  if(points.length<2)return null;
  const values=[];
  for(let i=0;i<lines.length;i++){
    let a=points[0],b=points[1];
    if(i<=a[0]){a=points[0];b=points[1];}
    else if(i>=points[points.length-1][0]){a=points[points.length-2];b=points[points.length-1];}
    else {for(let p=0;p<points.length-1;p++)if(i>=points[p][0]&&i<=points[p+1][0]){a=points[p];b=points[p+1];break;}}
    const fraction=(i-a[0])/(b[0]-a[0]);
    values[i]=Math.round(a[1]+fraction*(b[1]-a[1]));
  }
  return values;
}
function cellSamples(data,width,x0,x1,y0,y1) {
  const xs=Array.from({length:9},(_,i)=>x0+(x1-x0)*(0.18+i*0.08));
  const ys=[y0+(y1-y0)*0.25,y0+(y1-y0)*0.5,y0+(y1-y0)*0.75];
  return ys.flatMap(y=>xs.map(x=>luminance(data,width,x,y)));
}
function cellText(words,x0,x1,y0,y1) {
  const inside=words.filter(w=>w.x>x0+3&&w.x<x1-3&&w.y>y0+2&&w.y<y1-2);
  const groups=[];
  for(const word of inside.sort((a,b)=>a.y-b.y||a.x-b.x)){
    let line=groups.find(g=>Math.abs(g.y-word.y)<Math.max(5,word.h*0.8));
    if(!line){line={y:word.y,words:[]};groups.push(line);}
    line.words.push(word);line.y=line.words.reduce((n,w)=>n+w.y,0)/line.words.length;
  }
  return groups.sort((a,b)=>a.y-b.y).map(g=>g.words.sort((a,b)=>a.x-b.x).map(w=>w.text).join(' ').trim()).filter(Boolean);
}
function makeSession(day,start,end,lines) {
  const clean=lines.map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
  if(!clean.length||start>=end)return null;
  const courseIndex=clean.findIndex(line=>/[A-Z]{2,6}\s?\d{3,4}[A-Z]?/i.test(line));
  const title=courseIndex>=0?clean[courseIndex]:clean[0];
  const codeMatch=title.match(/([A-Z]{2,6}\s?\d{3,4}[A-Z]?)/i);
  const code=codeMatch?codeMatch[1].replace(/\s+/g,' ').toUpperCase():title;
  const venue=clean.filter((_,i)=>i!==courseIndex).join(' · ')||'TBC';
  return {day:DAYS.indexOf(day),code,name:title,start:asTime(start),end:asTime(end),venue,type:/tutorial/i.test(title)?'Tutorial':/prac/i.test(title)?'Practical':'Lecture',confidence:courseIndex>=0?'review':'low'};
}

export function parseGridTimetable({imageData,width,height,words,anchorWords}) {
  const data=imageData?.data||imageData;
  if(!data||!width||!height)return [];
  const grid=detectGrid(data,width,height);
  if(!grid)return [];
  const lines=lineGroups(words);
  const anchorLines=lineGroups(anchorWords||words);
  if(!lines.length||!anchorLines.length)return [];
  const dayHeaders=anchorLines.flatMap(line=>line.words.flatMap(word=>{
    const day=inferWeekday(word.text);
    return day?[{day,x:word.x,y:word.y}]:[];
  }));
  if(dayHeaders.length<2)return [];
  const dayColumns=dayHeaders.map(mark=>{
    const index=grid.vertical.findIndex((x,i)=>mark.x>x&&mark.x<grid.vertical[i+1]);
    return index>=1&&index<grid.vertical.length-1?{...mark,left:grid.vertical[index],right:grid.vertical[index+1]}:null;
  }).filter(Boolean);
  const rawAnchors=[];
  for(const line of anchorLines){
    if(!line.words.some(w=>w.x<grid.vertical[1]))continue;
    const minutes=clockMinutes(line.text);
    if(minutes===null)continue;
    rawAnchors.push({y:line.y,minutes});
  }
  if(rawAnchors.length<2)return [];
  // OCR time labels sit just below their corresponding horizontal boundary.
  // Use their own baselines as anchors and reconstruct missing half-hour rules
  // between hourly labels (merged cells can erase those rules in the day area).
  const fontHeight=median(anchorLines.flatMap(line=>line.words.map(w=>w.h)));
  const anchored=rawAnchors.map(a=>({...a,y:a.y-fontHeight}));
  const gaps=grid.horizontal.slice(1).map((y,i)=>y-grid.horizontal[i]).filter(d=>d>=20&&d<=110);
  const slotHeight=median(gaps);
  const inferred=[];
  for(let i=0;i<anchored.length-1;i++){
    const a=anchored[i],b=anchored[i+1],distance=b.y-a.y;
    const intervals=Math.round(distance/slotHeight);
    if(intervals>1&&intervals<=8){
      for(let k=1;k<intervals;k++)inferred.push(a.y+distance*k/intervals);
    }
  }
  const boundaries=clusterPositions([...grid.horizontal,...anchored.map(a=>a.y),...inferred],Math.max(14,fontHeight*1.6));
  const timeAnchors=anchored.map(a=>({
    index:boundaries.reduce((best,y,i)=>Math.abs(y-a.y)<Math.abs(boundaries[best]-a.y)?i:best,0),
    minutes:a.minutes
  }));
  const boundaryTimes=interpolateAnchors(boundaries,timeAnchors);
  if(!boundaryTimes)return [];
  const results=[];
  for(const column of dayColumns){
    const slots=[];
    for(let r=0;r<boundaries.length-1;r++){
      const top=boundaries[r],bottom=boundaries[r+1];
      const samples=cellSamples(data,width,column.left,column.right,top,bottom);
      const occupied=median(samples)<249;
      const headerYs=[0.08,0.16,0.24].map(f=>Math.min(bottom-2,top+(bottom-top)*f));
      const headerSamples=headerYs.flatMap(y=>Array.from({length:9},(_,i)=>luminance(data,width,column.left+(column.right-column.left)*(0.18+i*0.08),y)));
      const header=median(headerSamples)<218;
      slots.push({occupied,header,top,bottom,start:boundaryTimes[r],end:boundaryTimes[r+1]});
    }
    let active=null;
    const flush=()=>{if(!active)return;const text=cellText(lines.flatMap(l=>l.words),column.left,column.right,active.top,active.bottom);const result=makeSession(column.day,active.start,active.end,text);if(result)results.push(result);active=null;};
    for(const slot of slots){
      if(!slot.occupied){flush();continue;}
      if(active&&slot.header)flush();
      if(!active)active={top:slot.top,bottom:slot.bottom,start:slot.start,end:slot.end};
      else {active.bottom=slot.bottom;active.end=slot.end;}
    }
    flush();
  }
  const seen=new Set();
  const output=results.filter(r=>{const key=[r.day,r.start,r.end,r.code].join('|');if(seen.has(key))return false;seen.add(key);return true;});
  const normalized=output.map(row=>{
    const ocrPrefix=row.code.match(/^SD8\s?(\d{3,4})\b/i);
    return ocrPrefix?{...row,code:`SDS ${ocrPrefix[1]}`}:row;
  });
  const prefixCounts=new Map();
  for(const row of normalized){
    const match=row.code.match(/^([A-Z]{2,6})\s?\d{3,4}[A-Z]?$/i);
    if(match){const prefix=match[1].toUpperCase();prefixCounts.set(prefix,(prefixCounts.get(prefix)||0)+1);}
  }
  return normalized.map(row=>{
    const match=row.code.match(/^([A-Z]{2,6})\s?\d{3,4}[A-Z]?$/i);
    const suffixDigit=/^[A-Z]{2,6}\s?\d{4}\d\s+(?:lec|lab|prac)/i.test(row.name);
    const uncertain=!match||(prefixCounts.get(match[1].toUpperCase())||0)<2||suffixDigit;
    return {...row,confidence:uncertain?'low':'review'};
  });
}
