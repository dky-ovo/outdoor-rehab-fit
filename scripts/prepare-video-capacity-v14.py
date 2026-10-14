"""Prepare public teaching-video derivatives locally; never fetch or replace media.

Requires an existing FFmpeg binary. Defaults to one child process and two threads.
Create STOP-ENCODING in the output directory to stop before a browser load test.
"""
import argparse
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "workspace-artifacts/video-capacity-20261003-v14"
PUBLIC_VIDEO = re.compile(r"^/api/media/([a-f0-9-]{36})/([a-f0-9-]{36}\.mp4)$", re.I)
HASH_NAME = re.compile(r"^[a-f0-9]{64}\.mp4$")
SETTINGS = {"videoBitrate": 1250000, "maxVideoBitrate": 1350000, "videoBuffer": 2500000,
            "audioBitrate": 96000, "maximumTotalBitrateMbps": 1.5, "threads": 2,
            "preset": "medium", "durationToleranceSeconds": 0.1}


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def relative(path):
    return path.resolve().relative_to(ROOT).as_posix()


def save(path, value):
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def ffmpeg_path(value):
    if value:
        result = Path(value)
    elif shutil.which("ffmpeg"):
        result = Path(shutil.which("ffmpeg"))
    else:
        import imageio_ffmpeg
        result = Path(imageio_ffmpeg.get_ffmpeg_exe())
    if not result.is_file():
        raise ValueError("An existing local FFmpeg binary is required")
    return result.resolve()


class Runner:
    def __init__(self, executable, output):
        self.executable, self.output = str(executable), output

    def run(self, args, timeout=600):
        if (self.output / "STOP-ENCODING").exists():
            raise InterruptedError("STOP-ENCODING requested")
        flags = (subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS) if os.name == "nt" else 0
        child = subprocess.Popen([self.executable, "-nostdin", *map(str, args)], stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=flags)
        started = time.monotonic()
        try:
            while True:
                try:
                    out, err = child.communicate(timeout=1)
                    break
                except subprocess.TimeoutExpired:
                    if (self.output / "STOP-ENCODING").exists():
                        raise InterruptedError("STOP-ENCODING requested")
                    if time.monotonic()-started > timeout:
                        raise TimeoutError("Local FFmpeg time limit exceeded")
        except BaseException:
            child.terminate()
            try:
                child.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.communicate()
            raise
        text = (out + err).decode("utf-8", "replace")
        if child.returncode:
            raise RuntimeError("FFmpeg failed: " + text[-2500:])
        return text

    def probe(self, path):
        text = self.run(["-hide_banner", "-threads", 2, "-i", path, "-map", "0:v:0", "-map", "0:a:0",
                         "-t", 0, "-f", "null", os.devnull])
        video = re.search(r"Video:\s+(\w+)[^\r\n]*?\b(\d{2,5})x(\d{2,5})\b", text)
        audio = re.search(r"Audio:\s+(\w+)[^\r\n]*", text)
        if not video or not audio:
            raise ValueError("Expected one video and audio stream")
        audio_rate = re.search(r"(\d+)\s+kb/s", audio.group(0))
        info = mp4_info(path)
        return {"videoCodec": video.group(1), "audioCodec": audio.group(1),
                "width": int(video.group(2)), "height": int(video.group(3)),
                "audioBitrateKbps": int(audio_rate.group(1)) if audio_rate else None,
                **info, "totalBitrateMbps": path.stat().st_size*8/info["durationSeconds"]/1e6}

    def decode(self, path):
        self.run(["-hide_banner", "-v", "error", "-xerror", "-threads", 2, "-i", path,
                  "-map", "0:v:0", "-map", "0:a:0", "-f", "null", os.devnull])

    def frame(self, path, output, seconds, width, height):
        self.run(["-hide_banner", "-v", "error", "-threads", 2, "-ss", seconds, "-i", path,
                  "-frames:v", 1, "-filter_threads", 1, "-vf", f"scale={width}:{height}:flags=lanczos",
                  "-n", output])


