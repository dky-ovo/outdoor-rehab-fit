import { equipmentVideoForLocale, mergeEquipmentCatalog } from '../equipmentCatalog';
jest.mock('../api', () => ({resolveApiAssetUrl:value=>value}));

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
