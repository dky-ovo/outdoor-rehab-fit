import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { createAdminMediaCategory, createAdminMediaFolder, deleteAdminMediaItems, downloadAdminMedia, getAdminMedia, resolveApiAssetUrl, restoreAdminMediaItem, updateAdminMedia, updateAdminMediaCategory, uploadAdminMedia } from "../utils/api";
import { mediaCanSelect, mediaErrorMessage, mediaSizeLabel, validateAdminMedia } from "../utils/adminMedia";
import { pickAdminMedia, pickAdminMediaBatch } from "../utils/pickAdminMedia";
import { importAdminMediaBatch } from "../utils/adminMediaBatch";

const FILE_PERMISSION = "app_maintenance.files.manage";
const TYPE_LABELS = { "": "全部文件", image: "图片", gif: "GIF 动画", video: "视频", file: "其他文件" };

export default function AdminMediaLibrary({ token, permissions = [], kind = "", onSelect, multiple = false, initialView = "library", refreshKey = 0 }) {
	const canManage = permissions.includes(FILE_PERMISSION);
	const [query, setQuery] = useState({ page: 1, search: "", categoryId: "", kind, archived: false, folderId: "", deleted: false });
	const [search, setSearch] = useState("");
	const [revision, setRevision] = useState(0);
	const [result, setResult] = useState(null);
	const [view, setView] = useState(onSelect ? "library" : initialView);
	const [uploadCategory, setUploadCategory] = useState("");
	const [editing, setEditing] = useState(null);
	const [categoryName, setCategoryName] = useState("");
	const [categoryEditId, setCategoryEditId] = useState("");
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState(null);
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const [selected, setSelected] = useState([]);
	const [picked, setPicked] = useState([]);
	const [deleteSelection, setDeleteSelection] = useState(null);
	const [folderName, setFolderName] = useState("");
	const [batchProgress, setBatchProgress] = useState(null);
	const [categoryPage,setCategoryPage] = useState(1);
	const mounted = useRef(true);
	const activeOperation = useRef(null);
	const activeToken = useRef(token); activeToken.current = token;
	const requestKey = JSON.stringify([token, query, revision, refreshKey]);
	const refresh = () => setRevision((value) => value + 1);
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; activeOperation.current?.abort(); }; }, []);
	useEffect(() => {
		let current = true;
		if (token) getAdminMedia(token, { ...query, limit: 20 }).then((data) => {
			if (!current) return;
			const lastPage = Math.max(1, Math.ceil((data.total || 0) / (data.limit || 20)));
			if (query.page > lastPage) { setQuery((old) => ({ ...old, page: lastPage })); return; }
			setResult({ key: requestKey, data });
		}).catch((failure) => { if (current) setResult({ key: requestKey, error: failure }); });
		return () => { current = false; };
	}, [requestKey]);
	useEffect(() => { activeOperation.current?.abort(); setEditing(null); setError(""); setMessage(""); }, [token]);
	useEffect(() => { setSelected([]); setDeleteSelection(null); }, [requestKey]);
	useEffect(() => { setPicked([]); }, [token, kind, multiple]);
	const active = result?.key === requestKey ? result : null;
	const data = active?.data;
	const categories = data?.categories || [];
	const categoryPages = Math.max(1,Math.ceil(categories.length/20));
	const visibleCategories = categories.slice((Math.min(categoryPage,categoryPages)-1)*20,Math.min(categoryPage,categoryPages)*20);
	const loading = Boolean(token) && !active;
	const totalPages = Math.max(1, Math.ceil((data?.total || 0) / (data?.limit || 20)));
	const uploadKind = kind || query.kind;
	const defaultCategory = uploadKind === "gif" ? "facilities-gifs" : uploadKind === "video" ? "videos" : uploadKind === "image" ? "facilities-images" : "other";
	const selectedUploadCategory = uploadCategory || (categories.some((item) => item.id === defaultCategory) ? defaultCategory : categories[0]?.id || "");
	const setFilter = (key, value) => { setEditing(null); setQuery((old) => ({ ...old, [key]: value, page: 1 })); };
	const validOperation = (operation, operationToken) => mounted.current && activeOperation.current === operation && activeToken.current === operationToken;
	const upload = async () => {
		if (activeOperation.current || !token || onSelect || !canManage) return;
		const operation = new AbortController(); const operationToken = token;
		activeOperation.current = operation; setBusy(true); setError(""); setMessage(""); setProgress(null);
		try {
			const file = await pickAdminMedia(kind || query.kind);
			if (!file || !validOperation(operation, operationToken) || operation.signal.aborted) return;
			const metadata = validateAdminMedia(file, kind || query.kind);
			setProgress(0);
			const response = await uploadAdminMedia(token, file.blob || file, { ...metadata, folderId: query.folderId, categoryId: selectedUploadCategory, signal: operation.signal, onProgress: (value) => { if (validOperation(operation, operationToken)) setProgress(value); } });
			if (!validOperation(operation, operationToken) || operation.signal.aborted) return;
			setMessage("文件已上传到后台服务器文件库。选择并保存相关内容后，APP 才会更新。");
			refresh();
			if (onSelect && mediaCanSelect(response.item, kind)) onSelect(response.item);
		} catch (failure) {
			if (validOperation(operation, operationToken)) setError(failure?.message === "mediaPermissionDenied" ? "请允许相册访问，或使用电脑浏览器进行本地上传。" : mediaErrorMessage(failure));
		} finally {
			if (activeOperation.current === operation) { activeOperation.current = null; if (mounted.current) { setBusy(false); setProgress(null); } }
		}
	};
	const uploadBatch = async (directory) => {
		if (activeOperation.current || !token || !canManage) return;
		const operation = new AbortController(), operationToken = token;
		activeOperation.current = operation; setBusy(true); setError(""); setMessage(""); setProgress(null); setBatchProgress(null);
		try {
			const batch = await pickAdminMediaBatch({kind:directory ? "" : uploadKind,directory});
			if (!batch || !validOperation(operation,operationToken) || operation.signal.aborted) return;
			const result = await importAdminMediaBatch({batch,parentId:query.folderId,categoryId:selectedUploadCategory,kind:directory ? "" : uploadKind,signal:operation.signal,
				createFolder:(name,parentId)=>createAdminMediaFolder(token,name,parentId),uploadFile:(file,options)=>uploadAdminMedia(token,file,options),
				onProgress:value=>{ if(validOperation(operation,operationToken)) {setBatchProgress(value);setProgress(value.percent);} },
			});
			if (validOperation(operation,operationToken)) setMessage(`已上传 ${result.uploaded} 个文件，新增 ${result.createdFolders} 个文件夹。${batch.emptyFoldersUnavailable ? "此浏览器未提供空目录，可使用新增文件夹补建。" : ""}不会覆盖同名文件，也不会自动更换 APP 内容。`);
		} catch (failure) { if (validOperation(operation,operationToken)) setError(`${mediaErrorMessage(failure)}${failure.uploaded !== undefined ? ` 已完成 ${failure.uploaded} 个文件；已完成部分保留，未完成文件不会发布。` : ""}`); }
		finally { if (activeOperation.current === operation) {activeOperation.current=null;if(mounted.current){setBusy(false);setProgress(null);setBatchProgress(null);refresh();}} }
	};
	const mutate = async (action, success) => {
		if (activeOperation.current || !canManage) return;
		const operation = new AbortController(); const operationToken = token;
		activeOperation.current = operation; setBusy(true); setError(""); setMessage("");
		try {
			await action();
			if (validOperation(operation, operationToken)) { setMessage(success); setEditing(null); setCategoryName(""); setCategoryEditId(""); setFolderName(""); setDeleteSelection(null); refresh(); }
		} catch (failure) { if (validOperation(operation, operationToken)) setError(mediaErrorMessage(failure)); }
		finally { if (activeOperation.current === operation) { activeOperation.current = null; if (mounted.current) setBusy(false); } }
	};
	const chip = (label, selected, onPress, id, disabled = busy) => <TouchableOpacity key={id} testID={id} style={[styles.chip, selected && styles.chipSelected, disabled && styles.disabled]} onPress={onPress} disabled={disabled}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></TouchableOpacity>;
	const categoryPager = prefix => categoryPages > 1 && <View style={styles.wrap}>{chip("上一页分类",false,()=>setCategoryPage(Math.max(1,Math.min(categoryPage,categoryPages)-1)),`${prefix}-previous`,busy || categoryPage <= 1)}<Text style={styles.note}>分类 {Math.min(categoryPage,categoryPages)} / {categoryPages}</Text>{chip("下一页分类",false,()=>setCategoryPage(Math.min(categoryPages,categoryPage+1)),`${prefix}-next`,busy || categoryPage >= categoryPages)}</View>;
	const categoryChoices = (value, change, prefix, allowAll = false) => <View><View style={styles.wrap}>{allowAll && chip("全部分类", !value, () => change(""), `${prefix}-all`)}{visibleCategories.map((category) => chip(category.name, category.id === value, () => change(category.id), `${prefix}-${category.id}`))}</View>{categoryPager(prefix)}</View>;
	if (!token) return <Text style={styles.error}>请先登录后台，无权匿名访问文件库。</Text>;
	return <View style={styles.container}>
		<Text style={styles.title}>{onSelect ? "选择媒体文件" : "文件存储"}</Text>
		<Text style={styles.note}>连接当前云服务器的持久文件存储。图片、GIF 和视频可用于公开 APP 教学；其他文件仅后台授权下载，不在网页执行。删除进入回收站，可恢复，不立即释放磁盘空间。</Text>
		<View style={styles.wrap}>
			{chip("后台现有云端存储", view === "library", () => setView("library"), "media-view-library")}
			{!onSelect && canManage && chip("本地上传", view === "upload", () => setView("upload"), "media-view-upload")}
			{chip("刷新文件库", false, refresh, "media-refresh", busy)}
		</View>
		{!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
		{!!message && <Text style={styles.success}>{message}</Text>}
		{active?.error && <Text accessibilityRole="alert" style={styles.error}>{mediaErrorMessage(active.error)}</Text>}
		{loading && <View style={styles.wrap}><ActivityIndicator color="#840B1C" /><Text style={styles.note}>正在读取文件库…</Text></View>}
		<View style={styles.wrap}>{chip("根目录", !query.folderId, () => {setSearch("");setQuery(old=>({...old,folderId:"",page:1,search:"",categoryId:""}));}, "media-root")}{(data?.trail || []).map(folder=>chip(folder.name,folder.id===query.folderId,()=>{setSearch("");setQuery(old=>({...old,folderId:folder.id,page:1,search:"",categoryId:""}));},`media-folder-crumb-${folder.id}`))}</View>
		{!onSelect && canManage && view === "upload" && <View style={styles.box}>
			<Text style={styles.label}>上传后归入分类</Text>
			{categoryChoices(selectedUploadCategory, setUploadCategory, "media-upload-category")}
			<Text style={styles.note}>{kind === "gif" ? "请选择 GIF 动画，最大 12 MB。" : "图片/GIF 最大 12 MB；视频及其他任意文件每个最大 250 MB。"} 推荐 MP4（H.264/AAC）。上传文件夹会保留目录层级，不覆盖同名文件，忽略 Mac 的 ._ 和 .DS_Store 系统索引。</Text>
			<TouchableOpacity testID="media-upload-file" style={[styles.primary, (busy || loading || !data) && styles.disabled]} disabled={busy || loading || !data} onPress={upload}><Text style={styles.primaryText}>{busy ? progress === null ? "正在选择文件…" : progress === 100 ? "上传完成，正在等待服务器确认…" : `正在上传 ${progress}%` : "选择本地文件并上传"}</Text></TouchableOpacity>
			{progress !== null && <View style={styles.progress}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>}
			{batchProgress && <Text style={styles.note}>已完成 {batchProgress.uploaded} / {batchProgress.total} · {batchProgress.name}</Text>}
			{canManage && !onSelect && <View style={styles.wrap}>{chip("多选本地文件上传",false,()=>uploadBatch(false),"media-upload-multiple",busy || loading || !data)}{chip("上传文件夹（含子目录）",false,()=>uploadBatch(true),"media-upload-directory",busy || loading || !data)}</View>}
			{busy && <TouchableOpacity testID="media-upload-cancel" style={styles.chip} onPress={() => activeOperation.current?.abort()}><Text style={styles.chipText}>取消上传</Text></TouchableOpacity>}
		</View>}
		{view === "library" && <>
			<View style={styles.wrap}><TextInput testID="media-search" style={styles.search} value={search} onChangeText={setSearch} placeholder="按文件名称搜索" returnKeyType="search" onSubmitEditing={() => setFilter("search", search.trim())} /><TouchableOpacity testID="media-search-submit" style={styles.chip} onPress={() => setFilter("search", search.trim())} disabled={busy}><Text style={styles.chipText}>搜索</Text></TouchableOpacity></View>
			{!kind && <View style={styles.wrap}>{Object.entries(TYPE_LABELS).map(([type, label]) => chip(label, query.kind === type, () => setFilter("kind", type), `media-kind-${type || "all"}`))}</View>}
			{categoryChoices(query.categoryId, (value) => setFilter("categoryId", value), "media-category", true)}
			{canManage && !onSelect && chip(query.archived ? "正在查看已归档文件（点击查看可用）" : "查看已归档文件", query.archived, () => setFilter("archived", !query.archived), "media-archived")}
			{canManage && !onSelect && <View style={styles.wrap}>{chip(query.deleted ? "返回正常文件" : "回收站",query.deleted,()=>{setSearch("");setQuery(old=>({...old,deleted:!old.deleted,folderId:"",page:1,archived:false,search:"",categoryId:""}));},"media-trash")}{!query.deleted && <>{chip("全选本页",false,()=>setSelected((data?.items || []).filter(item=>!item.isReferenced).map(item=>({id:item.id,kind:item.kind === "folder" ? "folder" : "file"}))),"media-select-all",busy || loading)}{chip("取消全选",false,()=>setSelected([]),"media-deselect-all",busy || !selected.length)}{chip(`删除所选（${selected.length}）`,false,()=>setDeleteSelection(selected),"media-delete-selected",busy || !selected.length)}</>}</View>}
			{deleteSelection && <View style={styles.box}><Text style={styles.note}>确认将所选 {deleteSelection.length} 项及文件夹内所有内容放入回收站？任何内容仍被 APP 使用时，本次删除全部阻止。可从回收站恢复。</Text><View style={styles.wrap}>{chip("确认删除",true,()=>mutate(()=>deleteAdminMediaItems(token,deleteSelection),"已移到回收站，可恢复。磁盘文件未永久删除。"),"media-delete-confirm")}{chip("取消",false,()=>setDeleteSelection(null),"media-delete-cancel")}</View></View>}
			{data && <Text style={styles.note}>共 {data.total} 个文件 · 第 {query.page} / {totalPages} 页</Text>}
			{data?.items?.length === 0 && <Text style={styles.note}>暂无符合条件的文件。请先在「文件存储」上传，再返回选择。</Text>}
			{(data?.items || []).map((item) => <View key={item.id} style={styles.file}>
				<View style={styles.fileTop}>
					{item.kind === "image" && item.url && item.selectable !== false ? <Image source={{ uri: resolveApiAssetUrl(item.url) }} style={styles.thumbnail} resizeMode="contain" /> : <View style={styles.thumbnail}><Text style={styles.symbol}>{item.kind === "folder" ? "📁" : item.kind === "video" ? "▶" : "▤"}</Text></View>}
					<View style={styles.fileInfo}><Text style={styles.fileName}>{item.name}</Text><Text style={styles.note}>{item.kind === "folder" ? "文件夹" : `${item.categoryName || "未分类"} · ${mediaSizeLabel(item.size)}`}</Text><Text style={styles.note}>{item.mimeType || item.source}{item.isReferenced ? " · 使用中" : ""}{item.archived ? " · 已归档" : ""}</Text>{item.kind === "file" && <Text style={styles.note}>私有附件，仅后台授权下载。</Text>}{item.source === "youtube" && <Text style={styles.note}>历史外部引用，不能作为上传视频选择；原内容保留。</Text>}</View>
				</View>
				<View style={styles.wrap}>
					{item.kind === "folder" && chip("打开文件夹",false,()=>{setSearch("");setQuery(old=>({...old,folderId:item.id,page:1,search:"",categoryId:""}));},`media-open-folder-${item.id}`)}
					{canManage && !onSelect && !query.deleted && <>{chip(selected.some(value=>value.id === item.id) ? "☑ 已选择" : "☐ 选择",selected.some(value=>value.id === item.id),()=>setSelected(old=>old.some(value=>value.id === item.id) ? old.filter(value=>value.id !== item.id) : [...old,{id:item.id,kind:item.kind === "folder" ? "folder" : "file"}]),`media-check-${item.id}`,busy || item.isReferenced)}{chip("删除",false,()=>setDeleteSelection([{id:item.id,kind:item.kind === "folder" ? "folder" : "file"}]),`media-delete-${item.id}`,busy || item.isReferenced)}</>}
					{canManage && !onSelect && query.deleted && chip("恢复",false,()=>mutate(()=>restoreAdminMediaItem(token,{id:item.id,kind:item.kind === "folder" ? "folder" : "file"}),"已恢复文件或文件夹。"),`media-restore-${item.id}`)}
					{item.source === "upload" && !query.deleted && chip("下载到电脑",false,()=>downloadAdminMedia(token,item).catch(failure=>setError(mediaErrorMessage(failure))),`media-download-${item.id}`)}
					{onSelect && mediaCanSelect(item, kind) && <TouchableOpacity testID={`media-select-${item.id}`} style={styles.primary} disabled={busy} onPress={() => multiple ? setPicked(values => values.some(value => value.id === item.id) ? values.filter(value => value.id !== item.id) : [...values, item]) : onSelect(item)}><Text style={styles.primaryText}>{multiple ? picked.some(value => value.id === item.id) ? "☑ 已选择" : "☐ 选择" : "使用此文件"}</Text></TouchableOpacity>}
					{canManage && !onSelect && item.kind !== "folder" && !query.deleted && chip("名称和分类", editing?.id === item.id, () => setEditing({ ...item }), `media-edit-${item.id}`)}
				</View>
				{editing?.id === item.id && <View style={styles.box}><Text style={styles.label}>显示名称（不改变文件地址）</Text><TextInput testID="media-edit-name" style={styles.input} value={editing.name} onChangeText={(name) => setEditing((old) => ({ ...old, name }))} maxLength={200} />{categoryChoices(editing.categoryId, (categoryId) => setEditing((old) => ({ ...old, categoryId })), "media-edit-category")}<View style={styles.wrap}>
					{chip("保存分类和名称", true, () => mutate(() => updateAdminMedia(token, item.id, { name: editing.name.trim(), categoryId: editing.categoryId }), "文件资料已保存。"), "media-save", busy || !editing.name.trim())}
					{chip("取消", false, () => setEditing(null), "media-edit-cancel")}
					{(!item.isReferenced || item.archived) && chip(item.archived ? "恢复文件" : "归档（保留原文件）", false, () => setEditing((old) => ({ ...old, confirmArchive: true })), "media-archive")}
				</View>{editing.confirmArchive && <View style={styles.box}><Text style={styles.note}>{item.archived ? "确认恢复到可用文件列表？" : "归档后不可选用，但保留原始文件和地址，不会删除磁盘文件。确认归档？"}</Text>{chip("确认", false, () => mutate(() => updateAdminMedia(token, item.id, { archived: !item.archived }), item.archived ? "文件已恢复。" : "文件已归档，原文件保留。"), "media-archive-confirm")}</View>}</View>}
			</View>)}
			<View style={styles.wrap}>{chip("上一页", false, () => setQuery((old) => ({ ...old, page: old.page - 1 })), "media-previous", busy || loading || query.page <= 1)}{chip("下一页", false, () => setQuery((old) => ({ ...old, page: old.page + 1 })), "media-next", busy || loading || !data || query.page >= totalPages)}</View>
		</>}
		{onSelect && multiple && <View style={styles.wrap}><Text style={styles.note}>已选择 {picked.length} 个文件</Text>{chip("使用所选文件", true, () => onSelect(picked), "media-use-selected", busy || loading || !picked.length)}</View>}
		{canManage && !onSelect && !query.deleted && <View style={styles.box}><Text style={styles.label}>在当前目录新增文件夹</Text><TextInput testID="media-folder-name" style={styles.input} value={folderName} maxLength={200} onChangeText={setFolderName} placeholder="文件夹名称（可以创建空目录）" />{chip("新增文件夹",true,()=>mutate(()=>createAdminMediaFolder(token,folderName.trim(),query.folderId),"文件夹已创建（同名目录保留，不覆盖文件）。"),"media-folder-create",busy || !folderName.trim())}</View>}
		{canManage && !onSelect && <View style={styles.box}>
			<Text style={styles.label}>文件分类管理</Text><Text style={styles.note}>分类只整理后台公开文件，不移动或删除原文件，不影响现有 APP 引用。</Text>
			<View style={styles.wrap}>{chip("新增分类", !categoryEditId, () => { setCategoryEditId(""); setCategoryName(""); }, "media-category-new")}{visibleCategories.map((category) => chip(`编辑 ${category.name}`, categoryEditId === category.id, () => { setCategoryEditId(category.id); setCategoryName(category.name); }, `media-category-edit-${category.id}`))}</View>{categoryPager("media-category-edit")}
			<TextInput testID="media-category-name" style={styles.input} value={categoryName} maxLength={80} onChangeText={setCategoryName} placeholder={categoryEditId ? "新的分类名称" : "新分类名称"} />
			{chip(categoryEditId ? "保存分类名称" : "创建分类", true, () => mutate(() => categoryEditId ? updateAdminMediaCategory(token, categoryEditId, categoryName.trim()) : createAdminMediaCategory(token, categoryName.trim()), "文件分类已保存。"), "media-category-save", busy || !categoryName.trim())}
		</View>}
	</View>;
}

