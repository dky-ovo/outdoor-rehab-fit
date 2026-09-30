import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from '../src/database.js';
import { applyEducationVideoSeed, EDUCATION_VIDEO_IMPORT_ID } from '../src/educationVideoImport.js';
import { EDUCATION_VIDEO_CODES, equipmentIdForVideoCode } from '../src/educationVideoCodes.js';

function fixture(run) {
	const database = createDatabase(':memory:'), now = new Date().toISOString(), items = [];
	for (const code of EDUCATION_VIDEO_CODES.filter((value) => !['13', '27'].includes(value))) for (const locale of ['zh', 'en']) {
		const equipmentId = equipmentIdForVideoCode(code), id = `file-${equipmentId}-${locale}`, url = `/api/media/${id}/${id}.mp4`, sha256 = `${equipmentId}-${locale}`;
		database.prepare("INSERT INTO media_files(id,url,name,mime_type,kind,category_id,source,sha256,created_at,updated_at) VALUES(?,?,?,'video/mp4','video','videos','upload',?,?,?)").run(id,url,`${code}.mp4`,sha256,now,now);
		items.push({ id,url,name:`${code}.mp4`,kind:'video',equipmentId,locale,sha256,archived:false,deleted:false });
	}
	try { run(database, {importId:EDUCATION_VIDEO_IMPORT_ID,complete:true,items}); } finally {database.close();}
}

test('all 27 code pairs bind by document identities, not arithmetic offsets, without touching descriptions or missing video codes',()=>fixture((db,report)=>{
	db.prepare("UPDATE app_equipment_items SET video_url='https://legacy/old.mp4',youtube_key='abcdefghijk',details_zh='Keep existing text'").run();
	const result=applyEducationVideoSeed(db,report); assert.equal(result.facilities,27);assert.equal(result.videos,54);
	for(const item of report.items){const row=db.prepare('SELECT * FROM app_equipment_items WHERE id=?').get(item.equipmentId);assert.equal(row[`video_url_${item.locale}`],item.url);assert.equal(row.details_zh,'Keep existing text');assert.equal(row.youtube_key,'abcdefghijk');}
	for(const code of ['13','27']) assert.equal(db.prepare('SELECT video_localized FROM app_equipment_items WHERE id=?').get(equipmentIdForVideoCode(code)).video_localized,0);
	assert.equal(equipmentIdForVideoCode('5b'),'5');assert.equal(equipmentIdForVideoCode('10b'),'12');assert.equal(equipmentIdForVideoCode('22'),'23');
}));

test('restart does not overwrite subsequent administrator edits, even if an imported folder was deleted',()=>fixture((db,report)=>{
	applyEducationVideoSeed(db,report);db.prepare("UPDATE app_equipment_items SET video_url_en='',video_url_zh='https://replacement/new.mp4' WHERE id='0'").run();
	assert.equal(applyEducationVideoSeed(db,{...report,complete:false,errors:[{error:'deleted folder'}]}).status,'already_applied');
	assert.equal(db.prepare("SELECT video_url_en FROM app_equipment_items WHERE id='0'").get().video_url_en,'');
}));

test('incomplete, duplicate and mismatched code batches never partially change video references',()=>{
	for(const change of [r=>({...r,complete:false}),r=>({...r,items:r.items.slice(1)}),r=>({...r,items:[r.items[0],...r.items.slice(0,-1)]}),r=>({...r,items:r.items.map((item,i)=>i===0?{...item,name:'5b.mp4'}:item)})]) fixture((db,report)=>{
		assert.throws(()=>applyEducationVideoSeed(db,change(report)));
		assert.equal(db.prepare('SELECT COUNT(*) AS n FROM app_equipment_items WHERE video_localized=1').get().n,0);
		assert.equal(db.prepare('SELECT COUNT(*) AS n FROM media_seed_video_bindings').get().n,0);
	});
});

test('deleted or archived imported videos fail closed; deleted facilities are never restored',()=>{
	for(const column of ['deleted_at','archived']) fixture((db,report)=>{db.prepare(`UPDATE media_files SET ${column}=? WHERE id=?`).run(column==='archived'?1:'2026-09-10',report.items[0].id);assert.throws(()=>applyEducationVideoSeed(db,report));});
	fixture((db,report)=>{db.prepare("UPDATE app_equipment_items SET deleted_at='2026-09-10',is_active=0 WHERE id='0'").run();const result=applyEducationVideoSeed(db,report);assert.equal(result.facilities,26);assert.deepEqual(result.skipped,['0']);assert.equal(db.prepare("SELECT video_localized FROM app_equipment_items WHERE id='0'").get().video_localized,0);});
});

test('unrelated seed batches never mutate teaching videos',()=>fixture((db,report)=>{assert.equal(applyEducationVideoSeed(db,{...report,importId:'other-batch'}),null);}));
