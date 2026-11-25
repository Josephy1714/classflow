import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';

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
function inferDay(text) {
  const t=normalize(text);
  return DAYS.find(d => new RegExp('\\b'+d.toLowerCase()+'\\b').test(t)) || null;
}
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
async function readPdf(file,onProgress) {
  const doc=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
  let pages=[];
  for(let p=1;p<=doc.numPages;p++){
    const page=await doc.getPage(p), content=await page.getTextContent();
    pages.push(groupPdfItems(content.items).join('\n'));
    onProgress?.(`Reading PDF page ${p} of ${doc.numPages}`);
  }
  let text=pages.join('\n');
  if(text.replace(/\s/g,'').length>40) return text;
  const {createWorker}=await import('tesseract.js');
  const worker=await createWorker('eng',1,{logger:m=>onProgress?.(`OCR ${Math.round((m.progress||0)*100)}%`)});
  try{
    pages=[];
    for(let p=1;p<=doc.numPages;p++){
      const page=await doc.getPage(p), viewport=page.getViewport({scale:2});
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
      canvas.width=viewport.width;canvas.height=viewport.height;
      await page.render({canvasContext:ctx,viewport}).promise;
      const result=await worker.recognize(canvas);
      pages.push(result.data.text);
    }
    return pages.join('\n');
  }finally{await worker.terminate();}
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
    rows=parseText(await readPdf(file,onProgress));
  }else if(/\.(png|jpe?g|webp|bmp)$/i.test(name)){
    const {createWorker}=await import('tesseract.js');
    const worker=await createWorker('eng',1,{logger:m=>onProgress?.(`OCR ${Math.round((m.progress||0)*100)}%`)});
    try{
      const result=await worker.recognize(file);
      // Preserve OCR line boundaries; do not collapse the table into a paragraph.
      rows=parseText(result.data.text);
    }finally{await worker.terminate();}
  }else throw new Error('Supported formats: PDF, PNG, JPG, WEBP, CSV, XLSX, XLS, ODS and ODT.');
  rows=dedupe(rows);
  if(!rows.length)throw new Error('We could not identify class sessions in this file. Try a clearer scan or use the manual review/import option.');
  return rows;
}