const styles = StyleSheet.create({
	container: { gap: 12, minWidth: 0 }, title: { color: "#292929", fontSize: 22, fontWeight: "800" }, label: { color: "#333", fontSize: 15, fontWeight: "700" }, note: { color: "#666", fontSize: 13, lineHeight: 20, flexShrink: 1 }, error: { color: "#941c2a", fontSize: 14, lineHeight: 22, backgroundColor: "#fff0f1", padding: 12, borderRadius: 8 }, success: { color: "#24694c", fontSize: 14, lineHeight: 22, padding: 10 }, wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }, chip: { borderRadius: 8, borderWidth: 1, borderColor: "#ddd", paddingHorizontal: 12, paddingVertical: 10, alignSelf: "flex-start", maxWidth: "100%" }, chipSelected: { backgroundColor: "#f6e8ea", borderColor: "#840B1C" }, chipText: { color: "#555", fontSize: 14, flexShrink: 1 }, chipTextSelected: { color: "#840B1C", fontWeight: "700" }, disabled: { opacity: 0.45 }, primary: { backgroundColor: "#840B1C", borderRadius: 8, padding: 12, alignSelf: "flex-start", maxWidth: "100%" }, primaryText: { color: "white", fontSize: 14, fontWeight: "700", flexShrink: 1 }, box: { backgroundColor: "#fafafa", borderColor: "#e7e7e7", borderWidth: 1, borderRadius: 10, padding: 12, gap: 10 }, search: { minWidth: 150, flex: 1, borderWidth: 1, borderColor: "#ddd", padding: 12, borderRadius: 8, fontSize: 14 }, input: { borderWidth: 1, borderColor: "#ddd", padding: 12, borderRadius: 8, backgroundColor: "white", fontSize: 14 }, file: { borderWidth: 1, borderColor: "#e5e5e5", padding: 12, borderRadius: 10, gap: 10 }, fileTop: { flexDirection: "row", alignItems: "center", gap: 12 }, thumbnail: { width: 64, height: 64, borderRadius: 8, backgroundColor: "#f4efed", alignItems: "center", justifyContent: "center" }, symbol: { color: "#840B1C", fontSize: 26 }, fileInfo: { flex: 1, minWidth: 0 }, fileName: { color: "#333", fontSize: 15, fontWeight: "700", flexShrink: 1 }, progress: { height: 7, backgroundColor: "#eee", borderRadius: 4, overflow: "hidden" }, progressFill: { height: 7, backgroundColor: "#840B1C" },
});
