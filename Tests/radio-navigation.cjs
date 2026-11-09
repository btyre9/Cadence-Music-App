const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const template=fs.readFileSync('Resources/playback-navigation.js','utf8');
let endpoint,reset=0;
const app={dispatchEvent:event=>{endpoint=event.detail.endpoint;return true;}};
const context={window:{ytcfg:{}},document:{querySelector:s=>s==='ytmusic-app'?app:s==='#movie_player'?{getVideoData:()=>({video_id:'seed12345'})}:s==='video'?{set currentTime(v){reset++},play:()=>{}}:null},CustomEvent:class{constructor(type,args){Object.assign(this,args);}},encodeURIComponent};
function run(force){return vm.runInNewContext(template.replaceAll('VIDEO_ID',JSON.stringify('seed12345')).replaceAll('FORCE_RADIO',String(force)),context);}
assert.equal(run(false),true);assert.equal(reset,1);assert.equal(endpoint,undefined);
assert.equal(run(true),true);assert.equal(endpoint.watchEndpoint.videoId,'seed12345');assert.equal(endpoint.watchEndpoint.playlistId,'RDAMVMseed12345');
console.log('PASS: radio forces the song-based mix router even when the seed is already playing');
