import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import {parseGridTimetable, inferWeekday} from './gridTimetable.js';

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const normalize = (s='') => String(s).toLowerCase().replace(/\s+/g,' ').trim();
const timeRe = /\b(\d{1,2})[:.](\d{2})\s*(a\.?m\.?|p\.?m\.?)?\b/gi;

function parseTimes(text) {
  const matches = [...String(text).matchAll(timeRe)];
  const values = matches.map(m => {
    let h=Number(m[1]), min=Number(m[2]), ap=(m[3]||'').toLowerCase().replace(/\./g,'');
    if (h>23 || min>59) return null;
    if(ap==='pm'&&h<12)h+=12;
    if(ap==='am'&&h===12)h=0;
    return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }).filter(Boolean);
  return values;
}
function parseTimePair(text) {
  const values=parseTimes(text);
  return values.length>=2 ? [values[0],values[1]] : null;
}
function inferDay(text) { return inferWeekday(text); }
function cleanCell(value) {
  return String(value??'').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim();
}
function session(day, timeText, description, extra='') {
  const pair=parseTimePair(timeText);
  if(!day || !pair || pair[0]>=pair[1]) return null;
  const detail=cleanCell(description)||'Imported class';
  const bits=detail.split(/\s+[|•–—]\s+/).filter(Boolean);
  const code=bits[0]||detail;
  return {day:DAYS.indexOf(day),code,name:bits[1]||code,start:pair[0],end:pair[1],venue:cleanCell(extra)||bits.slice(2).join(' ')||'TBC',type:'Lecture',confidence:'review'};
}
function parseMatrix(matrix) {
  const rows=[];
  const grid=matrix.map(row=>(row||[]).map(cleanCell));
  // Layout A: days are column headers; time is on each row or inside each day cell.
  for(let ri=0;ri<Math.min(grid.length,30);ri++){
    const header=grid[ri].map(inferDay);
    const dayCols=header.map((d,c)=>d?{day:d,col:c}:null).filter(Boolean);
    if(dayCols.length<2) continue;
    for(let r=ri+1;r<grid.length;r++){
      const line=grid[r].join(' | ');
      const rowPair=parseTimePair(line);
      const timeCell=grid[r].find(c=>parseTimePair(c));
      for(const item of dayCols){
        const cell=grid[r][item.col];
        if(!cell) continue;
        const pair=parseTimePair(cell)||rowPair;
        if(!pair) continue;
        const desc=cell.replace(timeRe,' ').replace(/[|•–—]/g,' ').trim() || grid[r].filter((v,c)=>c!==item.col&&v&&!parseTimePair(v)).join(' ');
        const result=session(item.day, pair.join(' - '), desc);
        if(result) rows.push(result);
      }
      if(!rowPair && !timeCell) continue;
    }
    if(rows.length) return dedupe(rows);
  }
  // Layout B: days label rows; times/classes occur in cells to the right.
  for(const row of grid){
    const dayIndex=row.findIndex(c=>inferDay(c));
    if(dayIndex<0) continue;
    const day=inferDay(row[dayIndex]);
    for(let c=dayIndex+1;c<row.length;c++){
      const cell=row[c]; if(!cell) continue;
      const pair=parseTimePair(cell);
      if(pair){
        const desc=cell.replace(timeRe,' ').replace(/[|•–—]/g,' ').trim() || row.slice(c+1).filter(Boolean).join(' ');
        const result=session(day,pair.join(' - '),desc);
        if(result) rows.push(result);
      }
    }
  }
  if(rows.length) return dedupe(rows);
  // Layout C: conventional records with day, start/end, course and venue in separate columns.
  const objects=grid.map(row=>Object.fromEntries(row.map((v,i)=>[String(i),v])));
  for(const r of objects){
    const values=Object.values(r), day=inferDay(values.join(' '));
    const pair=parseTimePair(values.join(' '));
    if(!day||!pair) continue;
    const nonTime=values.filter(v=>v&&!inferDay(v)&&!parseTimePair(v));
    const result=session(day,pair.join(' - '),nonTime[0],nonTime.slice(1).join(' '));
    if(result) rows.push(result);
  }
  return dedupe(rows);
}
function dedupe(rows) {
  const seen=new Set();
  return rows.filter(r=>{const k=[r.day,r.start,r.end,r.code,r.venue].join('|');if(seen.has(k))return false;seen.add(k);return true;});
}
function parseText(text) {
  const lines=String(text).split(/\n|\r/).map(x=>x.trim()).filter(Boolean);
  const rows=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i], day=inferDay(line), pair=parseTimePair(line);
    if(day&&pair){
      const rest=line.replace(timeRe,' ').replace(new RegExp(day,'i'),' ').replace(/[|,;\t]+/g,' ').trim();
      const next=lines[i+1]||'';
      const detail=rest||(!inferDay(next)&&!parseTimePair(next)?next:'');
      const result=session(day,pair.join(' - '),detail);
      if(result) rows.push(result);
    }
  }
  // A grid flattened by OCR can place day, time and course on adjacent lines.
  if(!rows.length){
    for(let i=0;i<lines.length;i++){
      const day=inferDay(lines[i]);
      if(!day) continue;
      for(let j=i+1;j<Math.min(lines.length,i+5);j++){
        const pair=parseTimePair(lines[j]);
        if(pair){
          const desc=lines.slice(j+1,j+3).find(x=>!inferDay(x)&&!parseTimePair(x))||'Imported class';
          const result=session(day,pair.join(' - '),desc);
          if(result) rows.push(result);
        }
      }
    }
  }
  return dedupe(rows);
}