def mp4_info(path):
    """Read top-level boxes and movie duration without reading compressed payloads."""
    boxes, moov = [], None
    with path.open("rb") as f:
        size, position = path.stat().st_size, 0
        while position+8 <= size:
            f.seek(position)
            length, kind = struct.unpack(">I4s", f.read(8))
            header = 8
            if length == 1:
                length, header = struct.unpack(">Q", f.read(8))[0], 16
            if length == 0:
                length = size-position
            if length < header or position+length > size:
                raise ValueError("Invalid MP4 box")
            boxes.append(kind)
            if kind == b"moov":
                if length-header > 32*1024*1024:
                    raise ValueError("Unexpectedly large movie metadata")
                moov = f.read(length-header)
            position += length
    if b"moov" not in boxes or b"mdat" not in boxes or moov is None:
        raise ValueError("Expected MP4 movie and media boxes")
    duration, position = None, 0
    while position+8 <= len(moov):
        length, kind = struct.unpack(">I4s", moov[position:position+8])
        if length < 8 or position+length > len(moov):
            raise ValueError("Invalid MP4 metadata child")
        if kind == b"mvhd":
            value = moov[position+8:position+length]
            if value[0] == 0:
                scale, ticks = struct.unpack(">II", value[12:20])
            elif value[0] == 1:
                scale, ticks = struct.unpack(">IQ", value[20:32])
            else:
                raise ValueError("Unsupported movie header")
            duration = ticks/scale if scale else None
            break
        position += length
    if duration is None or not math.isfinite(duration) or duration <= 0:
        raise ValueError("Missing finite movie duration")
    return {"durationSeconds": duration, "fastStart": boxes.index(b"moov") < boxes.index(b"mdat")}


def dimensions(width, height):
    bounds = (1280, 720) if width >= height else (720, 1280)
    factor = min(1, bounds[0]/width, bounds[1]/height)
    return max(2, math.floor(width*factor/2)*2), max(2, math.floor(height*factor/2)*2)


def plan(seed, catalog):
    value = json.loads((seed / "manifest.json").read_text(encoding="utf-8"))
    published = {str(row["id"]): row for row in json.loads(catalog.read_text(encoding="utf-8"))["items"]
                 if row.get("isActive") is not False and not row.get("deletedAt")}
    output = []
    for item in value["items"]:
        if item.get("mimeType") != "video/mp4" or item.get("archiveOnly") or item.get("archived"):
            continue
        if item.get("locale") not in ("zh", "en") or not item.get("code") or not HASH_NAME.fullmatch(item.get("fileName", "")):
            continue
        equipment = published.get(str(item.get("equipmentId")))
        url = equipment.get("videoUrlZh" if item["locale"] == "zh" else "videoUrlEn", "") if equipment else ""
        match = PUBLIC_VIDEO.fullmatch(url)
        if not match:
            continue
        source = seed / "files" / item["fileName"]
        if source.is_symlink() or not source.is_file() or source.stat().st_size != item["size"] or digest(source) != item["sha256"]:
            raise ValueError("Seed hash/size or file type mismatch")
        output.append({"code": item["code"], "equipmentId": str(item["equipmentId"]), "locale": item["locale"],
                       "sourceMediaId": match.group(1), "sourceStorageName": match.group(2), "sourcePublicPath": url,
                       "sourceLocalPath": relative(source), "sourceSha256": item["sha256"],
                       "sourceSizeBytes": item["size"], "sourceDurationSeconds": mp4_info(source)["durationSeconds"],
                       "sourceManifestDurationSeconds": item["mediaInfo"]["durationSeconds"],
                       "sourceFullDecodePreviouslyPassed": item["mediaInfo"].get("fullDecodePassed") is True})
    if not output or len({(row["equipmentId"], row["locale"]) for row in output}) != len(output) or len({row["sourceSha256"] for row in output}) != len(output):
        raise ValueError("Empty or duplicate public-video mapping")
    return output


def encode(runner, source, output, info):
    width, height = dimensions(info["width"], info["height"])
    temporary = output / "derivatives" / ("partial-" + uuid.uuid4().hex + ".mp4")
    passlog = output / "work" / uuid.uuid4().hex
    common = ["-hide_banner", "-v", "warning", "-threads", 2, "-i", source, "-map", "0:v:0",
              "-filter_threads", 1, "-vf", f"scale={width}:{height}:flags=lanczos", "-c:v", "libx264",
              "-preset", SETTINGS["preset"], "-profile:v", "high", "-pix_fmt", "yuv420p", "-threads", 2,
              "-b:v", SETTINGS["videoBitrate"], "-maxrate", SETTINGS["maxVideoBitrate"], "-bufsize", SETTINGS["videoBuffer"],
              "-passlogfile", passlog, "-map_metadata", "-1", "-sn", "-dn"]
    try:
        runner.run([*common, "-pass", 1, "-an", "-f", "null", os.devnull])
        audio_copy = info["audioCodec"] == "aac" and info["audioBitrateKbps"] is not None and info["audioBitrateKbps"] <= 128
        audio = ["-c:a", "copy"] if audio_copy else ["-c:a", "aac", "-b:a", SETTINGS["audioBitrate"]]
        runner.run([*common, "-pass", 2, "-map", "0:a:0", *audio, "-movflags", "+faststart", "-n", temporary])
        return temporary, "aac-copy" if audio_copy else "aac-96kbps"
    except BaseException:
        if temporary.exists():
            temporary.unlink()
        raise
    finally:
        # Only this invocation's uniquely named logs inside its own work folder.
        for file in passlog.parent.glob(passlog.name + "*"):
            if file.is_file() and not file.is_symlink():
                file.unlink()


