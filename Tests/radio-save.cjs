const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class E{constructor(){this.children=[];this.textContent='';this.value='';this.open=false;this.classList={add(){},remove(){},toggle(){},contains(){return true;}};}append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}replaceWith(){}setAttribute(){}querySelector(){return null;}addEventListener(){}showModal(){this.open=true;}close(){this.open=false;}}
const elements=new Map(),calls=[];const c=vm.createContext({document:{getElementById:id=>{if(!elements.has(id))elements.set(id,new E());return elements.get(id);},createElement:()=>new E(),querySelectorAll:()=>[]},window:{webkit:{messageHandlers:{cadence:{postMessage:m=>calls.push(m)}}}},localStorage:{getItem:()=>null,setItem(){}},URL,setTimeout:()=>1,clearTimeout(){},clearNowRelease(){},updateNowRelease(){},stopSoundCloudTracking(){},attachSoundCloudTracking(){}});
vm.runInContext(fs.readFileSync('Resources/app.js','utf8'),c);vm.runInContext(fs.readFileSync('Resources/library-ui.js','utf8'),c);
vm.runInContext("radioMode=true;radioSeed={id:'seed12345',title:'My seed',artist:'Artist'};saveRadioPlaylist();",c);
const id=calls.at(-1).requestID;assert.equal(calls.at(-1).action,'radio-snapshot');
c.receiveRadioSnapshot({requestID:id,tracks:[{id:'seed12345',title:'My seed'},{id:'song12345',title:'Next one'},{id:'song23456',title:'Next two'},{id:'song12345',title:'Duplicate'}]});
assert.equal(vm.runInContext('radioSaveTracks.length',c),3);
const b=elements.get('library-dialog-content').children.find(e=>e.textContent==='Save playlist');b.onclick();b.onclick();
assert.equal(calls.at(-1).request.op,'create-radio-playlist');assert.equal(calls.at(-1).request.videoIds.length,3);assert.equal(calls.filter(m=>m.request?.op==='create-radio-playlist').length,1);
let rows=[{data:{videoId:'seed12345',title:{runs:[{text:'Seed'}]}}},{data:{playlistPanelVideoRenderer:{videoId:'song12345',title:{simpleText:'Other'}}}},{data:{videoId:'seed12345'}},{data:{videoId:'blocked123',isPlayable:false}}];
const snapshot=vm.runInNewContext(fs.readFileSync('Resources/radio-snapshot.js','utf8'),{document:{querySelector:()=>({querySelectorAll:()=>rows})}});
assert.equal(snapshot.tracks.length,2);assert.equal(snapshot.tracks[1].title,'Other');
console.log('PASS: station queue extraction, blocked/duplicate filtering, seed inclusion, preview, private playlist payload, and double-submit prevention');
