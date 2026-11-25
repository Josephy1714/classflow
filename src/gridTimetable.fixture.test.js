import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import jpeg from 'jpeg-js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import {parseGridTimetable,detectGrid} from './gridTimetable.js';


test('inspect selectable text in the uploaded PDF fixture',async()=>{
  const bytes=fs.readFileSync(new URL('../test-fixtures/timetable.pdf',import.meta.url));
  const doc=await pdfjsLib.getDocument({data:new Uint8Array(bytes)}).promise;
  const items=[];
  for(let pageNo=1;pageNo<=doc.numPages;pageNo++){
    const page=await doc.getPage(pageNo);
    const content=await page.getTextContent();
    items.push(...content.items.map(item=>item.str).filter(Boolean));
  }
  console.log('PDF selectable text:',items.join(' | '));
  assert.ok(doc.numPages>=1);
});

test('OCR reads the uploaded timetable and recovers its 11 class blocks',()=>{
  const file=new URL('../test-fixtures/IMG-20260906-WA0006(4).jpg',import.meta.url);
  const decoded=jpeg.decode(fs.readFileSync(file),{useTArray:true});
  const outputBase='/tmp/classflow-timetable-ocr';
  execFileSync('tesseract',[file.pathname,outputBase,'--psm','11','tsv'],{maxBuffer:8*1024*1024});
  const tsv=fs.readFileSync(outputBase+'.tsv','utf8');
  const words=tsv.split(/\r?\n/).slice(1).flatMap(line=>{
    const c=line.split('\t');
    if(c.length<12||c[0]!=='5'||!c[11]?.trim())return [];
    const x=Number(c[6]),y=Number(c[7]),w=Number(c[8]),h=Number(c[9]);
    return [{text:c[11],confidence:Number(c[10]),bbox:{x0:x,y0:y,x1:x+w,y1:y+h}}];
  });
  const rows=parseGridTimetable({imageData:decoded.data,width:decoded.width,height:decoded.height,words});
  console.log('OCR timetable rows:',JSON.stringify(rows));
  assert.equal(rows.length,11,JSON.stringify({tsv:tsv.slice(0,1200),words:words.length,rows},null,2));
  assert.deepEqual(rows.map(r=>[r.day,r.start,r.end]).sort((a,b)=>a[0]-b[0]||a[1].localeCompare(b[1])),[
    [0,'08:00','10:00'],[0,'10:00','12:00'],[0,'13:00','14:00'],
    [1,'08:00','10:00'],[1,'10:00','11:00'],[1,'13:00','14:00'],[1,'15:00','17:00'],
    [2,'08:00','10:00'],[3,'10:00','11:00'],[3,'13:00','14:00'],[4,'09:00','12:00']
  ]);
});

test('detects sessions in the uploaded real timetable grid geometry',()=>{
  const bytes=fs.readFileSync(new URL('../test-fixtures/IMG-20260906-WA0006(4).jpg',import.meta.url));
  const decoded=jpeg.decode(bytes,{useTArray:true});
  const words=[];
  const sx=decoded.width/1072,sy=decoded.height/1408;
  const addLine=(text,x,y)=>{
    let cursor=x;
    for(const token of text.split(/\s+/)){
      const width=Math.max(7,token.length*7);
      words.push({text:token,confidence:98,bbox:{x0:cursor*sx,y0:(y-6)*sy,x1:(cursor+width)*sx,y1:(y+6)*sy}});
      cursor+=width+4;
    }
  };
  const dayX=[277,443,609,774,940];
  ['Monday','Tuesday','Wednesday','Thursday','Friday'].forEach((day,i)=>addLine(day,dayX[i]-day.length*3.5,94));
  ['8:00 am','9:00 am','10:00 am','11:00 am','noon','1:00 pm','2:00 pm','3:00 pm','4:00 pm','5:00 pm']
    .forEach((time,i)=>addLine(time,72,[151,268,385,502,619,736,853,970,1087,1204][i]));
  const left=[195,360,526,692,857];
  const cell=(day,top,code,venue,lecturer='')=>{
    const x=left[day]+28;
    addLine(code,x,top+11);
    if(venue)addLine(venue,x+8,top+41);
    if(lecturer)addLine(lecturer,x+8,top+70);
  };
  cell(0,140,'SMA 3250 Lec 1','SYNC ONLINE','Dr Rao W O');
  cell(1,140,'SDS 3201 Lec 1','SOB II');
  cell(2,140,'SMA 3201A Lec 1','MH I','Dr Imagiri S K');
  cell(0,374,'SMA 3203A Lec 1','MH II','Dr Wafula A W');
  cell(1,374,'SMA 3250 Lec 1a','SJT','Dr Rao W O');
  cell(3,374,'SDS 3201 Lec 1a','SPS G39');
  cell(0,726,'SMA 3203A Lec 1a','MH II','Dr Wafula A W');
  cell(1,726,'STA 3201B Lec 1a','SYNC ONLINE',"Mrs Wang'ombe A W");
  cell(3,726,'SMA 3201A Lec 1a','MH II','Dr Imagiri S K');
  cell(1,960,'STA 3201B Lec 1','MH I',"Mrs Wang'ombe A W");
  cell(4,257,'SDS 3203 Lec 1','SYNC ONLINE');
  const grid=detectGrid(decoded.data,decoded.width,decoded.height);
  const diagnostic=parseGridTimetable({imageData:decoded.data,width:decoded.width,height:decoded.height,words,debug:true});
  const rows=diagnostic.rows;
  assert.equal(rows.length,11,JSON.stringify({...diagnostic,grid},null,2));
  assert.deepEqual(rows.map(r=>[r.day,r.start,r.end,r.code]).sort((a,b)=>a[0]-b[0]||a[1].localeCompare(b[1])),[
    [0,'08:00','10:00','SMA 3250'],
    [0,'10:00','12:00','SMA 3203A'],
    [0,'13:00','14:00','SMA 3203A'],
    [1,'08:00','10:00','SDS 3201'],
    [1,'10:00','11:00','SMA 3250'],
    [1,'13:00','14:00','STA 3201B'],
    [1,'15:00','17:00','STA 3201B'],
    [2,'08:00','10:00','SMA 3201A'],
    [3,'10:00','11:00','SDS 3201'],
    [3,'13:00','14:00','SMA 3201A'],
    [4,'09:00','12:00','SDS 3203']
  ]);
});
