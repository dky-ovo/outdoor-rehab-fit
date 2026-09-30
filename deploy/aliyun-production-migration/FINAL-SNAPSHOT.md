# 最终一致性快照与传输

以下是切换窗口的执行准备，**现在不会自动运行**。先确认阿里应用发布包、生产库空结构、运行账号/媒体持久目录与旧入口代理配置已准备好，再进入维护窗口。当前 Google 已确认的目录为 `/home/dukaiyu2004/outdoor-fit-api`；若只读采集显示不同路径，先按实际路径调整。下列命令不读取或打印 `.env`、密码、JWT。

## Google：冻结写入

让旧站 API 进入维护状态，等上传和业务写请求完成；确认没有独立任务/其他进程写同一个数据库或媒体。然后在 Google SSH 终端执行：

```bash
sudo systemctl stop outdoor-fit-api
systemctl show outdoor-fit-api --no-pager --property=ActiveState --property=MainPID
```

必须为 `ActiveState=inactive`、`MainPID=0`。停主服务也停止其进程内设施同步定时器；独立任务需一并停写。直到阿里接管完成或明确回退，不要恢复 Google 写入。

## Google：创建全新快照和媒体包

下面的 Python 只在主服务 inactive 时运行，创建新私有目录，不改旧备份或源库。Backup API 会包含已提交 WAL；仅对备份目标检查完整性。归档拒绝符号链接/特殊文件，允许普通文件和目录。源服务在整个采集过程中必须保持停止。

```bash
python3 - <<'PY'
from pathlib import Path
from contextlib import closing
import hashlib
import os
import sqlite3
import subprocess
import tarfile
import tempfile
import time

def stopped():
    state = subprocess.check_output(['systemctl', 'show', 'outdoor-fit-api', '--property=ActiveState', '--value'], text=True).strip()
    pid = subprocess.check_output(['systemctl', 'show', 'outdoor-fit-api', '--property=MainPID', '--value'], text=True).strip()
    if state != 'inactive' or pid != '0':
        raise SystemExit('SOURCE_WRITES_NOT_STOPPED')

def digest(file):
    result = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()

os.umask(0o077)
stopped()
app = Path('/home/dukaiyu2004/outdoor-fit-api')
source = app / 'data/outdoor-fit.sqlite'
if not source.is_file() or source.is_symlink():
    raise SystemExit('SOURCE_NOT_REGULAR')
folder = Path(tempfile.mkdtemp(prefix='outdoor-fit-final-', dir='/home/dukaiyu2004'))
print('FINAL_DIR=' + str(folder), flush=True)
partial = folder / 'outdoor-fit.sqlite.partial'
deadline = time.monotonic() + 300
def progress(status, remaining, total):
    if time.monotonic() > deadline:
        raise TimeoutError('BACKUP_TIMEOUT')
with closing(sqlite3.connect(partial)) as target:
    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=5)) as original:
        original.backup(target, pages=256, progress=progress, sleep=0.1)
    if target.execute('PRAGMA journal_mode=DELETE').fetchone()[0] != 'delete':
        raise SystemExit('BACKUP_JOURNAL_FAILED')
    if target.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
        raise SystemExit('BACKUP_INTEGRITY_FAILED')
    if target.execute('PRAGMA foreign_key_check').fetchone() is not None:
        raise SystemExit('BACKUP_FOREIGN_KEY_FAILED')
    tables = target.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchone()[0]
partial.rename(folder / 'outdoor-fit.sqlite')
stopped()
trees = ['data/equipment-images', 'data/media-library', 'media-seed']
for name in trees:
    tree = app / name
    if not tree.is_dir() or tree.is_symlink():
        raise SystemExit('MEDIA_TREE_INVALID')
def media_filter(info):
    if not (info.isfile() or info.isdir() or info.islnk()):
        raise RuntimeError('MEDIA_SPECIAL_FILE_REFUSED')
    return info
archive = folder / 'media.tar.gz.partial'
with tarfile.open(archive, 'x:gz', dereference=False) as bundle:
    for name in trees:
        bundle.add(app / name, arcname=name, recursive=True, filter=media_filter)
stopped()
archive.rename(folder / 'media.tar.gz')
lines = [digest(folder / name) + '  ' + name + '\n' for name in ['outdoor-fit.sqlite', 'media.tar.gz']]
with (folder / 'SHA256SUMS').open('x', encoding='ascii') as stream:
    stream.writelines(lines)
print('FINAL_SNAPSHOT_OK')
print('TABLE_COUNT=' + str(tables))
for line in lines:
    print(line.rstrip())
PY
```

只在 `FINAL_SNAPSHOT_OK` 后使用输出目录；失败时保留不完整目录，不上传或导入 `.partial`。源媒体文件仍须由所有写入者共同保持冻结，单独的主服务状态检查不证明不存在其他写入者。

## Google 直接传 ECS

填入刚刚输出的 `FINAL_DIR`；这不是旧 rehearsal 目录。目标目录沿用随机 final 名，避免覆盖之前的记录。仅在 SSH 提示输入 ECS 密码。

```bash
(
set -euo pipefail
final_dir='/home/dukaiyu2004/outdoor-fit-final-填入刚刚输出的后缀'
final_name=$(basename -- "$final_dir")
[[ "$final_name" =~ ^outdoor-fit-final-[a-zA-Z0-9_]+$ ]]
cd "$final_dir"
sha256sum -c SHA256SUMS
ssh -p 28832 -o StrictHostKeyChecking=ask -o ConnectTimeout=15 root@47.83.186.36 \
  "umask 077; mkdir -p /opt/outdoor-fit/migration/$final_name"
rsync -tp --checksum --info=progress2 --partial-dir=.rsync-partial --chmod=D700,F600 \
  -e 'ssh -p 28832 -o StrictHostKeyChecking=ask -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=3' \
  SHA256SUMS outdoor-fit.sqlite media.tar.gz \
  "root@47.83.186.36:/opt/outdoor-fit/migration/$final_name/"
)
```

首次 SSH 主机指纹按已建立的可信 ECS 连接核对，不能关闭校验。传输中断可对同一个 final 目录重跑 rsync；源写入仍保持冻结。

在 ECS 对同名目录执行 `sha256sum -c SHA256SUMS`，再按 `README.md` 导出和导入。最终媒体必须恢复到准备给正式容器的独立目录，不能仅使用旧演练恢复树。如果在此期间恢复 Google 写入，本次快照即不再代表切换时点，需要重新安排最终采集。
