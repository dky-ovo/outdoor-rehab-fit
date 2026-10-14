// Independently hash the final deployment videos and their preserved sources.
// A temporary UUID mirror contains hard links, never altered source bytes.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'workspace-artifacts/video-capacity-20261003-v14');
const read = name => JSON.parse(fs.readFileSync(path.join(OUT, name), 'utf8'));
(async () => {
  const { createPublicVideoDelivery, parsePublicVideoManifest } = await import(pathToFileURL(path.join(ROOT, 'server/src/publicVideoDelivery.js')).href);
  const manifest = read('manifest.json'), plan = read('plan.json'), browser = read('source-playback-durations.json');
  const parsed = parsePublicVideoManifest(manifest);
  if (parsed.length !== 54 || parsed.length !== manifest.entries.length || !browser.complete || browser.derivativeMetadataCount !== 54) throw new Error('FINAL_MEDIA_QA_INCOMPLETE');
  const mirror = fs.mkdtempSync(path.join(os.tmpdir(), 'video-delivery-source-check-'));
  try {
    for (const entry of parsed) {
      const source = plan.entries.find(row => row.sourceSha256 === entry.sourceSha256);
      if (!source || !/^[a-f0-9-]+\.(?:mp4|mov|webm)$/.test(entry.sourceStorageName)) throw new Error('SOURCE_PLAN_MISMATCH');
      const original = path.resolve(ROOT, source.sourceLocalPath);
      if (!original.startsWith(ROOT + path.sep) || fs.lstatSync(original).isSymbolicLink()) throw new Error('UNSAFE_SOURCE_PLAN');
      try { fs.linkSync(original, path.join(mirror, entry.sourceStorageName)); }
      catch(error) { if(error.code !== 'EXDEV') throw error;fs.copyFileSync(original, path.join(mirror, entry.sourceStorageName), fs.constants.COPYFILE_EXCL); }
    }
    const delivery = createPublicVideoDelivery({ storageRoot: mirror, derivativeRoot: path.join(OUT, 'derivatives'), manifestPath: path.join(OUT, 'manifest.json') });
    if (!delivery.enabled) throw new Error('FINAL_DELIVERY_DISABLED');
    let sourcesChecked=0, derivativesChecked=0, privateGuards=0, identityChecks=0;
    for (const entry of parsed) {
      const row={id:entry.sourceMediaId,url:entry.sourcePublicPath,storage_name:entry.sourceStorageName,sha256:entry.sourceSha256,size_bytes:entry.sourceSizeBytes,kind:'video',source:'upload',archived:0,deleted_at:null};
      const selected = delivery.rendition(row), measured = browser.entries.find(value => value.sourceSha256 === row.sha256);
      if (!selected || selected.sizeBytes !== entry.derivativeSizeBytes || selected.sourceDurationSeconds !== measured.sourcePlaybackDurationSeconds || measured.derivativeSha256 !== entry.derivativeSha256 || !Number.isFinite(measured.derivativeMetadata?.durationSeconds)) throw new Error('DELIVERY_OR_BROWSER_IDENTITY_MISMATCH');
      const mapped = delivery.mapEquipment({id:entry.equipmentId,videoUrl:row.url,additionalVideos:[]},new Map([[row.id,row]]));
      if (mapped.videoUrl !== row.url || mapped.videoIdentityUrl !== row.url || mapped.videoPlaybackUrl !== selected.localUrl || mapped.videoIdentityDurationSeconds !== measured.sourcePlaybackDurationSeconds) throw new Error('ADDITIVE_PLAYBACK_CONTRACT_MISMATCH');
      for (const change of [{kind:'file'},{deleted_at:'2026-10-03'},{archived:1}]) if (delivery.rendition({...row,...change}) !== null) throw new Error('PRIVATE_OR_DELETED_DERIVATIVE_ALLOWED');
      sourcesChecked++;derivativesChecked++;privateGuards+=3;identityChecks++;
    }
    const result={observedAtUTC:new Date().toISOString(),complete:true,productionRequests:0,parsedEntries:parsed.length,sourceHashesVerified:sourcesChecked,derivativeHashesVerified:derivativesChecked,privateOrDeletedOrArchiveGuards:privateGuards,originalUrlAndCanonicalDurationChecks:identityChecks,
      sourceBrowserMetadataCount:browser.entries.length,derivativeBrowserMetadataCount:browser.derivativeMetadataCount,originalProductionDurationComparisons:browser.originalProductionComparisons,
      derivativeBrowserMaximumDurationDifferenceSeconds:Math.max(...browser.entries.map(entry=>entry.playbackDurationDifferenceSeconds)),
      nominal50WorstMbps:Math.max(...parsed.map(entry=>entry.totalBitrateMbps))*50,nominalBitrateExcludesProtocolAndPageOverhead:true};
    fs.writeFileSync(path.join(OUT,'delivery-manifest-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  } finally {
    if (!path.resolve(mirror).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(mirror).startsWith('video-delivery-source-check-')) throw new Error('UNSAFE_TEMP_CLEANUP');
    fs.rmSync(mirror,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
