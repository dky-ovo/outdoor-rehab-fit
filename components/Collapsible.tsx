import { PropsWithChildren, ReactNode, useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { Colors } from "@/constants/Colors";

export function Collapsible({ children, title, onOpen, headerAction }: PropsWithChildren & { title: string; onOpen?: () => void; headerAction?: ReactNode }) {
	const [isOpen, setIsOpen] = useState(false);
	const backgroundColor = Colors.light.background;
	return (
		<ThemedView style={{ backgroundColor }}>
			<View style={[styles.headingRow, { backgroundColor }]}>
				<TouchableOpacity
					style={styles.heading}
					onPress={() => {
						setIsOpen((value) => {
							if (!value && onOpen) onOpen();
							return !value;
						});
					}}
					activeOpacity={0.8}
				>
					<IconSymbol name="chevron.right" size={18} weight="medium" color={Colors.light.icon} style={{ transform: [{ rotate: isOpen ? "90deg" : "0deg" }] }} />
					<ThemedText type="defaultSemiBold" style={styles.title} maxFontSizeMultiplier={1.3}>{title}</ThemedText>
				</TouchableOpacity>
				{headerAction ? <View style={styles.headerAction}>{headerAction}</View> : null}
			</View>
			{isOpen && <ThemedView style={[styles.content, { backgroundColor }]}>{children}</ThemedView>}
		</ThemedView>
	);
}

const styles = StyleSheet.create({
	headingRow: {
		flexDirection: "row",
		alignItems: "center",
		minHeight: 64,
		paddingRight: 8,
	},
	heading: {
		flex: 1,
		minWidth: 0,
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		paddingHorizontal: 12,
		paddingVertical: 16,
	},
	title: { flex: 1, flexShrink: 1 },
	headerAction: { marginLeft: 4 },
	content: {
		marginTop: 6,
		marginHorizontal: 24,
		paddingBottom: 4,
	},
});
