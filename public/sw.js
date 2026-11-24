const CACHE='classflow-shell-v1';
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE));});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{await self.clients.claim();const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));})());});
self.addEventListener('push',event=>{
  let data={title:'CLASSFLOW',body:'You have an academic reminder.',url:'/'};
  try{data={...data,...event.data.json()}}catch{}
  event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/icons/icon-192.svg',badge:'/icons/badge.svg',tag:data.tag||'classflow-reminder',renotify:false,data:{url:data.url||'/',sessionId:data.sessionId||null},vibrate:[120,60,120]}));
});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const url=event.notification.data?.url||'/';const windows=await clients.matchAll({type:'window',includeUncontrolled:true});for(const client of windows){if('focus'in client){await client.focus();client.postMessage({type:'CLASSFLOW_ATTENDANCE',sessionId:event.notification.data?.sessionId,url});return;}}if(clients.openWindow){const target=new URL(url,self.location.origin);if(event.notification.data?.sessionId)target.searchParams.set('attendance',event.notification.data.sessionId);await clients.openWindow(target.toString());}})());});