function parseSpatialWords(words) {
  const items=(words||[]).filter(w=>w.text?.trim() && (w.confidence==null || w.confidence>18)).map(w=>{
    const x0=w.bbox?.x0 ?? w.x0 ?? 0, x1=w.bbox?.x1 ?? w.x1 ?? 0;
    const y0=w.bbox?.y0 ?? w.y0 ?? 0, y1=w.bbox?.y1 ?? w.y1 ?? 0;
    return {text:w.text.trim(),x:(x0+x1)/2,y:(y0+y1)/2,x0,x1,y0,y1};
  });
  if(!items.length) return [];
  const heights=items.map(w=>Math.max(1,Math.abs(w.y1-w.y0))).sort((a,b)=>a-b);
  const h=heights[Math.floor(heights.length/2)]||12, tolerance=Math.max(5,h*0.8);
  const lines=[];
  for(const w of items.slice().sort((a,b)=>a.y-b.y||a.x-b.x)){
    let line=lines.find(l=>Math.abs(l.y-w.y)<=tolerance);
    if(!line){line={y:w.y,words:[]};lines.push(line);}
    line.words.push(w);line.y=line.words.reduce((n,x)=>n+x.y,0)/line.words.length;
  }
  for(const l of lines){l.words.sort((a,b)=>a.x-b.x);l.text=l.words.map(w=>w.text).join(' ');}
  const dayMarks=[];
  for(const w of items){const day=inferDay(w.text);if(day)dayMarks.push({day,x:w.x,y:w.y});}
  const found=[];
  // Case 1: each class cell contains its own day and time range.
  for(const line of lines){
    const pair=parseTimePair(line.text);
    if(!pair||pair[0]>=pair[1])continue;
    const day=inferDay(line.text);
    if(day){
      const desc=line.words.filter(w=>!parseTimes(w.text).length&&!inferDay(w.text)).map(w=>w.text).join(' ')||'Imported class — please review';
      const result=session(day,pair.join(' - '),desc);
      if(result)found.push(result);
    }
  }
  // Case 2: conventional timetable grid: weekday headings define columns,
  // time ranges define rows, and course names occupy the matching cells.
  if(dayMarks.length>=2){
    const columns=[...new Map(dayMarks.sort((a,b)=>a.x-b.x).map(d=>[d.day,d])).values()].sort((a,b)=>a.x-b.x);
    const boundaries=columns.map((d,i)=>({
      ...d,left:i===0?-Infinity:(columns[i-1].x+d.x)/2,
      right:i===columns.length-1?Infinity:(d.x+columns[i+1].x)/2
    }));
    for(const line of lines){
      const pair=parseTimePair(line.text);
      if(!pair||pair[0]>=pair[1])continue;
      const rowY=line.y;
      for(const col of boundaries){
        if(found.some(r=>r.day===DAYS.indexOf(col.day)&&r.start===pair[0]&&r.end===pair[1]))continue;
        const cellWords=items.filter(w=>w.x>col.left&&w.x<=col.right&&Math.abs(w.y-rowY)<=Math.max(h*3.2,18)
          &&!parseTimes(w.text).length&&!inferDay(w.text));
        const description=cellWords.sort((a,b)=>a.x-b.x).map(w=>w.text).join(' ').replace(/\s+/g,' ').trim();
        if(!description)continue;
        const result=session(col.day,pair.join(' - '),description);
        if(result)found.push(result);
      }
    }
  }
  // Case 3: a time and its course name share a row under a weekday heading.
  if(!found.length&&dayMarks.length){
    for(const line of lines){
      const pair=parseTimePair(line.text);if(!pair||pair[0]>=pair[1])continue;
      const x=line.words.reduce((n,w)=>n+w.x,0)/line.words.length;
      const mark=dayMarks.slice().sort((a,b)=>Math.abs(a.x-x)-Math.abs(b.x-x))[0];
      const desc=line.words.filter(w=>!parseTimes(w.text).length&&!inferDay(w.text)).map(w=>w.text).join(' ');
      const result=session(mark.day,pair.join(' - '),desc||'Imported class — please review');
      if(result)found.push(result);
    }
  }
  return dedupe(found);
}

