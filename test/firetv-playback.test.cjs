const {test}=require('node:test');
const assert=require('node:assert/strict');
const F=require('../platforms/firetv/playback.js');
const C=require('../webos/app/core.js');
const caps={videos:[{codec:'h264',width:1920,height:1080,bitDepth:8,frameRate:60,bitrate:40000000,level:42},{codec:'hevc',width:3840,height:2160,bitDepth:10,frameRate:30,bitrate:60000000}],audio:['aac','mp3','ac3'],maxAudioChannels:6};
const source={Id:'source',MediaStreams:[{Type:'Video',Codec:'hevc',VideoRangeType:'SDR',BitDepth:10,Index:0},{Type:'Audio',Codec:'aac',Index:3},{Type:'Audio',Codec:'ac3',Index:8},{Type:'Subtitle',Codec:'ass',Index:15},{Type:'Subtitle',Codec:'srt',IsExternal:true,Index:22}]};
test('Fire TV direct-play policy requires a detected decoder and excludes HDR or unsupported subtitles',()=>{
 assert.equal(F.policy(source,{native:true},15,caps).native,true);
 assert.equal(F.policy(source,{native:false},15,caps).native,false);
 assert.equal(F.policy(source,{native:true},22,caps).native,false);
 assert.equal(F.policy(source,{native:true},-1,{}).native,false);
 const hdr=structuredClone(source);hdr.MediaStreams[0].VideoRangeType='HDR10';
 assert.equal(F.policy(hdr,{native:true},-1,caps).native,false);
 delete hdr.MediaStreams[0].VideoRangeType;
 assert.equal(F.policy(hdr,{native:true},-1,caps).native,false);
});
test('Fire TV profile advertises only detected codecs, bounded resolution and output channels with subtitle burn-in fallback',()=>{
 const p=F.profile(caps,C.profile());
 assert.equal(p.DirectPlayProfiles[0].VideoCodec,'h264,hevc');
 assert.equal(p.DirectPlayProfiles[0].AudioCodec,'aac,mp3,ac3');
 assert.ok(!JSON.stringify(p).includes('dts'));
 const hevc=p.CodecProfiles.find(c=>c.Codec==='hevc');
 assert.ok(hevc.Conditions.some(c=>c.Property==='Width'&&c.Value==='3840'));
 assert.ok(hevc.Conditions.some(c=>c.Property==='VideoRangeType'&&c.Value==='SDR'));
 assert.equal(p.TranscodingProfiles[0].MaxAudioChannels,'6');
 assert.ok(p.SubtitleProfiles.some(s=>s.Format==='ass'&&s.Method==='Embed'));
 assert.ok(p.SubtitleProfiles.some(s=>s.Format==='ass'&&s.Method==='Encode'));
 assert.equal(F.profile({...caps,audio:['aac'],maxAudioChannels:2},C.profile()).TranscodingProfiles[0].MaxAudioChannels,'2');
});
test('Native track selection converts server indices to embedded stream ordinals and disables native subtitles for web cues or transcoding',()=>{
 const selected={method:'DirectPlay',source:{Id:'source'}};
 assert.deepEqual(F.tracks(selected,source,8,15,null,true),{audio:1,subtitle:0});
 assert.deepEqual(F.tracks(selected,source,3,15,[],true),{audio:0,subtitle:-1});
 assert.deepEqual(F.tracks({...selected,method:'Transcode'},source,8,15,null,true),{audio:-1,subtitle:-1});
 assert.deepEqual(F.tracks(selected,source,3,-1,null,true),{audio:0,subtitle:-1});
 assert.deepEqual(F.tracks({...selected,source:{Id:'changed'}},source,3,15,null,true),{unavailable:true});
});
