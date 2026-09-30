import React from "react";
import { SessionRecord } from "./index";

export default function CountupSessionScreen() {
	// The shared screen gates this retired route: only an existing legacy timer
	// (including its unsaved summary) can be resumed; new visits return Home.
	return <SessionRecord forcedRecordMode="countup" />;
}
