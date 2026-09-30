import React from "react";
import { View, TouchableOpacity, StyleSheet, Text } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";

const CustomBackButton = ({ text, onPress }) => {
	return (
		<TouchableOpacity style={styles.button} onPress={onPress || (() => router.back())}>
			<Ionicons name="chevron-back" size={30} color="black" />
			<Text style={styles.text}>{text}</Text>
		</TouchableOpacity>
	);
};

const styles = StyleSheet.create({
	button: {
		flexDirection: "row",
		alignItems: "center",
		padding: 10,
	},
	text: {
		marginLeft: 5,
		fontSize: 16,
		fontWeight: "bold",
		color: "black",
	},
});

export default CustomBackButton;
