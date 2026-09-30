import React from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

export default function AdminContentToolbar({ value, onChange, count, total, placeholder, locale = "zh-CN", testID = "admin-content-filter" }) {
	const en = locale === "en";
	const active = !!value.search || value.status !== "all" || value.sort !== "order";
	const patch = update => onChange(current => ({ ...current, ...update }));
	const chip = (field, id, label) => <TouchableOpacity key={id} accessibilityRole="button" accessibilityState={{ selected: value[field] === id }} testID={`${testID}-${field}-${id}`} onPress={() => patch({ [field]: id })} style={[styles.chip, value[field] === id && styles.selected]}><Text style={[styles.chipText, value[field] === id && styles.selectedText]}>{label}</Text></TouchableOpacity>;
	return <View style={styles.card} testID={testID}>
		<TextInput accessibilityLabel={placeholder} testID={`${testID}-search`} value={value.search} onChangeText={search => patch({ search })} placeholder={placeholder} placeholderTextColor="#667085" style={styles.input} />
		<View style={styles.row}>
			<View style={styles.group}><Text style={styles.label}>{en ? "Status" : "上架状态"}</Text>{chip("status","all",en ? "All" : "全部")}{chip("status","active",en ? "Published" : "已上架")}{chip("status","inactive",en ? "Unpublished" : "已下架")}</View>
			<View style={styles.group}><Text style={styles.label}>{en ? "Sort" : "排序"}</Text>{chip("sort","order",en ? "Display order" : "展示顺序")}{chip("sort","name",en ? "Name" : "名称")}</View>
		</View>
		<View style={styles.row}><Text accessibilityLiveRegion="polite" style={styles.count}>{en ? `${count} matching / ${total} total · 20 per page` : `符合条件 ${count} 项 / 共 ${total} 项 · 每页 20 项`}</Text>{active && <TouchableOpacity accessibilityRole="button" testID={`${testID}-reset`} onPress={() => onChange({ search: "", status: "all", sort: "order" })} style={styles.reset}><Text style={styles.resetText}>{en ? "Reset filters" : "清除筛选"}</Text></TouchableOpacity>}</View>
		{count === 0 && <Text style={styles.empty}>{en ? "No matching content. Clear the filters or add content." : "暂无符合条件的内容，可清除筛选或新增内容。"}</Text>}
	</View>;
}
const styles = StyleSheet.create({
	card:{backgroundColor:"#FFF",borderWidth:1,borderColor:"#DDE2E8",borderRadius:12,padding:16,gap:12,marginBottom:16,minWidth:0},
	input:{minHeight:44,borderWidth:1,borderColor:"#B7C0CD",borderRadius:8,padding:12,fontSize:14,color:"#202938",backgroundColor:"#FFF",minWidth:0},
	row:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:12,justifyContent:"space-between"},
	group:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:8}, label:{color:"#475467",fontSize:13,fontWeight:"700",marginRight:4},
	chip:{minHeight:38,justifyContent:"center",paddingHorizontal:12,paddingVertical:8,borderRadius:8,borderWidth:1,borderColor:"#D0D5DD",backgroundColor:"#FFF"},
	selected:{borderColor:"#840B1C",backgroundColor:"#F8ECEF"},chipText:{color:"#475467",fontSize:13},selectedText:{color:"#840B1C",fontWeight:"700"},
	count:{color:"#475467",fontSize:13,lineHeight:20,flexShrink:1},reset:{minHeight:36,justifyContent:"center"},resetText:{color:"#840B1C",fontWeight:"700"},empty:{color:"#475467",lineHeight:22},
});
