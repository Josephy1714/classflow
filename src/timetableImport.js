import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const normalize = (s='') => String(s).toLowerCase().replace(/\s+/g,' ').trim();
const timeRe = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(am|pm)?\b/gi;
function parseTimePair(text) {
  const matches = [...String(text).matchAll(timeRe)].map(m => {
    let h=Number(m[1]), min=m[2], ap=(m[3]||'').toLowerCase();
    if(ap==='pm'&&h<12)h+=12; if(ap==='am'&&h===12)h=0;
    return `${String(h).padStart(2,'0')}:${min}`;
  });
  return matches.length>=2 ? [matches[0],matches[1]] : null;
}
function inferDay(text) { const t=normalize(text); return DAYS.find(d=>t.includes(d.toLowerCase())) || null; }
function mapRows(rows) {
  return rows.map((r) => {
    const get=(...keys)=>{for(const k of keys){const v=r[k]??r[Object.keys(r).find(x=>normalize(x)===normalize(k))];if(v!==undefined&&v!=='')return v;}return '';};
    const day=inferDay(get('day','weekday','date')) || inferDay(Object.values(r).join(' '));
    const pair=parseTimePair(`${get('time','time slot','start')} ${get('end','end time')}`) || [String(get('start','start time')||'').slice(0,5),String(get('end','end time')||'').slice(0,5)];
    const code=String(get('unit','unit code','course code','course','subject')||'Imported unit').trim();
    const title=String(get('unit name','course name','subject name')||code).trim();
    const venue=String(get('venue','room','location','classroom')||'TBC').trim();
    const type=String(get('type','session type')||'Lecture').trim();
    if(!day || !pair[0] || !pair[1]) return null;
    return {day:DAYS.indexOf(day),code,name:title,start:pair[0],end:pair[1],venue,type,confidence:'review'};
  }).filter(Boolean);
}
async function readPdf(file, onProgress) {
  const doc=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
  let text='';
  for(let p=1;p<=doc.numPages;p++){
    const page=await doc.getPage(p); const content=await page.getTextContent();
    text += '\n' + content.items.map(x=>x.str).join(' ');
    onProgress?.(`Reading PDF page ${p} of ${doc.numPages}`);
  }
  if(text.replace(/\s/g,'').length>80) return text;
  const { createWorker }=await import('tesseract.js');
  const worker=await createWorker('eng',1,{logger:m=>onProgress?.(`OCR ${Math.round((m.progress||0)*100)}%`)});
  try {
    let ocr='';
    for(let p=1;p<=doc.numPages;p++){
      const page=await doc.getPage(p); const viewport=page.getViewport({scale:1.8});
      const canvas=document.createElement('canvas'); const ctx=canvas.getContext('2d');
      canvas.width=viewport.width; canvas.height=viewport.height;
      await page.render({canvasContext:ctx,viewport}).promise;
      const result=await worker.recognize(canvas); ocr+='\n'+result.data.text;
    }
    return ocr;
  } finally { await worker.terminate(); }
}
function parseText(text) {
  const rows=[];
  const lines=String(text).split(/\n|\r/).map(x=>x.trim()).filter(Boolean);
  for(const line of lines){
    const day=inferDay(line), pair=parseTimePair(line);
    if(!day||!pair)continue;
    const times=[...line.matchAll(timeRe)].map(m=>m[0]);
    let rest=line.replace(new RegExp(times[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'),'').replace(new RegExp(times[1].replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'),'');
    rest=rest.replace(new RegExp(day,'i'),'').replace(/[|,;\t]+/g,' ').trim();
    const parts=rest.split(/\s{2,}|\s-\s/).map(x=>x.trim()).filter(Boolean);
    const code=parts[0]||'Imported unit';
    rows.push({day:DAYS.indexOf(day),code,name:parts[1]||code,start:pair[0],end:pair[1],venue:parts.slice(2).join(' ')||'TBC',type:'Lecture',confidence:'review'});
  }
  return rows;
}
export async function extractTimetable(file, onProgress) {
  const name=file.name.toLowerCase(); let rows=[];
  if(name.endsWith('.csv')||name.endsWith('.xlsx')||name.endsWith('.xls')||name.endsWith('.ods')){
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
    rows=mapRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''}));
  } else if(name.endsWith('.odt')) {
    const zip=await JSZip.loadAsync(file); const xml=await zip.file('content.xml')?.async('text');
    if(!xml) throw new Error('This ODT file has no readable content.xml.');
    const doc=new DOMParser().parseFromString(xml,'text/xml');
    rows=parseText(doc.documentElement.textContent||'');
  } else if(name.endsWith('.pdf')) {
    rows=parseText(await readPdf(file,onProgress));
  } else if(/\.(png|jpe?g|webp|bmp)$/i.test(name)) {
    const {createWorker}=await import('tesseract.js');
    const worker=await createWorker('eng',1,{logger:m=>onProgress?.(`OCR ${Math.round((m.progress||0)*100)}%`)});
    try { const result=await worker.recognize(file); rows=parseText(result.data.text); }
    finally { await worker.terminate(); }
  } else throw new Error('Supported formats: PDF, PNG, JPG, WEBP, CSV, XLSX, XLS, ODS and ODT.');
  if(!rows.length) throw new Error('We could not confidently detect timetable rows. Try a clearer file or enter sessions manually.');
  return rows;
}