def quality(runner, source, derivative, info):
    width, height = info["width"], info["height"]
    text = runner.run(["-hide_banner", "-threads", 2, "-i", source, "-threads", 2, "-i", derivative,
                       "-filter_complex_threads", 1, "-lavfi",
                       f"[0:v:0]scale={width}:{height}:flags=lanczos,setpts=PTS-STARTPTS[s];[1:v:0]setpts=PTS-STARTPTS[d];[s][d]ssim",
                       "-an", "-f", "null", os.devnull])
    match = re.search(r"SSIM[^\r\n]*\bAll:([0-9.]+)", text)
    if not match:
        raise ValueError("SSIM comparison was not measured")
    return float(match.group(1))


def visual_frames(runner, source, derivative, output, entry):
    frames = []
    for fraction in (0.5, 0.8):
        seconds = round(entry["durationSeconds"]*fraction, 3)
        stem = f"{entry['code']}-{entry['locale']}-{int(fraction*100)}"
        a, b = output / "qa/frames" / (stem + "-original.png"), output / "qa/frames" / (stem + "-optimized.png")
        for path, target in ((source, a), (derivative, b)):
            if not target.exists():
                runner.frame(path, target, seconds, entry["width"], entry["height"])
        frames.append({"seconds": seconds, "original": relative(a), "optimized": relative(b)})
    return frames


