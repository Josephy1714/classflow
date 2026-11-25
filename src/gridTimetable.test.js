import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGridTimetable, inferWeekday} from './gridTimetable.js';

function fixture() {
  const width=400,height=400,data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<data.length;i+=4){data[i]=255;data[i+1]=255;data[i+2]=255;data[i+3]=255;}
  const fill=(x0,y0,x1,y1,value)=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*width+x)*4;data[i]=value;data[i+1]=value;data[i+2]=value;}};
  fill(120,80,200,160,240);fill(120,80,200,100,180);
  fill(200,120,280,200,240);fill(200,120,280,140,180);
  for(const x of [40,120,200,280,360])fill(x,40,x+2,322,0);
  for(const y of [40,80,120,160,200,240,280,320])fill(40,y,362,y+2,0);
  const word=(text,x0,y0,x1,y1)=>({text,confidence:99,bbox:{x0,y0,x1,y1}});
  const words=[
    word('Monday',145,50,175,62),word('Tuesday',220,50,260,62),
    word('8:00',58,74,82,86),word('am',84,74,98,86),
    word('9:00',58,154,82,166),word('am',84,154,98,166),
    word('10:00',54,234,84,246),word('am',86,234,100,246),
    word('SMA',130,84,157,96),word('3250',159,84,184,96),word('Lec',160,98,178,110),word('1',180,98,186,110),
    word('SYNC',135,108,160,120),word('ONLINE',162,108,190,120),word('Dr',140,128,151,140),word('Rao',153,128,177,140),
    word('SDS',210,124,230,136),word('3201',232,124,254,136),word('Lec',255,124,271,136),
    word('SOB',220,150,242,162),word('II',245,150,252,162)
  ];
  return {imageData:{data},width,height,words};
}

test('recognizes weekday names and abbreviations',()=>{
  assert.equal(inferWeekday('MONDAY'),'Monday');
  assert.equal(inferWeekday('Tue'),'Tuesday');
  assert.equal(inferWeekday('Thursday'),'Thursday');
  assert.equal(inferWeekday('Thurs'),'Thursday');
  assert.equal(inferWeekday('Weds'),'Wednesday');
  assert.equal(inferWeekday('Tues'),'Tuesday');
  assert.equal(inferWeekday('Sunday'),'Sunday');
  assert.equal(inferWeekday('Tuesday 8:00 am'), 'Tuesday');
  assert.equal(inferWeekday('Monument'), null);
});

test('reads merged timetable blocks using grid geometry and time-axis anchors',()=>{
  const rows=parseGridTimetable(fixture());
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(r=>({day:r.day,start:r.start,end:r.end,code:r.code})),[
    {day:0,start:'08:00',end:'09:00',code:'SMA 3250'},
    {day:1,start:'08:30',end:'09:30',code:'SDS 3201'}
  ]);
});