function groupPdfItems(items) {
  const positioned=items.filter(x=>x.str?.trim()).map(x=>({text:x.str.trim(),x:x.transform?.[4]||0,y:x.transform?.[5]||0}));
  const lines=[];
  for(const item of positioned.sort((a,b)=>Math.abs(b.y-a.y)>2?b.y-a.y:a.x-b.x)){
    let line=lines.find(l=>Math.abs(l.y-item.y)<3);
    if(!line){line={y:item.y,items:[]};lines.push(line);}
    line.items.push(item);
  }
  return lines.sort((a,b)=>b.y-a.y).map(l=>l.items.sort((a,b)=>a.x-b.x).map(x=>x.text).join('   '));
}
function preprocessForOcr(source,scale=2) {
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  canvas.width=source.width*scale;canvas.height=source.height*scale;
  ctx.imageSmoothingEnabled=true;
  ctx.drawImage(source,0,0,canvas.width,canvas.height);
  const image=ctx.getImageData(0,0,canvas.width,canvas.height);
  for(let i=0;i<image.data.length;i+=4){
    const gray=0.2126*image.data[i]+0.7152*image.data[i+1]+0.0722*image.data[i+2];
    const value=gray<140?0:255;
    image.data[i]=value;image.data[i+1]=value;image.data[i+2]=value;image.data[i+3]=255;
  }
  ctx.putImageData(image,0,0);
  return canvas;
}
function isAnchorOcrWord(value='') {
  const text=String(value).trim();
  return Boolean(inferWeekday(text))||/\d{1,2}[:.]\d{2}/i.test(text)||/^(am|pm|noon|midnight)$/i.test(text);
}
function scaleOcrWords(words,scale=1) {
  return (words||[]).flatMap(word=>{
    const b=word.bbox;
    if(!b)return [];
    return [{...word,bbox:{x0:b.x0/scale,y0:b.y0/scale,x1:b.x1/scale,y1:b.y1/scale}}];
  });
}
function boxesOverlap(a,b) {
  if(!a||!b)return false;
  const width=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0));
  const height=Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
  const overlap=width*height;
  const areaA=Math.max(1,(a.x1-a.x0)*(a.y1-a.y0));
  const areaB=Math.max(1,(b.x1-b.x0)*(b.y1-b.y0));
  return overlap/Math.min(areaA,areaB)>0.3;
}
function mergeOcrWords(standardWords,enhancedWords) {
  const anchors=standardWords.filter(word=>isAnchorOcrWord(word.text));
  const enhancedBody=scaleOcrWords(enhancedWords,2).filter(word=>!isAnchorOcrWord(word.text));
  const standardBody=standardWords.filter(word=>!isAnchorOcrWord(word.text)&&word.bbox);
  const fallback=standardBody.filter(word=>!enhancedBody.some(candidate=>boxesOverlap(word.bbox,candidate.bbox)));
  return {anchorWords:anchors,words:[...enhancedBody,...fallback]};
}
async function recognizeTimetable(worker,source) {
  const standard=await worker.recognize(source);
  const enhancedCanvas=preprocessForOcr(source,2);
  let enhanced;
  try {
    await worker.setParameters({tessedit_pageseg_mode:'11'});
    enhanced=await worker.recognize(enhancedCanvas);
  } finally {
    await worker.setParameters({tessedit_pageseg_mode:'3'});
  }
  return {...mergeOcrWords(standard.data.words,enhanced.data.words),text:standard.data.text};
}
async function readPdf(file,onProgress) {
  const doc=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
  const {createWorker}=await import('tesseract.js');
  const worker=await createWorker('eng',1,{logger:m=>onProgress?.(`OCR ${Math.round((m.progress||0)*100)}%`)});
  const rows=[];
  try {
    for(let p=1;p<=doc.numPages;p++){
      const page=await doc.getPage(p),viewport=page.getViewport({scale:2});
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await page.render({canvasContext:ctx,viewport}).promise;
      const result=await recognizeTimetable(worker,canvas);
      const gridRows=parseGridTimetable({imageData:ctx.getImageData(0,0,canvas.width,canvas.height),width:canvas.width,height:canvas.height,words:result.words,anchorWords:result.anchorWords});
      rows.push(...(gridRows.length?gridRows:parseSpatialWords([...result.anchorWords,...result.words])));
      onProgress?.(`Reading timetable page ${p} of ${doc.numPages}`);
    }
  } finally { await worker.terminate(); }
  if(rows.length)return dedupe(rows);
  const textPages=[];
  for(let p=1;p<=doc.numPages;p++){
    const page=await doc.getPage(p),content=await page.getTextContent();
    textPages.push(groupPdfItems(content.items).join('\n'));
  }
  return parseText(textPages.join('\n'));
}
export async function extractTimetable(file,onProgress) {
  const name=file.name.toLowerCase();let rows=[];
  if(/\.(csv|xlsx|xls|ods)$/i.test(name)){
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});
    for(const sheetName of wb.SheetNames){
      const matrix=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:'',raw:false});
      rows.push(...parseMatrix(matrix));
    }
  }else if(name.endsWith('.odt')){
    const zip=await JSZip.loadAsync(file),xml=await zip.file('content.xml')?.async('text');
    if(!xml)throw new Error('This ODT file has no readable content.xml.');
    const doc=new DOMParser().parseFromString(xml,'text/xml');
    const tables=[...doc.getElementsByTagName('table:table')];
    for(const table of tables){
      const matrix=[...table.getElementsByTagName('table:table-row')].map(tr=>[...tr.getElementsByTagName('table:table-cell')].map(td=>td.textContent||''));
      rows.push(...parseMatrix(matrix));
    }
    if(!rows.length)rows=parseText(doc.documentElement.textContent||'');
  }else if(name.endsWith('.pdf')){
    {const pdfResult=await readPdf(file,onProgress);rows=Array.isArray(pdfResult)?pdfResult:parseText(pdfResult);}
  }else if(/\.(png|jpe?g|webp|bmp)$/i.test(name)){
    const {createWorker}=await import('tesseract.js');
    const worker=await createWorker('eng',1,{logger:m=>onProgress?.(`OCR ${Math.round((m.progress||0)*100)}%`)});
    try{
      const bitmap=await createImageBitmap(file);
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
      canvas.width=bitmap.width;canvas.height=bitmap.height;
      ctx.drawImage(bitmap,0,0);
      const result=await recognizeTimetable(worker,canvas);
      const gridRows=parseGridTimetable({imageData:ctx.getImageData(0,0,canvas.width,canvas.height),width:canvas.width,height:canvas.height,words:result.words,anchorWords:result.anchorWords});
      rows=gridRows.length?gridRows:parseSpatialWords([...result.anchorWords,...result.words]);
      if(!rows.length) rows=parseText(result.text);
      bitmap.close?.();
    }finally{await worker.terminate();}
  }else throw new Error('Supported formats: PDF, PNG, JPG, WEBP, CSV, XLSX, XLS, ODS and ODT.');
  rows=dedupe(rows);
  if(!rows.length)throw new Error('We could not identify class sessions in this file. Try a clearer scan or use the manual review/import option.');
  return rows;
}
