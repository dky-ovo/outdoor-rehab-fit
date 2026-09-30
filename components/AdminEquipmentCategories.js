import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { createAdminEquipmentCategory, getAdminEquipmentCategories, updateAdminEquipmentCategory } from "../utils/api";
import AdminPagination from "./AdminPagination";

export default function AdminEquipmentCategories({ token, canManage = false, locale = "zh-CN", onChange, onCatalogRefresh }) {
	const [open, setOpen] = useState(false), [query, setQuery] = useState({ page: 1, search: "" });
	const [result, setResult] = useState(null), [revision, setRevision] = useState(0);
	const [form, setForm] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
	const busyRef = useRef(false), active = useRef({ mounted: true, token, canManage });
	active.current.token = token; active.current.canManage = canManage;
	useEffect(() => { active.current.mounted = true; return () => { active.current.mounted = false; }; }, []);
	useEffect(() => { setForm(null); setError(""); setResult(null); setQuery({ page: 1, search: "" }); }, [token,canManage]);
	const key = JSON.stringify([token,canManage,open,query,revision]);
	useEffect(() => {
		let current = true;
		if (token && canManage && open) getAdminEquipmentCategories(token,{ ...query,pageSize: 20 }).then(async data => {
			if (!current) return;
			// The parent reloads the whole public catalog. A single filtered page
			// must never replace all options in the equipment multi-select.
			await onCatalogRefresh?.();
			if (current) setResult({ key,data });
		}).catch(failure => { if (current) setResult({ key,error: failure }); });
		return () => { current = false; };
	},[key,token,canManage,open,query,onCatalogRefresh]);
	const latest = result?.key === key ? result : null;
	const en = locale === "en";
	function failureText(failure) {
		if (failure?.code === "equipmentCategoryChanged") return en ? "Another administrator changed this category. Your draft is preserved but saving is blocked. Refresh the list, reopen Edit and review the latest names before retrying." : "其他管理员已修改此分类。已保留本次输入并停止保存，请刷新列表、重新点击此分类的「修改」，核对最新名称后重试。";
		if (failure?.code === "equipmentCategoryBaselineRequired") return en ? "Reload the category before editing; the original names are required." : "缺少修改前的名称，请刷新后重新打开分类进行修改。";
		if (failure?.code === "equipmentCategoryNameConflict") return en ? "This category name is already in use." : "分类名称已存在，请使用不同的中文及英文名称。";
		if (failure?.code === "invalidEquipmentCategory") return en ? "Enter both names (1–80 characters), without control characters or angle brackets." : "请填写中文及英文名称（1–80 字），不要输入控制字符或尖括号。";
		if (failure?.code === "equipmentCategoryLimit") return en ? "The category limit (200) has been reached." : "分类数量已达到 200 个上限。";
		if (failure?.status === 403) return en ? "Facility maintenance permission is required." : "需要设施教学维护权限。";
		if (failure?.status === 404) return en ? "Category maintenance is not available. Refresh or deploy the matching API." : "分类维护暂不可用，请刷新或先部署对应后台更新。";
		return en ? "The operation failed. Refresh the list before retrying." : "操作未完成，请刷新列表确认后重试。";
	}
	async function save() {
		if (busyRef.current || !canManage || !form || form.conflicted) return;
		const names = { nameZh: form.nameZh.trim(), nameEn: form.nameEn.trim() };
		if (!names.nameZh || !names.nameEn) { setError(failureText({ code: "invalidEquipmentCategory" })); return; }
		busyRef.current = true; setBusy(true); setError("");
		const actorToken = token;
		try {
			const data = form.id ? await updateAdminEquipmentCategory(token,form.id,{ ...names,expectedNames: form.expectedNames }) : await createAdminEquipmentCategory(token,names);
			if (!active.current.mounted || active.current.token !== actorToken || !active.current.canManage) return;
			onChange?.(data.category); setForm(null); setRevision(value => value+1);
		} catch (failure) {
			if (active.current.mounted && active.current.token === actorToken && active.current.canManage) {
				setError(failureText(failure));
				if (["equipmentCategoryChanged","equipmentCategoryBaselineRequired"].includes(failure?.code)) setForm(value => value ? { ...value,conflicted: true } : value);
			}
		} finally { busyRef.current = false; if (active.current.mounted) setBusy(false); }
	}
	if (!token || !canManage) return null;
	return <View style={styles.card} testID="admin-equipment-categories">
		<TouchableOpacity accessibilityRole="button" testID="equipment-categories-toggle" onPress={() => setOpen(value => !value)} style={styles.toggle}><Text style={styles.title}>{en ? "Category management / AI search categories" : "分类管理 / AI 推荐分类"} {open ? "−" : "+"}</Text></TouchableOpacity>
		{open && <>
			<Text style={styles.hint}>{en ? "Add or rename bilingual categories. Existing facility bindings stay unchanged; the APP and AI use the same category IDs. Categories are not deleted here." : "可新增或修改中英文分类名称。现有设施绑定不变，APP 筛选和 AI 检索使用同一分类编号。此处不删除分类。"}</Text>
			<View style={styles.row}><TextInput testID="equipment-categories-search" accessibilityLabel={en ? "Search categories" : "搜索分类"} placeholder={en ? "Search categories" : "搜索分类名称"} style={[styles.input,{ flex: 1 }]} value={query.search} onChangeText={search => setQuery({ page: 1,search })} /><TouchableOpacity testID="equipment-category-add" disabled={busy} style={styles.button} onPress={() => { setForm({ nameZh: "",nameEn: "" }); setError(""); }}><Text style={styles.buttonText}>{en ? "Add category" : "新增分类"}</Text></TouchableOpacity><TouchableOpacity accessibilityLabel={en ? "Refresh categories" : "刷新分类"} disabled={busy} style={styles.button} onPress={() => setRevision(value => value+1)}><Text style={styles.buttonText}>{en ? "Refresh" : "刷新"}</Text></TouchableOpacity></View>
			{!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
			{form && <View style={styles.form}>
				<Text style={styles.title}>{form.id ? (en ? "Rename category" : "修改分类") : (en ? "New category" : "新增分类")}</Text>
				<Text>{en ? "Chinese name" : "中文名称"}</Text><TextInput testID="equipment-category-name-zh" accessibilityLabel="中文名称" style={styles.input} value={form.nameZh} maxLength={80} editable={!busy} onChangeText={nameZh => setForm(value => ({ ...value,nameZh }))} />
				<Text>{en ? "English name" : "英文名称"}</Text><TextInput testID="equipment-category-name-en" accessibilityLabel="英文名称" style={styles.input} value={form.nameEn} maxLength={80} editable={!busy} onChangeText={nameEn => setForm(value => ({ ...value,nameEn }))} />
				<View style={styles.row}><TouchableOpacity testID="equipment-category-save" disabled={busy || form.conflicted} style={styles.button} onPress={save}>{busy ? <ActivityIndicator /> : <Text style={styles.buttonText}>{en ? "Save" : "保存分类"}</Text>}</TouchableOpacity><TouchableOpacity disabled={busy} style={styles.button} onPress={() => { setForm(null); setError(""); }}><Text>{en ? "Cancel" : "取消"}</Text></TouchableOpacity></View>
			</View>}
			{!latest ? <ActivityIndicator /> : latest.error ? <Text style={styles.error}>{failureText(latest.error)}</Text> : <>
				{latest.data.categories.map(category => <View key={category.id} style={styles.item}>
					<View style={{ flex: 1 }}><Text style={styles.title}>{category.nameZh}</Text><Text>{category.nameEn}</Text><Text style={styles.hint}>{category.isBuiltIn ? (en ? "Built-in" : "内建分类") : (en ? "Custom" : "自定义分类")} · {category.equipmentCount} {en ? "facilities" : "个设施"}</Text></View>
					<TouchableOpacity testID={`equipment-category-edit-${category.id}`} disabled={busy} style={styles.button} onPress={() => { setForm({ id: category.id,nameZh: category.nameZh,nameEn: category.nameEn,expectedNames: { nameZh: category.nameZh,nameEn: category.nameEn } }); setError(""); }}><Text style={styles.buttonText}>{en ? "Edit" : "修改"}</Text></TouchableOpacity>
				</View>)}
				<AdminPagination {...latest.data} locale={locale} disabled={busy} onPageChange={page => setQuery(value => ({ ...value,page }))} testID="equipment-categories-pagination" />
			</>}
		</>}
	</View>;
}

const styles = StyleSheet.create({
	card: { backgroundColor: "#FFF",borderWidth: 1,borderColor: "#E5E7EB",borderRadius: 12,padding: 16,marginBottom: 16 },
	toggle: { minHeight: 44,justifyContent: "center" },title: { fontSize: 16,fontWeight: "700",color: "#222" },
	hint: { fontSize: 13,lineHeight: 20,color: "#626B78",marginVertical: 8 },
	row: { flexDirection: "row",flexWrap: "wrap",gap: 10,alignItems: "center" },
	input: { minWidth: 160,minHeight: 44,borderWidth: 1,borderColor: "#D0D5DD",borderRadius: 8,padding: 10,marginVertical: 8 },
	button: { minHeight: 44,paddingHorizontal: 14,paddingVertical: 10,borderRadius: 8,borderWidth: 1,borderColor: "#D0D5DD",justifyContent: "center" },
	buttonText: { color: "#840B1C",fontWeight: "700" },error: { color: "#B42318",paddingVertical: 8 },
	form: { backgroundColor: "#F8F9FB",padding: 14,borderRadius: 10,marginVertical: 12 },
	item: { flexDirection: "row",alignItems: "center",gap: 12,paddingVertical: 12,borderBottomWidth: 1,borderBottomColor: "#EEE" },
});