def contacts(output, entries):
    from PIL import Image, ImageDraw, ImageFont
    records = [(entry, pair) for entry in entries for pair in entry.get("visualFrames", [])]
    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 20) if os.name == "nt" else ImageFont.load_default()
    generated = []
    for offset in range(0, len(records), 5):
        group = records[offset:offset+5]
        sheet = Image.new("RGB", (1300, 55+len(group)*390), "#fff")
        draw = ImageDraw.Draw(sheet)
        draw.text((10, 10), "Original at output size (left) | Optimized (right)", font=font, fill="#111")
        for index, (entry, pair) in enumerate(group):
            y = 50+index*390
            for x, key in ((10, "original"), (655, "optimized")):
                image = Image.open(ROOT / pair[key]).convert("RGB")
                image.thumbnail((635, 355), Image.Resampling.LANCZOS)
                sheet.paste(image, (x+(635-image.width)//2, y))
            draw.text((10, y+358), f"{entry['code']} {entry['locale'].upper()} | {pair['seconds']} s | {entry['totalBitrateMbps']:.3f} Mbps | SSIM {entry['ssimAtOutputSize']:.4f}", font=font, fill="#111")
        target = output / "qa" / f"contact-{offset//5+1:02d}.jpg"
        sheet.save(target, quality=95)
        generated.append(relative(target))
    return generated


def finalize(output, planned, review_path):
    """Merge measured browser identity and explicitly recorded visual reviews."""
    manifest_path = output / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    durations = json.loads((output / "source-playback-durations.json").read_text(encoding="utf-8"))
    review = json.loads(review_path.read_text(encoding="utf-8"))
    plans = {row["sourceSha256"]: row for row in planned}
    measured = {row["sourceSha256"]: row for row in durations.get("entries", [])}
    reviewed = {row["sourceSha256"]: row for row in review.get("entries", [])}
    entries = manifest.get("entries", [])
    if (manifest.get("complete") is not True or durations.get("complete") is not True
            or len(entries) != len(plans) or {row["sourceSha256"] for row in entries} != set(plans)
            or len(measured) != len(durations.get("entries", [])) or len(reviewed) != len(review.get("entries", []))):
        raise ValueError("Complete unique derivative/browser/review evidence is required")
    for entry in entries:
        sha = entry["sourceSha256"]
        candidate, observation = reviewed.get(sha, {}), measured.get(sha, {})
        playback = observation.get("sourcePlaybackDurationSeconds")
        if (candidate.get("passed") is not True or not candidate.get("reviewer") or not candidate.get("reviewedAt")
                or not isinstance(playback, (int, float)) or isinstance(playback, bool) or not math.isfinite(playback) or playback <= 0):
            raise ValueError("Missing visual review or original browser playback duration")
        source = ROOT / plans[sha]["sourceLocalPath"]
        name = entry.get("derivativeStorageName", "")
        if not HASH_NAME.fullmatch(name) or entry.get("derivativeSha256") != name[:-4]:
            raise ValueError("Invalid derivative content-addressed identity")
        derivative = output / "derivatives" / name
        if (source.is_symlink() or derivative.is_symlink() or digest(source) != sha
                or digest(derivative) != entry["derivativeSha256"]
                or source.stat().st_size != entry["sourceSizeBytes"] or derivative.stat().st_size != entry["derivativeSizeBytes"]):
            raise ValueError("Source or derivative changed after preparation")
        entry["sourcePlaybackDurationSeconds"] = playback
        entry["derivativeDurationSeconds"] = entry["durationSeconds"]
        entry["visualReviewPassed"] = True
        entry["visualReview"] = {key: candidate.get(key) for key in ("reviewer", "reviewedAt", "scope", "notes")}
    manifest["visualReviewPassed"] = True
    manifest["reviewedAt"] = utc()
    manifest["sourcePlaybackDurationEvidence"] = relative(output / "source-playback-durations.json")
    save(manifest_path, manifest)
    print(json.dumps({"event": "finalized", "complete": True, "visualReviewPassed": True,
                      "canonicalBrowserDurationVideos": len(entries), **manifest["totals"]}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=Path, default=ROOT / "workspace-artifacts/education-video-seed-20260910")
    parser.add_argument("--catalog", type=Path, default=DEFAULT_OUT / "public-catalog-before.json")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--ffmpeg")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--finalize-review", type=Path, help="Finalize existing completed derivatives using an explicit visual-review JSON")
    args = parser.parse_args()
    if args.limit is not None and args.limit <= 0:
        raise ValueError("Limit must be positive")
    output, seed = args.out.resolve(), args.seed.resolve()
    if not output.is_relative_to(ROOT / "workspace-artifacts") or output == seed:
        raise ValueError("Output must be a distinct workspace-artifacts directory")
    for folder in (output, output / "derivatives", output / "work", output / "qa/frames"):
        folder.mkdir(parents=True, exist_ok=True)
        if folder.is_symlink():
            raise ValueError("Refusing symlink output")
    planned = plan(seed, args.catalog)
    save(output / "plan.json", {"version": 1, "createdAt": utc(), "settings": SETTINGS, "publicVideoCount": len(planned), "entries": planned})
    print(json.dumps({"event": "plan", "publicVideos": len(planned), "sourceMiB": round(sum(row["sourceSizeBytes"] for row in planned)/2**20, 2)}), flush=True)
    if args.finalize_review:
        finalize(output, planned, args.finalize_review)
        return
    if args.plan_only:
        return
    runner = Runner(ffmpeg_path(args.ffmpeg), output)
    version = runner.run(["-hide_banner", "-version"]).splitlines()[0]
    manifest = {"version": 1, "release": "video-capacity-20261003-v14", "createdAt": utc(), "complete": False,
                "settings": SETTINGS, "ffmpegVersion": version, "ffmpegSha256": digest(Path(runner.executable)),
                "plannedPublicVideos": len(planned), "derivativeRoot": "derivatives", "entries": []}
    previous_path = output / "manifest.json"
    if previous_path.exists():
        previous = json.loads(previous_path.read_text(encoding="utf-8"))
        if previous.get("settings") != SETTINGS:
            raise ValueError("Existing derivative settings differ; choose a fresh output directory")
        manifest["entries"] = previous.get("entries", [])
    completed = {row["sourceSha256"]: row for row in manifest["entries"]}
    jobs = planned[:args.limit] if args.limit else planned
    for index, row in enumerate(jobs, 1):
        if row["sourceSha256"] in completed:
            old = completed[row["sourceSha256"]]
            path = output / "derivatives" / old["derivativeStorageName"]
            if not HASH_NAME.fullmatch(old["derivativeStorageName"]) or digest(path) != old["derivativeSha256"]:
                raise ValueError("Previously generated derivative changed")
            old.update({"sourceDurationSeconds": row["sourceDurationSeconds"],
                        "sourceManifestDurationSeconds": row["sourceManifestDurationSeconds"],
                        "sourceMeasuredDurationSeconds": row["sourceDurationSeconds"],
                        "derivativeDurationSeconds": old["durationSeconds"]})
            continue
        started = time.monotonic()
        source = ROOT / row["sourceLocalPath"]
        info = runner.probe(source)
        if info["videoCodec"] != "h264" or info["audioCodec"] != "aac":
            raise ValueError("Original browser codec requirements failed")
        if info["totalBitrateMbps"] <= SETTINGS["maximumTotalBitrateMbps"]:
            temporary = output / "derivatives" / ("partial-" + uuid.uuid4().hex + ".mp4")
            shutil.copyfile(source, temporary)
            action, audio = "preserve-below-target", "aac-copy"
        else:
            temporary, audio = encode(runner, source, output, info)
            action = "two-pass-transcode"
        try:
            optimized = runner.probe(temporary)
            difference = abs(optimized["durationSeconds"]-info["durationSeconds"])
            if (optimized["videoCodec"] != "h264" or optimized["audioCodec"] != "aac" or not optimized["fastStart"]
                    or difference > SETTINGS["durationToleranceSeconds"] or optimized["totalBitrateMbps"] > SETTINGS["maximumTotalBitrateMbps"]
                    or optimized["width"] > info["width"] or optimized["height"] > info["height"]):
                raise ValueError("Derivative codec, duration, bitrate, dimensions or faststart validation failed")
            runner.decode(temporary)
            sha = digest(temporary)
            final = output / "derivatives" / (sha + ".mp4")
            if final.exists():
                if digest(final) != sha:
                    raise ValueError("Derivative filename collision")
                temporary.unlink()
            else:
                temporary.rename(final)
            entry = {**row, **optimized, "durationDifferenceSeconds": difference, "sourceMeasuredDurationSeconds": info["durationSeconds"],
                     "sourceDurationSeconds": info["durationSeconds"], "derivativeDurationSeconds": optimized["durationSeconds"],
                     "sourceTotalBitrateMbps": info["totalBitrateMbps"], "action": action, "audioAction": audio,
                     "derivativeStorageName": final.name, "derivativeSha256": sha, "derivativeSizeBytes": final.stat().st_size,
                     "fullDecodePassed": True, "validated": True, "visualReviewPassed": False}
            entry["ssimAtOutputSize"] = quality(runner, source, final, optimized) if action != "preserve-below-target" else 1.0
            entry["visualReviewRequired"] = True
            entry["visualFrames"] = visual_frames(runner, source, final, output, entry)
            manifest["entries"].append(entry)
            completed[row["sourceSha256"]] = entry
            save(output / "manifest.json", manifest)
            print(json.dumps({"event": "validated", "index": index, "total": len(jobs), "code": row["code"], "locale": row["locale"],
                              "sourceMiB": round(row["sourceSizeBytes"]/2**20, 2), "outputMiB": round(entry["derivativeSizeBytes"]/2**20, 2),
                              "totalMbps": round(entry["totalBitrateMbps"], 3), "ssim": round(entry["ssimAtOutputSize"], 4),
                              "durationDifferenceSeconds": round(difference, 4), "elapsedSeconds": round(time.monotonic()-started, 2)}), flush=True)
        finally:
            if temporary.exists():
                temporary.unlink()
    manifest["complete"] = len(completed) == len(planned)
    manifest["visualReviewPassed"] = manifest["complete"] and all(row.get("visualReviewPassed") is True for row in manifest["entries"])
    manifest["finishedAt"] = utc()
    manifest["contactSheets"] = contacts(output, manifest["entries"])
    manifest["totals"] = {"sourceBytes": sum(row["sourceSizeBytes"] for row in manifest["entries"]),
                          "derivativeBytes": sum(row["derivativeSizeBytes"] for row in manifest["entries"]),
                          "durationSeconds": sum(row["durationSeconds"] for row in manifest["entries"]),
                          "maxTotalBitrateMbps": max(row["totalBitrateMbps"] for row in manifest["entries"])}
    save(output / "manifest.json", manifest)
    print(json.dumps({"event": "finished", "complete": manifest["complete"], **manifest["totals"]}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print(json.dumps({"event": "stopped", "errorType": type(error).__name__, "message": str(error)[:300]}), flush=True)
        sys.exit(1)
