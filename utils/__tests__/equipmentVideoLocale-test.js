import { equipmentVideoForLocale, equipmentExtensionsForLocale, mergeEquipmentCatalog } from '../equipmentCatalog';
import { Platform } from 'react-native';
jest.mock('../api', () => ({resolveApiAssetUrl:value=>value}));
let originalOS;
beforeEach(() => { originalOS = Platform.OS; Platform.OS = 'web'; });
afterEach(() => { Platform.OS = originalOS; });

test('additional videos preserve append order and never fall back across languages', () => {
 const item = { additionalVideos: [{ id: 'one', titleZh: '一', titleEn: 'One', videoUrlZh: 'zh1.mp4', videoUrlEn: '' }, { id: 'two', titleZh: '二', titleEn: 'Two', videoUrlZh: 'zh2.mp4', videoUrlEn: 'en2.mp4' }], teachingSections: [{ id: 'home', titleZh: '家居', titleEn: 'Home', bodyZh: '在家練習', bodyEn: 'At home' }] };
 expect(equipmentExtensionsForLocale(item, 'zh').additionalVideos.map(video => video.id)).toEqual(['one', 'two']);
 expect(equipmentExtensionsForLocale(item, 'en').additionalVideos).toEqual([{ id: 'two', title: 'Two', videoUrl: 'en2.mp4' }]);
 expect(equipmentExtensionsForLocale(item, 'en').teachingSections).toEqual([{ id: 'home', title: 'Home', body: 'At home' }]);
 expect(mergeEquipmentCatalog([{ id: 0, name: 'Original' }], [{ id: '0', isActive: true, ...item }], 'en')[0].additionalVideos).toEqual(equipmentExtensionsForLocale(item, 'en').additionalVideos);
});

test('Chinese and English select independent uploaded video resources',()=>{
	const item={videoLocalesEnabled:true,videoUrlZh:'/api/media/zh/zh.mp4',videoUrlEn:'/api/media/en/en.mp4',videoUrl:'https://legacy/shared.mp4',youtubeKey:'abcdefghijk'};
	expect(equipmentVideoForLocale(item,'zh')).toEqual({videoUrl:item.videoUrlZh,youtubeKey:''});
	expect(equipmentVideoForLocale(item,'en')).toEqual({videoUrl:item.videoUrlEn,youtubeKey:''});
});
test('clearing a localized language never plays a different language or legacy YouTube',()=>{
	for(const item of [{videoLocalesEnabled:true,videoUrlZh:'/api/media/zh/zh.mp4'},{videoLocalesEnabled:true}]) expect(equipmentVideoForLocale({...item,videoUrl:'https://legacy/shared.mp4',youtubeKey:'abcdefghijk'},'en','baseyoutube')).toEqual({videoUrl:'',youtubeKey:''});
});
test('untouched historical shared video and YouTube continue to work',()=>{
	expect(equipmentVideoForLocale({videoUrl:'https://legacy/shared.mp4',videoUrlZh:'',videoUrlEn:'',videoLocalesEnabled:false},'en','abcdefghijk')).toEqual({videoUrl:'https://legacy/shared.mp4',youtubeKey:'abcdefghijk'});
});
test('catalog merge applies the same language rules to built-in and custom equipment',()=>{
	const videos={videoLocalesEnabled:true,videoUrlZh:'/api/media/zh/zh.mp4',videoUrlEn:'/api/media/en/en.mp4'};
	const items=mergeEquipmentCatalog([{id:0,name:'Built in',youtubeKey:'abcdefghijk'}],[{id:'0',...videos},{id:'custom-x',isCustom:true,nameEn:'Custom',...videos}],'en');
	expect(items).toHaveLength(2);for(const item of items){expect(item.videoUrl).toBe(videos.videoUrlEn);expect(item.youtubeKey).toBe('');}
});

test('web quality renditions retain each language original learning identity without crossing languages', () => {
 const source = { id: '0', videoLocalesEnabled: true, videoUrlZh: '/api/media/zh/original.mov', videoUrlEn: '/api/media/en/original.mp4', videoPlaybackUrlZh: '/api/media/zh/hash.mp4', videoPlaybackUrlEn: 'https://cdn.example/api/media/en/hash.mp4', videoIdentityUrlZh: '/api/media/zh/original.mov', videoIdentityUrlEn: '/api/media/en/original.mp4' };
 expect(equipmentVideoForLocale(source, 'zh')).toEqual({ videoUrl: source.videoPlaybackUrlZh, youtubeKey: '', videoIdentityUrl: source.videoIdentityUrlZh });
 expect(equipmentVideoForLocale(source, 'en').videoIdentityUrl).toBe(source.videoIdentityUrlEn);
 expect(mergeEquipmentCatalog([{ id: 0, name: 'Item' }], [source], 'zh')[0].videoIdentityUrl).toBe(source.videoIdentityUrlZh);
 expect(equipmentVideoForLocale({ ...source, videoUrlEn: '' }, 'en')).toEqual({ videoUrl: '', youtubeKey: '' });
});

test('native uses original files and duration while web uses additive playback fields for main and additional clips', () => {
 const source = { videoLocalesEnabled: true, videoUrlZh: '/api/media/zh/original.mp4', videoUrlEn: '', videoPlaybackUrlZh: '/api/media/zh/hash.mp4', videoPlaybackUrlEn: '/api/media/wrong/stale.mp4', videoIdentityDurationSecondsZh: 24.557875,
   additionalVideos: [{ id: 'extra', titleZh: '附加', videoUrlZh: '/api/media/extra/original.mp4', videoUrlEn: '', videoPlaybackUrlZh: '/api/media/extra/hash.mp4', videoPlaybackUrlEn: '/api/media/wrong/stale.mp4' }] };
 expect(equipmentVideoForLocale(source, 'zh')).toEqual({ videoUrl: source.videoPlaybackUrlZh, youtubeKey: '', videoIdentityUrl: source.videoUrlZh, videoIdentityDurationSeconds: 24.557875 });
 expect(equipmentVideoForLocale(source, 'en')).toEqual({ videoUrl: '', youtubeKey: '' });
 expect(equipmentExtensionsForLocale(source, 'zh').additionalVideos[0]).toEqual({ id: 'extra', title: '附加', videoUrl: '/api/media/extra/hash.mp4', videoIdentityUrl: '/api/media/extra/original.mp4' });
 expect(equipmentExtensionsForLocale(source, 'en').additionalVideos).toEqual([]);
 Platform.OS = 'android';
 expect(equipmentVideoForLocale(source, 'zh')).toEqual({ videoUrl: source.videoUrlZh, youtubeKey: '' });
 expect(equipmentExtensionsForLocale(source, 'zh').additionalVideos[0]).toEqual({ id: 'extra', title: '附加', videoUrl: '/api/media/extra/original.mp4' });
});
